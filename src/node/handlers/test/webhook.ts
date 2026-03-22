import { createHmac, timingSafeEqual } from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { Errors } from "../../lib/errors";
import { createSuccessResponse } from "../../lib/response";
import { withPublicCors } from "../../lib/withPublicCors";

const logger = new Logger({ serviceName: "test-webhook" });

function verifyHmac(signature: string, body: string, secret: string): boolean {
	const expected = createHmac("sha256", secret).update(body).digest("hex");
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

	const body = event.body || "";
	if (!verifyHmac(signature, body, webhookSecret)) {
		throw Errors.Unauthorized();
	}

	const parsed = JSON.parse(body || "{}");
	logger.info("Webhook received", { event: parsed.event });

	return createSuccessResponse({
		message: "Webhook processed successfully",
		received: parsed,
		timestamp: new Date().toISOString(),
	});
};

export const handler = withPublicCors(handlerFn);
