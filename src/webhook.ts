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

export interface WebhookContext {
	request: Request;
	signatureSecret: string | null;
	pushAlert: (alert: PendingAlert) => void;
}

export async function handleWebhook(ctx: WebhookContext): Promise<Response> {
	if (ctx.request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	const body = await ctx.request.text();

	if (ctx.signatureSecret) {
		const provided = ctx.request.headers.get("x-clankermails-signature");
		if (!provided) return new Response("Missing signature", { status: 401 });

		const expected = await hmacSha256Hex(ctx.signatureSecret, body);
		if (!constantTimeEqual(provided, expected)) {
			return new Response("Invalid signature", { status: 401 });
		}
	}

	let payload: WebhookPayload;
	try {
		payload = JSON.parse(body) as WebhookPayload;
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	if (payload.event !== "message.received" || !payload.inbox?.id || !payload.message?.id) {
		return new Response(JSON.stringify({ ok: true, ignored: true }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}

	ctx.pushAlert({
		inboxId: payload.inbox.id,
		address: payload.inbox.address,
		count: 1,
		subjects: [payload.message.subject || "(no subject)"],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
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
