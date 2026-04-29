/**
 * Slash command handler for /clankermails.
 *
 * Subcommands:
 *   /clankermails check       -- show pending alerts
 *   /clankermails inboxes     -- list all inboxes
 *   /clankermails recent <id> -- list recent messages in an inbox
 *   /clankermails read <msg>  -- read full message content
 *   /clankermails help        -- show usage
 */

import { ClankerMailsClient } from "./client.js";
import type { PendingAlert } from "./poller.js";
import { formatAlertText } from "./poller.js";

interface CommandConfig {
	apiKey?: string;
	baseUrl?: string;
}

interface CommandContext {
	args?: string;
}

export async function handleSlashCommand(
	ctx: CommandContext,
	config: CommandConfig,
	drainAlerts: () => PendingAlert[],
): Promise<{ text: string }> {
	const tokens = ctx.args?.trim().split(/\s+/).filter(Boolean) ?? [];
	const action = (tokens[0] ?? "help").toLowerCase();
	const rest = tokens.slice(1);

	if (action === "help" || action === "") {
		return { text: helpText() };
	}

	if (!config.apiKey) {
		return { text: "ClankerMails: no API key configured. Set `apiKey` in the plugin config." };
	}

	const client = new ClankerMailsClient(config);

	try {
		if (action === "check") {
			const alerts = drainAlerts();
			if (alerts.length === 0) return { text: "ClankerMails: no new mail." };
			return { text: formatAlertText(alerts) };
		}

		if (action === "inboxes" || action === "list") {
			const { inboxes } = await client.listInboxes();
			if (inboxes.length === 0) {
				return { text: "ClankerMails: no inboxes yet. Create one at https://clankermails.com/dashboard" };
			}
			const lines = ["ClankerMails inboxes:"];
			for (const inbox of inboxes) {
				const label = inbox.display_name ? ` (${inbox.display_name})` : "";
				lines.push(`  ${inbox.id}  ${inbox.address}${label}  [${inbox.status}]`);
			}
			return { text: lines.join("\n") };
		}

		if (action === "recent") {
			const target = rest[0];

			// If no arg: pick a sensible default based on how many inboxes exist
			if (!target) {
				const { inboxes } = await client.listInboxes();
				if (inboxes.length === 0) {
					return { text: "ClankerMails: no inboxes yet. Create one at https://clankermails.com/dashboard" };
				}
				if (inboxes.length === 1) {
					const single = inboxes[0];
					return { text: await renderRecent(client, single.id, single.address, 10) };
				}
				const lines: string[] = [];
				for (const inbox of inboxes) {
					lines.push(await renderRecent(client, inbox.id, inbox.address, 3));
					lines.push("");
				}
				return { text: lines.join("\n").trimEnd() };
			}

			const resolved = await resolveInboxId(client, target);
			if (!resolved) return { text: `ClankerMails: no inbox matching ${target}` };

			return { text: await renderRecent(client, resolved.id, resolved.address, 10) };
		}

		if (action === "read") {
			const messageId = rest[0];
			if (!messageId) return { text: "Usage: /clankermails read <message-id>" };

			const msg = await client.readMessage(messageId);
			const fromLabel = msg.from.name ? `${msg.from.name} <${msg.from.email}>` : msg.from.email;
			const subject = msg.subject || "(no subject)";
			const body = msg.text || msg.html?.replace(/<[^>]+>/g, "") || "(no body)";
			const truncated = body.length > 1500 ? body.slice(0, 1500) + "\n... [truncated]" : body;
			return {
				text: `From: ${fromLabel}\nSubject: ${subject}\nReceived: ${msg.received_at}\n\n${truncated}`,
			};
		}

		return { text: `Unknown subcommand: ${action}\n\n${helpText()}` };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { text: `ClankerMails error: ${message}` };
	}
}

async function renderRecent(
	client: ClankerMailsClient,
	inboxId: string,
	address: string,
	limit: number,
): Promise<string> {
	const { messages } = await client.listMessages(inboxId, { limit });
	if (messages.length === 0) return `${address}: no messages.`;

	const lines = [`${address} (${inboxId}):`];
	for (const msg of messages) {
		const fromLabel = msg.from.name ? `${msg.from.name} <${msg.from.email}>` : msg.from.email;
		const subject = msg.subject || "(no subject)";
		const unread = msg.read ? "" : " [unread]";
		lines.push(`  ${msg.id}  ${fromLabel}  "${subject}"${unread}`);
	}
	return lines.join("\n");
}

async function resolveInboxId(
	client: ClankerMailsClient,
	idOrAddress: string,
): Promise<{ id: string; address: string } | null> {
	if (idOrAddress.startsWith("inb_")) {
		try {
			const inbox = await client.getInbox(idOrAddress);
			return { id: inbox.id, address: inbox.address };
		} catch {
			return null;
		}
	}
	const { inboxes } = await client.listInboxes();
	const match = inboxes.find((i) => i.address === idOrAddress);
	return match ? { id: match.id, address: match.address } : null;
}

function helpText(): string {
	return [
		"/clankermails subcommands:",
		"  check              show pending new-mail alerts",
		"  inboxes            list all your inboxes",
		"  recent <id|addr>   list recent messages in an inbox",
		"  read <msg-id>      print a message's content",
		"  help               this message",
	].join("\n");
}
