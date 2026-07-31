import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { constantTimeEqual } from "../lib/constant-time";
import { Errors } from "../lib/errors";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";
import { createLogger } from "../lib/logger";
import { isLocalDevelopmentStage } from "../lib/stage";
import { validate } from "../lib/validation";

/**
 * /v1/test/* — dev/staging-only diagnostic routes.
 *
 *   GET  /api-key — exercises constant-time shared-secret header validation
 *   POST /webhook — exercises HMAC signature + replay-window verification
 *
 * Both endpoints return a formatted 404 in production (checked per request —
 * env vars are populated per invocation on Workers, so no module-scope
 * caching). Useful locally and on staging for probing middleware behavior
 * (`tests/integration/test-middleware.sh`).
 */
export const test = new Hono<AppEnv>();

const logger = createLogger({ serviceName: "test-routes" });

// Expose the diagnostics surface ONLY on an explicit allowlist of stages
// (local/development + staging, where test-middleware.sh probes it). Everything
// else — production, an unset STAGE, a typo — gets the same formatted 404 as
// any unknown route. Fail CLOSED, matching the convention in lib/stage.ts
// consumers (auth, CORS, GraphQL introspection): an unknown stage must never
// widen the attack surface.
test.use("*", async (_c, next) => {
	const stage = (process.env.STAGE ?? "").trim().toLowerCase();
	const allowed = stage === "staging" || isLocalDevelopmentStage(stage);
	if (!allowed) {
		throw Errors.NotFound("Route");
	}
	await next();
});

/**
 * @swagger
 * /v1/test/api-key:
 *   get:
 *     summary: Test API key authentication
 *     description: Tests constant-time API key header validation
 *     tags:
 *       - Test
 *     security: []
 *     parameters:
 *       - in: header
 *         name: X-API-Key
 *         required: true
 *         schema:
 *           type: string
 *         description: API key for authentication
 *     responses:
 *       200:
 *         description: API key valid
 *       400:
 *         description: Missing, invalid, or unconfigured API key
 */
test.get("/api-key", (c) => {
	// Missing, unconfigured, and mismatched keys are all 400s under the stable
	// diagnostic-route contract.
	const expected = process.env.TEST_API_KEY || "";
	const provided = c.req.header("x-api-key");

	if (!provided) {
		throw Errors.BadRequest("Missing required header: X-API-Key");
	}
	if (!expected) {
		throw Errors.BadRequest("X-API-Key validation not configured — rejecting");
	}
	if (!constantTimeEqual(provided, expected)) {
		throw Errors.BadRequest("Invalid X-API-Key header value");
	}

	logger.info("API key endpoint accessed");

	return sendSuccess(c, {
		message: "API key authentication successful",
		timestamp: new Date().toISOString(),
	});
});

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const TEST_WEBHOOK_MAX_BYTES = 1 * 1024 * 1024;
const testWebhookBody = z
	.object({
		event: z.string().min(1).max(200).optional(),
	})
	.passthrough();

function verifyHmac(
	signature: string,
	body: string,
	secret: string,
	timestamp: string,
): boolean {
	const signedPayload = `${timestamp}.${body}`;
	const expected = createHmac("sha256", secret)
		.update(signedPayload)
		.digest("hex");
	return constantTimeEqual(
		Buffer.from(signature, "hex"),
		Buffer.from(expected, "hex"),
	);
}

// POST /v1/test/webhook — generic HMAC-verified webhook sink for testing
// signature verification end-to-end (signs `${timestamp}.${rawBody}` with
// WEBHOOK_SECRET, hex-encoded, 5-minute replay window).
/**
 * @swagger
 * /v1/test/webhook:
 *   post:
 *     summary: Test generic HMAC webhook verification
 *     description: Development/staging diagnostic. Signs `timestamp.rawBody` with WEBHOOK_SECRET and enforces a five-minute replay window.
 *     tags: [Test]
 *     security: []
 *     parameters:
 *       - in: header
 *         name: X-Webhook-Signature
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: X-Webhook-Timestamp
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: true }
 *     responses:
 *       200:
 *         description: Signature and timestamp valid
 *       400:
 *         description: Required header missing or body is invalid JSON
 *       401:
 *         description: Signature invalid or timestamp outside the replay window
 *       500:
 *         description: WEBHOOK_SECRET is not configured
 */
test.post("/webhook", async (c) => {
	const webhookSecret = process.env.WEBHOOK_SECRET;
	if (!webhookSecret) {
		throw new Error("WEBHOOK_SECRET environment variable is required");
	}

	const signature = c.req.header("x-webhook-signature");
	if (!signature) {
		throw Errors.BadRequest("Missing required header: X-Webhook-Signature");
	}

	const timestamp = c.req.header("x-webhook-timestamp");
	if (!timestamp) {
		throw Errors.BadRequest("Missing required header: X-Webhook-Timestamp");
	}

	const timestampMs = Number(timestamp);
	if (
		Number.isNaN(timestampMs) ||
		Math.abs(Date.now() - timestampMs) > TIMESTAMP_TOLERANCE_MS
	) {
		logger.error("Webhook timestamp outside tolerance window");
		throw Errors.Unauthorized();
	}

	// Raw body string — this exact byte sequence is what was signed.
	const body = await c.req.text();
	if (Buffer.byteLength(body, "utf8") > TEST_WEBHOOK_MAX_BYTES) {
		throw Errors.BadRequest("Payload too large");
	}
	if (!verifyHmac(signature, body, webhookSecret, timestamp)) {
		throw Errors.Unauthorized();
	}

	let raw: unknown;
	try {
		raw = JSON.parse(body || "{}");
	} catch {
		throw Errors.BadRequest("Invalid JSON body");
	}
	const parsed = validate(testWebhookBody, raw);

	logger.info("Webhook received", { event: parsed.event });

	return sendSuccess(c, {
		message: "Webhook processed successfully",
		timestamp: new Date().toISOString(),
	});
});
