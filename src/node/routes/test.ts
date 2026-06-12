import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { constantTimeEqual } from "../lib/constant-time";
import { Errors } from "../lib/errors";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";
import { createLogger } from "../lib/logger";

/**
 * /v1/test/* — dev-only diagnostic routes (Hono port of the old
 * `handlers/test/` Lambdas, which never had an API Gateway route and were
 * only reachable through the deleted Express dev shim).
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

// Hide the diagnostics surface entirely in production: indistinguishable
// from any other unknown route (same formatted 404 wire shape).
test.use("*", async (_c, next) => {
	if (process.env.STAGE === "production") {
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
 *       401:
 *         description: Invalid or missing API key
 */
test.get("/api-key", (c) => {
	// Same wire behavior as the old `withApiKey` wrapper: missing header and
	// unconfigured/mismatched keys are all 400s with these exact messages.
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
	if (!verifyHmac(signature, body, webhookSecret, timestamp)) {
		throw Errors.Unauthorized();
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(body || "{}");
	} catch {
		throw Errors.BadRequest("Invalid JSON body");
	}

	logger.info("Webhook received", { event: parsed.event });

	return sendSuccess(c, {
		message: "Webhook processed successfully",
		timestamp: new Date().toISOString(),
	});
});
