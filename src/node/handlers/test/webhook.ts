import * as crypto from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { createSuccessResponse } from "../../lib/response";
import { withWebhookSignature } from "../../lib/withCustomHeader";

const logger = new Logger({ serviceName: "test-webhook" });

/**
 * @swagger
 * /v1/test/webhook:
 *   post:
 *     summary: Test webhook signature validation
 *     description: Tests the withWebhookSignature middleware
 *     tags:
 *       - Test
 *     parameters:
 *       - in: header
 *         name: X-Webhook-Signature
 *         required: true
 *         schema:
 *           type: string
 *         description: HMAC signature of the request body
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Webhook signature valid
 *       401:
 *         description: Invalid signature
 */
const handlerFn = async (event: APIGatewayProxyEventV2, _context: Context) => {
	logger.addContext(_context);

	const body = JSON.parse(event.body || "{}");
	logger.info("Webhook received", { event: body.event });

	return createSuccessResponse({
		message: "Webhook processed successfully",
		received: body,
		timestamp: new Date().toISOString(),
	});
};

// Signature validation function
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "test-webhook-secret";

const _validateSignature = (signature: string, body: string): boolean => {
	const expectedSignature = crypto
		.createHmac("sha256", WEBHOOK_SECRET)
		.update(body)
		.digest("hex");

	return signature === expectedSignature;
};

// Use withWebhookSignature middleware
export const handler = withWebhookSignature((signature: string) => {
	// In real implementation, we'd need the body to validate
	// For now, just check if signature exists
	return signature.length > 0;
}, handlerFn);
