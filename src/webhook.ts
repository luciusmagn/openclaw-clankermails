/**
 * Receives ClankerMails webhook deliveries.
 *
 * ClankerMails sends a POST per incoming message with an HMAC-SHA256
 * signature in the X-ClankerMails-Signature header. The signature is
 * computed over the raw body using the inbox's webhook_secret.
 *
 * On receipt, this handler enqueues a pending alert so the next agent
 * turn surfaces "you have new mail at X". Real-time alternative to the
 * polling loop.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PendingAlert } from "./poller.js";

interface WebhookPayload {
	event: string;
	inbox: { id: string; address: string };
	message: {
		id: string;
		from: { email: string; name: string | null };
		subject: string | null;
		received_at: string;
	};
}

export interface WebhookHandlerOptions {
	signatureSecret: string | null;
	pushAlert: (alert: PendingAlert) => void;
}

function send(res: ServerResponse, status: number, body: string, contentType = "application/json"): void {
	res.statusCode = status;
	res.setHeader("content-type", contentType);
	res.end(body);
}

async function readBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buf.length;
		if (total > maxBytes) throw new Error("Request body too large");
		chunks.push(buf);
	}
	return Buffer.concat(chunks).toString("utf8");
}

export function createWebhookHandler(options: WebhookHandlerOptions) {
	return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
		if (req.method !== "POST") {
			send(res, 405, JSON.stringify({ error: "Method not allowed" }));
			return true;
		}

		let body: string;
		try {
			body = await readBody(req);
		} catch {
			send(res, 413, JSON.stringify({ error: "Body too large" }));
			return true;
		}

		if (options.signatureSecret) {
			const provided = req.headers["x-clankermails-signature"];
			const providedString = Array.isArray(provided) ? provided[0] : provided;
			if (!providedString) {
				send(res, 401, JSON.stringify({ error: "Missing signature" }));
				return true;
			}
			const expected = await hmacSha256Hex(options.signatureSecret, body);
			if (!constantTimeEqual(providedString, expected)) {
				send(res, 401, JSON.stringify({ error: "Invalid signature" }));
				return true;
			}
		}

		let payload: WebhookPayload;
		try {
			payload = JSON.parse(body) as WebhookPayload;
		} catch {
			send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
			return true;
		}

		if (payload.event !== "message.received" || !payload.inbox?.id || !payload.message?.id) {
			send(res, 200, JSON.stringify({ ok: true, ignored: true }));
			return true;
		}

		options.pushAlert({
			inboxId: payload.inbox.id,
			address: payload.inbox.address,
			count: 1,
			subjects: [payload.message.subject || "(no subject)"],
		});

		send(res, 200, JSON.stringify({ ok: true }));
		return true;
	};
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
	return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return mismatch === 0;
}
