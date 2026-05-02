import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { handleSlashCommand } from "./src/command.js";
import { InboxPoller, formatAlertText, type PendingAlert } from "./src/poller.js";
import {
	createCheckAlertsTool,
	createCreateInboxTool,
	createDeleteInboxTool,
	createDeleteMessageTool,
	createGetInboxTool,
	createListInboxesTool,
	createListMessagesTool,
	createMarkReadTool,
	createMarkUnreadTool,
	createReadMessageTool,
} from "./src/tools.js";
import { createWebhookHandler } from "./src/webhook.js";

interface ClankerMailsConfig {
	apiKey?: string;
	baseUrl?: string;
	pollIntervalSeconds?: number;
	debounceSeconds?: number;
	inboxesToWatch?: string[] | "all";
	webhookSecret?: string;
	webhookPath?: string;
}

export default definePluginEntry({
	id: "clankermails",
	name: "ClankerMails",
	description: "Give your bot a real email address. Read mail, manage inboxes, and process incoming messages through the ClankerMails API.",
	register(api) {
		const config = (api.pluginConfig ?? {}) as ClankerMailsConfig;
		let poller: InboxPoller | null = null;
		const pushedAlerts: PendingAlert[] = [];

		const drainAlerts = (): PendingAlert[] => {
			const polled = poller?.drainPendingAlerts() ?? [];
			const pushed = pushedAlerts.splice(0, pushedAlerts.length);
			// Merge alerts for the same inbox so a webhook + a poll don't double-fire
			const merged = new Map<string, PendingAlert>();
			for (const alert of [...polled, ...pushed]) {
				const existing = merged.get(alert.inboxId);
				if (!existing) {
					merged.set(alert.inboxId, { ...alert });
				} else {
					existing.count += alert.count;
					for (const subject of alert.subjects) {
						if (!existing.subjects.includes(subject)) existing.subjects.push(subject);
					}
				}
			}
			return [...merged.values()];
		};

		// Agent tools
		api.registerTool(createListInboxesTool(api) as AnyAgentTool);
		api.registerTool(createCreateInboxTool(api) as AnyAgentTool);
		api.registerTool(createGetInboxTool(api) as AnyAgentTool);
		api.registerTool(createDeleteInboxTool(api) as AnyAgentTool);
		api.registerTool(createListMessagesTool(api) as AnyAgentTool);
		api.registerTool(createReadMessageTool(api) as AnyAgentTool);
		api.registerTool(createMarkReadTool(api) as AnyAgentTool);
		api.registerTool(createMarkUnreadTool(api) as AnyAgentTool);
		api.registerTool(createDeleteMessageTool(api) as AnyAgentTool);
		api.registerTool(createCheckAlertsTool(api, drainAlerts) as AnyAgentTool);

		// User-facing slash command
		api.registerCommand({
			name: "clankermails",
			description: "Manage ClankerMails inboxes and check for new mail.",
			acceptsArgs: true,
			handler: async (ctx) => handleSlashCommand({ args: ctx.args }, config, drainAlerts),
		});

		// Inject pending alerts into the agent's next prompt
		api.on("before_prompt_build", async () => {
			const alerts = drainAlerts();
			if (alerts.length === 0) return;
			return { prependContext: formatAlertText(alerts) };
		});

		// Real-time webhook receiver. Configure the inbox webhook_url to
		// `https://<your-openclaw-host>/clankermails/webhook` and set the
		// inbox's webhook_secret in plugin config.webhookSecret to enable
		// signature verification.
		const webhookPath = config.webhookPath ?? "/clankermails/webhook";
		api.registerHttpRoute({
			path: webhookPath,
			auth: "plugin",
			match: "exact",
			handler: createWebhookHandler({
				signatureSecret: config.webhookSecret ?? null,
				pushAlert: (alert) => pushedAlerts.push(alert),
			}),
		});

		// Background polling service
		api.registerService({
			id: "clankermails-poller",
			start: async (ctx) => {
				if (!config.apiKey) {
					ctx.logger.warn("[clankermails] No API key configured; poller will not start");
					return;
				}
				poller = new InboxPoller(config, ctx.stateDir, {
					info: (msg) => ctx.logger.info(msg),
					warn: (msg) => ctx.logger.warn(msg),
					error: (msg, err) => ctx.logger.error(err ? `${msg}: ${err instanceof Error ? err.message : String(err)}` : msg),
				});
				poller.start();
			},
			stop: async () => {
				poller?.stop();
				poller = null;
			},
		});
	},
});
