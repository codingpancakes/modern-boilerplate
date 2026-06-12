import { createHmac } from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { idempotencyKeys } from "../db/schema/index";
import { constantTimeEqual } from "../lib/constant-time";
import { getDb } from "../lib/db";
import { errorMessage } from "../lib/error-utils";
import { Errors } from "../lib/errors";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";
import { createLogger } from "../lib/logger";
import {
	deleteOrgFromWorkOS,
	deleteUserFromWorkOS,
	recordAuthEventFromWorkOS,
	upsertOrgFromWorkOS,
	upsertUserFromWorkOS,
} from "../lib/services/user-provisioning";
import { validate, webhookSchemas } from "../lib/validation";
import {
	isWorkOSAuthEvent,
	parseWorkOSAuthData,
	parseWorkOSOrgData,
	parseWorkOSUserData,
} from "../lib/validation/webhooks";

/**
 * /v1/webhooks/* — webhook routes (public; each webhook verifies its own
 * signature/HMAC inside the handler, never via `requireAuth()`).
 *
 *   POST /workos — WorkOS user/org lifecycle events
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
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function verifySignature(
	payload: string,
	signatureHeader: string,
	secret: string,
): boolean {
	// WorkOS signature format: "t=1766861788175, v1=7ade2a063dc936d978bcbc8732ddc7d34f670339953d90c5fce0357841aa763e"
	const parts = signatureHeader.split(", ");
	const timestamp = parts[0]?.split("=")[1];
	const signature = parts[1]?.split("=")[1];

	if (!timestamp || !signature) {
		logger.error("Invalid signature format", { signatureHeader });
		return false;
	}

	const timestampMs = Number(timestamp);
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
	const signedPayload = `${timestamp}.${payload}`;
	const expectedSignature = createHmac("sha256", secret)
		.update(signedPayload)
		.digest("hex");

	return constantTimeEqual(
		Buffer.from(signature, "hex"),
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
 *       Verifies webhook signature and processes events idempotently.
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
 *                       enum: [processed, already_processed]
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
webhooks.post("/workos", async (c) => {
	// Tracked across the try/catch so a failed attempt releases its idempotency
	// lock (status -> "failed") and WorkOS's retry can re-run the event instead
	// of getting a spurious "already processing" 200 and dropping it.
	let idempotencyKey: string | null = null;
	let ownsKey = false;

	try {
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

		// Verify signature
		const secret = getWebhookSecret();
		if (!verifySignature(payload, signature, secret)) {
			logger.error("Invalid webhook signature");
			throw Errors.Unauthorized();
		}
		logger.info("Signature verified");

		// Parse and validate webhook event
		const webhookEvent = validate(webhookSchemas.workos, JSON.parse(payload));

		logger.info("Processing WorkOS webhook", {
			eventId: webhookEvent.id,
			eventType: webhookEvent.event,
		});

		const db = await getDb();

		// Atomic idempotency check using INSERT ON CONFLICT DO NOTHING
		idempotencyKey = `workos-webhook-${webhookEvent.id}`;
		const inserted = await db
			.insert(idempotencyKeys)
			.values({
				key: idempotencyKey,
				requestHash: webhookEvent.id,
				status: "processing",
				expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
			})
			.onConflictDoNothing({ target: idempotencyKeys.key })
			.returning({ key: idempotencyKeys.key });

		if (inserted.length === 0) {
			// Key already exists -- check if completed or reclaimable
			const [existing] = await db
				.select()
				.from(idempotencyKeys)
				.where(eq(idempotencyKeys.key, idempotencyKey))
				.limit(1);

			if (existing?.status === "completed") {
				logger.warn("Duplicate event detected, skipping", { idempotencyKey });
				return sendSuccess(c, { message: "Event already processed" });
			}

			// Atomically (re)claim the key via UPDATE. Reclaim when either:
			//  - a previous attempt FAILED (so WorkOS's retry can re-run it), or
			//  - a "processing" lock is stale (>5 min — the original invocation died).
			// UPDATE-with-predicate (not DELETE+INSERT) keeps this race-free: only one
			// concurrent request can flip the row, the rest get "already processing".
			const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
			const reclaimed = await db
				.update(idempotencyKeys)
				.set({
					status: "processing",
					requestHash: webhookEvent.id,
					createdAt: new Date().toISOString(),
					expiresAt: new Date(
						Date.now() + 7 * 24 * 60 * 60 * 1000,
					).toISOString(),
					updatedAt: new Date().toISOString(),
				})
				.where(
					and(
						eq(idempotencyKeys.key, idempotencyKey),
						or(
							eq(idempotencyKeys.status, "failed"),
							and(
								eq(idempotencyKeys.status, "processing"),
								lt(idempotencyKeys.createdAt, staleThreshold),
							),
						),
					),
				)
				.returning({ key: idempotencyKeys.key });

			if (reclaimed.length === 0) {
				// Another request is actively processing this event
				logger.warn("Event is already being processed", { idempotencyKey });
				return sendSuccess(c, { message: "Event already processing" });
			}

			logger.warn("Reclaimed idempotency key for retry", { idempotencyKey });
		}
		// We now own the lock; a failure past this point must release it (catch).
		ownsKey = true;
		logger.info("Processing event", { idempotencyKey });

		// Authentication-lifecycle events (login / failed login / session) are
		// audited rather than mutating domain tables.
		if (isWorkOSAuthEvent(webhookEvent.event)) {
			const authData = parseWorkOSAuthData(
				webhookEvent.data as Record<string, unknown>,
			);
			await recordAuthEventFromWorkOS(db, authData, webhookEvent.event);
		}

		// Delegate to service-layer functions for each event type
		switch (webhookEvent.event) {
			case "user.created":
			case "user.updated": {
				const userData = parseWorkOSUserData(
					webhookEvent.data as Record<string, unknown>,
				);
				await upsertUserFromWorkOS(db, userData, webhookEvent.event);
				break;
			}

			case "user.deleted": {
				const userData = parseWorkOSUserData(
					webhookEvent.data as Record<string, unknown>,
				);
				await deleteUserFromWorkOS(db, userData, webhookEvent.event);
				break;
			}

			case "organization.created":
			case "organization.updated": {
				const orgData = parseWorkOSOrgData(
					webhookEvent.data as Record<string, unknown>,
				);
				await upsertOrgFromWorkOS(db, orgData, webhookEvent.event);
				break;
			}

			case "organization.deleted": {
				const orgData = parseWorkOSOrgData(
					webhookEvent.data as Record<string, unknown>,
				);
				await deleteOrgFromWorkOS(db, orgData, webhookEvent.event);
				break;
			}
		}

		// Mark idempotency key as completed
		await db
			.update(idempotencyKeys)
			.set({
				status: "completed",
				completedAt: new Date().toISOString(),
			})
			.where(eq(idempotencyKeys.key, idempotencyKey));

		logger.info("Webhook processed successfully", { eventId: webhookEvent.id });

		return sendSuccess(c, { status: "processed" });
	} catch (error) {
		// NOT an error-formatting catch (app.onError owns Sentry + the wire
		// shape) — this exists solely to release our idempotency lock so
		// WorkOS's retry can re-run this event. Without it the key is stranded
		// in "processing" and the retry returns a spurious "already processing"
		// 200, silently dropping the event.
		logger.error("Error processing webhook", {
			error: errorMessage(error),
		});

		if (ownsKey && idempotencyKey) {
			try {
				const db = await getDb();
				await db
					.update(idempotencyKeys)
					.set({ status: "failed", updatedAt: new Date().toISOString() })
					.where(eq(idempotencyKeys.key, idempotencyKey));
			} catch (releaseError) {
				logger.error("Failed to release idempotency lock after error", {
					idempotencyKey,
					error: errorMessage(releaseError),
				});
			}
		}

		throw error;
	}
});
