/**
 * Background polling service that watches inboxes for new messages.
 *
 * Checks every pollIntervalSeconds (default 60). Maintains per-inbox
 * "last seen message ID" and "last alert time" in plugin state. When
 * new messages arrive AND debounceSeconds has elapsed since the last
 * alert for that inbox, marks the inbox as having pending notifications.
 *
 * The before_prompt_build hook reads pending notifications and injects
 * them into the agent's next turn.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClankerMailsClient } from "./client.js";

interface InboxState {
	address: string;
	lastSeenAt: string;
	lastAlertAt: number;
	pendingCount: number;
	pendingSubjects: string[];
}

interface PollerState {
	inboxes: Record<string, InboxState>;
}

interface PollerConfig {
	apiKey?: string;
	baseUrl?: string;
	pollIntervalSeconds?: number;
	debounceSeconds?: number;
	inboxesToWatch?: string[] | "all";
}

const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const DEFAULT_DEBOUNCE_SECONDS = 300;
const MAX_PENDING_SUBJECTS = 5;

export interface PendingAlert {
	inboxId: string;
	address: string;
	count: number;
	subjects: string[];
}

export class InboxPoller {
	private interval: ReturnType<typeof setInterval> | null = null;
	private statePath: string;
	private logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string, err?: unknown) => void };

	constructor(
		private readonly config: PollerConfig,
		private readonly stateDir: string,
		logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string, err?: unknown) => void },
	) {
		mkdirSync(this.stateDir, { recursive: true });
		this.statePath = resolve(this.stateDir, "poller-state.json");
		this.logger = logger;
	}

	start(): void {
		if (this.interval) return;
		const seconds = this.config.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
		// Run once immediately so first-time users see results faster
		this.tick().catch((err) => this.logger.error("[clankermails-poller] initial tick failed", err));
		this.interval = setInterval(() => {
			this.tick().catch((err) => this.logger.error("[clankermails-poller] tick failed", err));
		}, seconds * 1000);
		this.interval.unref?.();
		this.logger.info(`[clankermails-poller] started, polling every ${seconds}s`);
	}

	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
			this.logger.info("[clankermails-poller] stopped");
		}
	}

	/**
	 * Drain pending alerts and return them. Resets pending counts and
	 * updates lastAlertAt so the debounce window starts now.
	 */
	drainPendingAlerts(): PendingAlert[] {
		const state = this.loadState();
		const now = Date.now();
		const alerts: PendingAlert[] = [];

		for (const [inboxId, inboxState] of Object.entries(state.inboxes)) {
			if (inboxState.pendingCount > 0) {
				alerts.push({
					inboxId,
					address: inboxState.address,
					count: inboxState.pendingCount,
					subjects: inboxState.pendingSubjects,
				});
				inboxState.lastAlertAt = now;
				inboxState.pendingCount = 0;
				inboxState.pendingSubjects = [];
			}
		}

		if (alerts.length > 0) this.saveState(state);
		return alerts;
	}

	private async tick(): Promise<void> {
		if (!this.config.apiKey) return;

		const client = new ClankerMailsClient({ apiKey: this.config.apiKey, baseUrl: this.config.baseUrl });
		const state = this.loadState();
		const now = Date.now();
		const debounceMs = (this.config.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS) * 1000;
		const watchFilter = this.config.inboxesToWatch;

		let inboxes: Awaited<ReturnType<typeof client.listInboxes>>["inboxes"];
		try {
			inboxes = (await client.listInboxes()).inboxes;
		} catch (err) {
			this.logger.warn(`[clankermails-poller] listInboxes failed: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		for (const inbox of inboxes) {
			if (Array.isArray(watchFilter) && !watchFilter.includes(inbox.id) && !watchFilter.includes(inbox.address)) {
				continue;
			}

			let inboxState = state.inboxes[inbox.id];
			if (!inboxState) {
				// First time seeing this inbox -- baseline at "now" so we don't alert on historical mail
				inboxState = {
					address: inbox.address,
					lastSeenAt: new Date().toISOString(),
					lastAlertAt: 0,
					pendingCount: 0,
					pendingSubjects: [],
				};
				state.inboxes[inbox.id] = inboxState;
				continue;
			}

			inboxState.address = inbox.address;

			let messages: Awaited<ReturnType<typeof client.listMessages>>["messages"];
			try {
				messages = (await client.listMessages(inbox.id, { limit: 50 })).messages;
			} catch (err) {
				this.logger.warn(`[clankermails-poller] listMessages(${inbox.id}) failed: ${err instanceof Error ? err.message : String(err)}`);
				continue;
			}

			const newMessages = messages.filter((msg) => msg.received_at > inboxState.lastSeenAt);
			if (newMessages.length === 0) continue;

			inboxState.lastSeenAt = newMessages[0].received_at;

			// Debounce: skip if we alerted recently
			if (now - inboxState.lastAlertAt < debounceMs && inboxState.pendingCount === 0) continue;

			inboxState.pendingCount += newMessages.length;
			const newSubjects = newMessages
				.map((m) => m.subject || "(no subject)")
				.filter((s) => !inboxState!.pendingSubjects.includes(s));
			inboxState.pendingSubjects = [...inboxState.pendingSubjects, ...newSubjects].slice(0, MAX_PENDING_SUBJECTS);
		}

		this.saveState(state);
	}

	private loadState(): PollerState {
		try {
			const raw = readFileSync(this.statePath, "utf-8");
			const parsed = JSON.parse(raw) as PollerState;
			if (!parsed.inboxes || typeof parsed.inboxes !== "object") return { inboxes: {} };
			return parsed;
		} catch {
			return { inboxes: {} };
		}
	}

	private saveState(state: PollerState): void {
		try {
			writeFileSync(this.statePath, JSON.stringify(state, null, 2));
		} catch (err) {
			this.logger.error("[clankermails-poller] saveState failed", err);
		}
	}
}

export function formatAlertText(alerts: PendingAlert[]): string {
	if (alerts.length === 0) return "";
	const lines: string[] = ["You have new email at the following inboxes:"];
	for (const alert of alerts) {
		const subjectList = alert.subjects.length > 0 ? ` (${alert.subjects.map((s) => `"${s}"`).join(", ")})` : "";
		const moreText = alert.count > alert.subjects.length ? ` and ${alert.count - alert.subjects.length} more` : "";
		lines.push(`  - ${alert.address}: ${alert.count} new message${alert.count === 1 ? "" : "s"}${subjectList}${moreText}`);
	}
	lines.push("Use clankermails_list_messages or clankermails_read_message to view them.");
	return lines.join("\n");
}
