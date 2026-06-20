import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { constantTimeEqual } from "../lib/constant-time";
import { runWithDbScope } from "../lib/db";
import { Errors } from "../lib/errors";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";
import { createLogger } from "../lib/logger";
import { processWorkosEvent } from "../lib/services/webhook-processor";
import { validate, webhookSchemas } from "../lib/validation";

/**
 * /v1/webhooks/* — webhook routes (public; each webhook verifies its own
 * signature/HMAC inside the handler, never via `requireAuth()`).
 *
 *   POST /workos — WorkOS user/org lifecycle events
 *
 * This route is INGEST-ONLY: it reads the raw body, enforces the size limit,
 * verifies the HMAC signature, Zod-validates the event, then enqueues it onto
 * the Cloudflare Queue (`c.env.WEBHOOK_QUEUE`) and returns 200 immediately. The
 * idempotency lock + provisioning switch run in the queue consumer
 * (lib/services/webhook-processor.ts via src/node/queue.ts), so retries and the
 * dead-letter queue give durability that a synchronous handler could not.
 *
 * Local dev / the Node test server have no queue binding; there the route falls
 * back to processing the event inline (inside a DB scope) so behaviour is
 * unchanged without a real queue.
 *
 * Signature verification MUST run against the raw request body string
 * (`c.req.text()`) — never a re-serialized JSON.parse/stringify round-trip,
 * which would change byte order/whitespace and break the HMAC.
 */
export const webhooks = new Hono<AppEnv>();

const logger = createLogger({ serviceName: "workos-webhook" });

// WorkOS webhook data types are validated via Zod in validation/webhooks.ts

/**
 * WORKOS_WEBHOOK_SECRET env only (wrangler secret / .dev.vars) — read per
 * request, never cached at module init. Missing config is a server error
 * (500), not a 401: the request isn't unauthorized, we are misconfigured.
 */
function getWebhookSecret(): string {
	const secret = process.env.WORKOS_WEBHOOK_SECRET;
	if (!secret) {
		throw new Error("WORKOS_WEBHOOK_SECRET is not configured");
	}
	return secret;
}

// Reject webhook payloads older than 5 minutes to prevent replay attacks
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function parseWorkosSignatureHeader(
	signatureHeader: string,
): { timestamp: string; signature: string } | null {
	let timestamp = "";
	let signature = "";

	for (const part of signatureHeader.split(",")) {
		const [rawKey, ...rawValue] = part.trim().split("=");
		const key = rawKey?.trim();
		const value = rawValue.join("=").trim();
		if (!key || !value) continue;
		if (key === "t") timestamp = value;
		if (key === "v1") signature = value;
	}

	if (!timestamp || !signature) return null;
	if (!/^[a-f0-9]{64}$/i.test(signature)) return null;
	return { timestamp, signature };
}

export function verifyWorkosSignature(
	payload: string,
	signatureHeader: string,
	secret: string,
): boolean {
	// WorkOS signature format: "t=1766861788175, v1=7ade2a063dc936d978bcbc8732ddc7d34f670339953d90c5fce0357841aa763e"
	const parsed = parseWorkosSignatureHeader(signatureHeader);
	if (!parsed) {
		logger.error("Invalid signature format", { signatureHeader });
		return false;
	}

	const timestampMs = Number(parsed.timestamp);
	const now = Date.now();
	if (
		Number.isNaN(timestampMs) ||
		Math.abs(now - timestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS
	) {
		logger.error("Webhook timestamp outside tolerance window", {
			timestampMs,
			now,
			differenceMs: Math.abs(now - timestampMs),
			toleranceMs: WEBHOOK_TIMESTAMP_TOLERANCE_MS,
		});
		return false;
	}

	// WorkOS signs: timestamp.payload
	const signedPayload = `${parsed.timestamp}.${payload}`;
	const expectedSignature = createHmac("sha256", secret)
		.update(signedPayload)
		.digest("hex");

	return constantTimeEqual(
		Buffer.from(parsed.signature, "hex"),
		Buffer.from(expectedSignature, "hex"),
	);
}

/**
 * @swagger
 * /v1/webhooks/workos:
 *   post:
 *     tags: [Webhooks]
 *     summary: WorkOS webhook handler
 *     description: |
 *       Handles WorkOS webhook events for user and organization lifecycle management.
 *       Verifies the webhook signature, then enqueues the event onto a Cloudflare
 *       Queue for durable, idempotent processing (with retries + a dead-letter
 *       queue). Returns 200 as soon as the event is queued.
 *
 *       **Supported Events:**
 *       - `user.created` - Creates new user and auth identity
 *       - `user.updated` - Updates existing user data
 *       - `user.deleted` - Removes user and auth identity
 *       - `organization.created` - Creates new organization
 *       - `organization.updated` - Updates organization data
 *       - `organization.deleted` - Removes organization
 *
 *       **Security:** Requires valid WorkOS webhook signature in headers.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 description: Unique event ID
 *                 example: "evt_01H1234567890ABCDEFGHIJK"
 *               event:
 *                 type: string
 *                 description: Event type
 *                 enum: [user.created, user.updated, user.deleted, organization.created, organization.updated, organization.deleted]
 *                 example: "user.created"
 *               data:
 *                 type: object
 *                 description: Event payload (varies by event type)
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [queued]
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
webhooks.post("/workos", async (c) => {
	// Raw body string — this exact byte sequence is what WorkOS signed.
	const payload = await c.req.text();
	const signature = c.req.header("workos-signature");

	logger.info("Webhook received", {
		hasSignature: !!signature,
		bodyLength: payload.length,
	});

	// Reject oversized payloads before any parsing (DoS protection)
	const MAX_PAYLOAD_BYTES = 1 * 1024 * 1024; // 1 MB
	if (payload.length > MAX_PAYLOAD_BYTES) {
		logger.error("Webhook payload too large", { size: payload.length });
		throw Errors.BadRequest("Payload too large");
	}

	if (!signature) {
		logger.error("No signature in headers");
		throw Errors.Unauthorized();
	}

	// Verify signature against the raw body — this stays on the ingest path and
	// must never move to the queue consumer (the raw bytes only exist here).
	const secret = getWebhookSecret();
	if (!verifyWorkosSignature(payload, signature, secret)) {
		logger.error("Invalid webhook signature");
		throw Errors.Unauthorized();
	}
	logger.info("Signature verified");

	// Parse and validate webhook event
	const webhookEvent = validate(webhookSchemas.workos, JSON.parse(payload));

	if (c.env.WEBHOOK_QUEUE) {
		// Durable path: hand the verified event to Cloudflare Queues. Retries +
		// the dead-letter queue (see src/node/queue.ts) provide the durability
		// the synchronous handler could not.
		await c.env.WEBHOOK_QUEUE.send(webhookEvent);
		logger.info("Webhook queued", {
			eventId: webhookEvent.id,
			eventType: webhookEvent.event,
		});
	} else {
		// Local dev / Node test server: no queue binding. Process inline inside a
		// DB scope so behaviour is unchanged without a real queue. A failure here
		// throws and surfaces as a 500 (WorkOS will retry the delivery).
		logger.info("No WEBHOOK_QUEUE binding; processing inline", {
			eventId: webhookEvent.id,
			eventType: webhookEvent.event,
		});
		await runWithDbScope(() => processWorkosEvent(webhookEvent));
	}

	return sendSuccess(c, { status: "queued" });
});
