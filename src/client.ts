/**
 * Minimal HTTP client for the ClankerMails REST API.
 *
 * Reads the API key and base URL from the plugin config. All methods
 * throw on non-2xx responses with a descriptive error message.
 */

interface PluginConfig {
	apiKey?: string;
	baseUrl?: string;
}

export class ClankerMailsClient {
	private readonly apiKey: string;
	private readonly baseUrl: string;

	constructor(config: PluginConfig) {
		const apiKey = config.apiKey?.trim();
		if (!apiKey) {
			throw new Error("ClankerMails API key is not configured. Set it in the plugin config.");
		}
		this.apiKey = apiKey;
		this.baseUrl = (config.baseUrl?.trim() || "https://clankermails.com").replace(/\/$/, "");
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const url = `${this.baseUrl}/v1${path}`;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiKey}`,
		};
		if (body !== undefined) headers["Content-Type"] = "application/json";

		const response = await fetch(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		if (!response.ok) {
			let detail = "";
			try {
				const json = (await response.json()) as { error?: string };
				detail = json.error ?? "";
			} catch {
				detail = await response.text().catch(() => "");
			}
			throw new Error(`ClankerMails API ${method} ${path} failed (${response.status}): ${detail || response.statusText}`);
		}

		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}

	listInboxes(): Promise<{ inboxes: InboxSummary[] }> {
		return this.request("GET", "/inboxes");
	}

	createInbox(input: { localPart: string; domain?: string; displayName?: string; webhookUrl?: string }): Promise<InboxSummary> {
		return this.request("POST", "/inboxes", {
			local_part: input.localPart,
			domain: input.domain,
			display_name: input.displayName,
			webhook_url: input.webhookUrl,
		});
	}

	getInbox(inboxId: string): Promise<InboxSummary> {
		return this.request("GET", `/inboxes/${encodeURIComponent(inboxId)}`);
	}

	deleteInbox(inboxId: string): Promise<{ deleted: boolean }> {
		return this.request("DELETE", `/inboxes/${encodeURIComponent(inboxId)}`);
	}

	listMessages(inboxId: string, options: { limit?: number; cursor?: string; unreadOnly?: boolean } = {}): Promise<{ messages: MessageSummary[]; next_cursor: string | null }> {
		const params = new URLSearchParams();
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		if (options.cursor) params.set("cursor", options.cursor);
		if (options.unreadOnly) params.set("unread_only", "true");
		const qs = params.toString();
		return this.request("GET", `/inboxes/${encodeURIComponent(inboxId)}/messages${qs ? `?${qs}` : ""}`);
	}

	readMessage(messageId: string): Promise<MessageDetail> {
		return this.request("GET", `/messages/${encodeURIComponent(messageId)}`);
	}

	markRead(messageId: string): Promise<{ success: boolean }> {
		return this.request("POST", `/messages/${encodeURIComponent(messageId)}/read`);
	}

	markUnread(messageId: string): Promise<{ success: boolean }> {
		return this.request("POST", `/messages/${encodeURIComponent(messageId)}/unread`);
	}

	deleteMessage(messageId: string): Promise<{ deleted: boolean }> {
		return this.request("DELETE", `/messages/${encodeURIComponent(messageId)}`);
	}
}

export interface InboxSummary {
	id: string;
	address: string;
	domain: string;
	local_part: string;
	display_name: string | null;
	webhook_url: string | null;
	status: string;
	created_at: string;
}

export interface MessageSummary {
	id: string;
	inbox_id: string;
	from: { email: string; name: string | null };
	subject: string | null;
	received_at: string;
	read: boolean;
}

export interface MessageDetail extends MessageSummary {
	to: { email: string; name: string | null }[];
	text: string | null;
	html: string | null;
	headers: Record<string, string>;
	attachments: { id: string; filename: string | null; content_type: string; size: number }[];
}
