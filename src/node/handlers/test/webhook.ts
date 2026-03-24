import { createHmac, timingSafeEqual } from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { Errors } from "../../lib/errors";
import { createSuccessResponse } from "../../lib/response";
import { withPublicCors } from "../../lib/withPublicCors";

const logger = new Logger({ serviceName: "test-webhook" });

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
	const sigBuf = Buffer.from(signature, "hex");
	const expBuf = Buffer.from(expected, "hex");
	if (sigBuf.length !== expBuf.length) return false;
	return timingSafeEqual(sigBuf, expBuf);
}

const handlerFn = async (event: APIGatewayProxyEventV2, context: Context) => {
	logger.addContext(context);

	const webhookSecret = process.env.WEBHOOK_SECRET;
	if (!webhookSecret)
		throw new Error("WEBHOOK_SECRET environment variable is required");

	const signature =
		event.headers["x-webhook-signature"] ||
		event.headers["X-Webhook-Signature"];
	if (!signature) {
		throw Errors.BadRequest("Missing required header: X-Webhook-Signature");
	}

	const timestamp =
		event.headers["x-webhook-timestamp"] ||
		event.headers["X-Webhook-Timestamp"];
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

	const body = event.body || "";
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

	return createSuccessResponse({
		message: "Webhook processed successfully",
		received: parsed,
		timestamp: new Date().toISOString(),
	});
};

export const handler = withPublicCors(handlerFn);
