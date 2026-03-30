import { createHmac, timingSafeEqual } from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";
import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { and, eq, lt } from "drizzle-orm";
import { idempotencyKeys } from "../../db/schema/index";
import { getDb } from "../../lib/db";
import { errorMessage } from "../../lib/error-utils";
import { Errors, formatError } from "../../lib/errors";
import { createSuccessResponse } from "../../lib/response";
import * as Sentry from "../../lib/sentry";
import {
	deleteOrgFromWorkOS,
	deleteUserFromWorkOS,
	upsertOrgFromWorkOS,
	upsertUserFromWorkOS,
} from "../../lib/services/user-provisioning";
import { validate, webhookSchemas } from "../../lib/validation";
import {
	parseWorkOSOrgData,
	parseWorkOSUserData,
} from "../../lib/validation/webhooks";
import { withPublicCors } from "../../lib/withPublicCors";

const logger = new Logger({ serviceName: "workos-webhook" });

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

// WorkOS webhook data types are now validated via Zod in validation/webhooks.ts

let _cachedWebhookSecret: string | null = null;
let _secretCachedAt = 0;
const SECRET_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getWebhookSecret(): Promise<string> {
	if (process.env.WORKOS_WEBHOOK_SECRET) {
		return process.env.WORKOS_WEBHOOK_SECRET;
	}

	if (_cachedWebhookSecret && Date.now() - _secretCachedAt < SECRET_TTL_MS) {
		return _cachedWebhookSecret;
	}

	const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
	const command = new GetSecretValueCommand({
		SecretId: process.env.WORKOS_SECRET_ARN,
	});

	const response = await client.send(command);
	if (!response.SecretString) {
		throw new Error("Failed to retrieve webhook secret");
	}

	const secret: unknown = JSON.parse(response.SecretString);
	if (
		typeof secret !== "object" ||
		secret === null ||
		typeof (secret as Record<string, unknown>).webhookSecret !== "string"
	) {
		throw new Error(
			"Webhook secret JSON missing required 'webhookSecret' string field",
		);
	}

	_cachedWebhookSecret = (secret as Record<string, string>).webhookSecret;
	_secretCachedAt = Date.now();
	return _cachedWebhookSecret;
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

	const sigBuffer = Buffer.from(signature, "hex");
	const expectedBuffer = Buffer.from(expectedSignature, "hex");

	// Reject immediately if lengths differ (avoids timingSafeEqual throwing)
	if (sigBuffer.length !== expectedBuffer.length) {
		return false;
	}

	return timingSafeEqual(sigBuffer, expectedBuffer);
}

const webhookHandler = async (
	event: APIGatewayProxyEventV2,
	context: Context,
) => {
	const requestId = context.awsRequestId;
	logger.addContext(context);

	try {
		logger.info("Webhook received", {
			hasSignature: !!(
				event.headers["workos-signature"] || event.headers["WorkOS-Signature"]
			),
			bodyLength: event.body?.length ?? 0,
		});

		// Reject oversized payloads before any parsing (DoS protection)
		const MAX_PAYLOAD_BYTES = 1 * 1024 * 1024; // 1 MB
		if ((event.body?.length ?? 0) > MAX_PAYLOAD_BYTES) {
			logger.error("Webhook payload too large", { size: event.body?.length });
			throw Errors.BadRequest("Payload too large");
		}

		// Get signature from headers
		const signature =
			event.headers["workos-signature"] || event.headers["WorkOS-Signature"];
		if (!signature) {
			logger.error("No signature in headers");
			throw Errors.Unauthorized();
		}

		// Verify signature
		const secret = await getWebhookSecret();
		const payload = event.body || "";

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
		const idempotencyKey = `workos-webhook-${webhookEvent.id}`;
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
			// Key already exists -- check if completed or stale processing
			const [existing] = await db
				.select()
				.from(idempotencyKeys)
				.where(eq(idempotencyKeys.key, idempotencyKey))
				.limit(1);

			if (existing?.status === "completed") {
				logger.warn("Duplicate event detected, skipping", { idempotencyKey });
				return createSuccessResponse({ message: "Event already processed" });
			}

			// Atomically reclaim a stale processing key (older than 5 min) via UPDATE.
			// Using UPDATE instead of DELETE+INSERT prevents a race where two concurrent
			// requests both see the stale key and both proceed.
			const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
			const reclaimed = await db
				.update(idempotencyKeys)
				.set({
					requestHash: webhookEvent.id,
					expiresAt: new Date(
						Date.now() + 7 * 24 * 60 * 60 * 1000,
					).toISOString(),
					updatedAt: new Date().toISOString(),
				})
				.where(
					and(
						eq(idempotencyKeys.key, idempotencyKey),
						eq(idempotencyKeys.status, "processing"),
						lt(idempotencyKeys.createdAt, staleThreshold),
					),
				)
				.returning({ key: idempotencyKeys.key });

			if (reclaimed.length === 0) {
				// Another request is actively processing this event
				logger.warn("Event is already being processed", { idempotencyKey });
				return createSuccessResponse({ message: "Event already processing" });
			}

			logger.warn("Reclaimed stale processing key", { idempotencyKey });
		}
		logger.info("Processing event", { idempotencyKey });

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

		return createSuccessResponse({ status: "processed" });
	} catch (error) {
		logger.error("Error processing webhook", {
			error: errorMessage(error),
		});
		Sentry.captureException(
			error instanceof Error ? error : new Error(String(error)),
		);
		await Sentry.flush();
		return formatError(error, requestId);
	}
};

export const handler = withPublicCors(webhookHandler);
