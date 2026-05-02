import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { jsonResult } from "openclaw/plugin-sdk/provider-web-search";
import { Type } from "typebox";
import { ClankerMailsClient } from "./client.js";

interface PluginConfig {
	apiKey?: string;
	baseUrl?: string;
}

function getClient(api: OpenClawPluginApi): ClankerMailsClient {
	const config = (api.pluginConfig ?? {}) as PluginConfig;
	return new ClankerMailsClient(config);
}

function errorResult(message: string) {
	return jsonResult({ error: message, failed: true });
}

export function createListInboxesTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_list_inboxes",
		label: "List inboxes",
		description: "List all email inboxes on the ClankerMails account.",
		parameters: Type.Object({}, { additionalProperties: false }),
		execute: async () => {
			try {
				return jsonResult(await getClient(api).listInboxes());
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export function createCreateInboxTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_create_inbox",
		label: "Create inbox",
		description: "Create a new email inbox. Returns the address and inbox ID.",
		parameters: Type.Object(
			{
				local_part: Type.String({ description: "The part before the @ in the email address (lowercase, alphanumeric, dots/hyphens/underscores allowed)." }),
				domain: Type.Optional(Type.String({ description: "Email domain. Use clankermails_list_inboxes or call /v1/domains to see options. Defaults to clankermails.com." })),
				display_name: Type.Optional(Type.String({ description: "A friendly label for the inbox." })),
				webhook_url: Type.Optional(Type.String({ description: "URL to receive POST webhooks when mail arrives. Optional." })),
			},
			{ additionalProperties: false },
		),
		execute: async (_id: string, params: Record<string, unknown>) => {
			try {
				const inbox = await getClient(api).createInbox({
					localPart: String(params.local_part),
					domain: params.domain ? String(params.domain) : undefined,
					displayName: params.display_name ? String(params.display_name) : undefined,
					webhookUrl: params.webhook_url ? String(params.webhook_url) : undefined,
				});
				return jsonResult(inbox);
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export function createGetInboxTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_get_inbox",
		label: "Get inbox",
		description: "Get details about a specific inbox by ID.",
		parameters: Type.Object(
			{
				inbox_id: Type.String({ description: "The inbox ID (starts with inb_)." }),
			},
			{ additionalProperties: false },
		),
		execute: async (_id: string, params: Record<string, unknown>) => {
			try {
				return jsonResult(await getClient(api).getInbox(String(params.inbox_id)));
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export function createDeleteInboxTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_delete_inbox",
		label: "Delete inbox",
		description: "Permanently delete an inbox and all its messages.",
		parameters: Type.Object(
			{
				inbox_id: Type.String({ description: "The inbox ID to delete." }),
			},
			{ additionalProperties: false },
		),
		execute: async (_id: string, params: Record<string, unknown>) => {
			try {
				return jsonResult(await getClient(api).deleteInbox(String(params.inbox_id)));
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export function createListMessagesTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_list_messages",
		label: "List messages",
		description: "List messages in an inbox. Supports pagination via cursor and filtering to unread only.",
		parameters: Type.Object(
			{
				inbox_id: Type.String({ description: "The inbox ID." }),
				limit: Type.Optional(Type.Number({ description: "Max messages to return (1-100, default 50).", minimum: 1, maximum: 100 })),
				cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous response." })),
				unread_only: Type.Optional(Type.Boolean({ description: "Only return unread messages." })),
			},
			{ additionalProperties: false },
		),
		execute: async (_id: string, params: Record<string, unknown>) => {
			try {
				return jsonResult(await getClient(api).listMessages(String(params.inbox_id), {
					limit: params.limit !== undefined ? Number(params.limit) : undefined,
					cursor: params.cursor ? String(params.cursor) : undefined,
					unreadOnly: params.unread_only === true,
				}));
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export function createReadMessageTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_read_message",
		label: "Read message",
		description: "Read the full contents of a message including body, headers, and attachment metadata.",
		parameters: Type.Object(
			{
				message_id: Type.String({ description: "The message ID (starts with msg_)." }),
			},
			{ additionalProperties: false },
		),
		execute: async (_id: string, params: Record<string, unknown>) => {
			try {
				return jsonResult(await getClient(api).readMessage(String(params.message_id)));
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export function createMarkReadTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_mark_read",
		label: "Mark message as read",
		description: "Mark a message as read.",
		parameters: Type.Object(
			{
				message_id: Type.String({ description: "The message ID." }),
			},
			{ additionalProperties: false },
		),
		execute: async (_id: string, params: Record<string, unknown>) => {
			try {
				return jsonResult(await getClient(api).markRead(String(params.message_id)));
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export function createMarkUnreadTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_mark_unread",
		label: "Mark message as unread",
		description: "Mark a message as unread.",
		parameters: Type.Object(
			{
				message_id: Type.String({ description: "The message ID." }),
			},
			{ additionalProperties: false },
		),
		execute: async (_id: string, params: Record<string, unknown>) => {
			try {
				return jsonResult(await getClient(api).markUnread(String(params.message_id)));
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

/**
 * Returns any new-mail alerts collected by the background poller since
 * the last call. Useful for an agent that wants to "check in" on its
 * inboxes without scanning every message.
 */
export function createCheckAlertsTool(
	api: OpenClawPluginApi,
	drainAlerts: () => { inboxId: string; address: string; count: number; subjects: string[] }[],
) {
	return {
		name: "clankermails_check_alerts",
		label: "Check for new mail alerts",
		description: "Returns any new email alerts collected by the background watcher since the last check. Empty array means no new mail.",
		parameters: Type.Object({}, { additionalProperties: false }),
		execute: async () => {
			void api;
			try {
				return jsonResult({ alerts: drainAlerts() });
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export function createDeleteMessageTool(api: OpenClawPluginApi) {
	return {
		name: "clankermails_delete_message",
		label: "Delete message",
		description: "Permanently delete a message.",
		parameters: Type.Object(
			{
				message_id: Type.String({ description: "The message ID to delete." }),
			},
			{ additionalProperties: false },
		),
		execute: async (_id: string, params: Record<string, unknown>) => {
			try {
				return jsonResult(await getClient(api).deleteMessage(String(params.message_id)));
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}
