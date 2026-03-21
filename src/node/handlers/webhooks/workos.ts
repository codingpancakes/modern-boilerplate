import { createHmac, timingSafeEqual } from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";

import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { and, eq } from "drizzle-orm";
import {
	authIdentities,
	idempotencyKeys,
	organizations,
	profiles,
	users,
} from "../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "../../lib/audit";
import { getDb } from "../../lib/db";
import { Errors, formatError } from "../../lib/errors";
import { createSuccessResponse } from "../../lib/response";
import { validate, webhookSchemas } from "../../lib/validation";
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

// WorkOS webhook data types
interface WorkOSUserData {
	id: string;
	email: string;
	first_name: string;
	last_name: string;
	[key: string]: unknown;
}

interface WorkOSOrgData {
	id: string;
	name: string;
	[key: string]: unknown;
}

async function getWebhookSecret(): Promise<string> {
	logger.info("Getting webhook secret", {
		hasEnvVar: !!process.env.WORKOS_WEBHOOK_SECRET,
		hasSecretArn: !!process.env.WORKOS_SECRET_ARN,
	});

	// For local development, use env var directly
	if (process.env.WORKOS_WEBHOOK_SECRET) {
		logger.info("Using local WORKOS_WEBHOOK_SECRET");
		return process.env.WORKOS_WEBHOOK_SECRET;
	}

	// For deployed environments, fetch from Secrets Manager
	const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
	const command = new GetSecretValueCommand({
		SecretId: process.env.WORKOS_SECRET_ARN,
	});

	const response = await client.send(command);
	if (response.SecretString) {
		const secret = JSON.parse(response.SecretString);
		const webhookSecret = secret.webhookSecret;
		if (!webhookSecret) {
			throw new Error("WORKOS_WEBHOOK_SECRET not found in secrets");
		}

		return webhookSecret;
	}

	throw new Error("Failed to retrieve webhook secret");
}

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

		// Check for duplicate event (idempotency) using WorkOS event ID
		const idempotencyKey = `workos-webhook-${webhookEvent.id}`;
		const [existing] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, idempotencyKey))
			.limit(1);

		if (existing && existing.status === "completed") {
			logger.warn("Duplicate event detected, skipping", { idempotencyKey });
			return createSuccessResponse({ message: "Event already processed" });
		}

		if (existing && existing.status === "processing") {
			// Previous attempt failed mid-processing -- delete stale key and retry
			logger.warn("Found stale processing key, retrying", {
				idempotencyKey,
			});
			await db
				.delete(idempotencyKeys)
				.where(eq(idempotencyKeys.key, idempotencyKey));
		}
		logger.info("New event, processing");

		// Store idempotency key
		await db.insert(idempotencyKeys).values({
			key: idempotencyKey,
			requestHash: webhookEvent.id,
			status: "processing",
			expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
		});

		// Process based on event type
		switch (webhookEvent.event) {
			case "user.created":
			case "user.updated": {
				const userData = webhookEvent.data as WorkOSUserData;

				// First, check if user exists via auth_identities
				const [existingAuth] = await db
					.select({ userId: authIdentities.userId })
					.from(authIdentities)
					.where(
						and(
							eq(authIdentities.providerType, "workos"),
							eq(authIdentities.providerSubject, userData.id),
						),
					)
					.limit(1);

				if (existingAuth?.userId) {
					logger.info("User exists, updating", {
						userId: existingAuth.userId,
					});
					// Update existing user
					await db
						.update(users)
						.set({
							email: userData.email,
							firstName: userData.first_name,
							lastName: userData.last_name,
							updatedAt: new Date().toISOString(),
						})
						.where(eq(users.id, existingAuth.userId));

					// Audit log: Track user update from WorkOS
					await logAudit({
						userId: existingAuth.userId,
						action: AUDIT_ACTIONS.UPDATE,
						resourceType: AUDIT_RESOURCE_TYPES.USER,
						resourceId: existingAuth.userId,
						status: AUDIT_STATUS.SUCCESS,
						metadata: {
							source: "workos_webhook",
							eventType: webhookEvent.event,
							providerSubject: userData.id,
						},
					});
				} else {
					logger.info("Creating new user", { providerSubject: userData.id });
					// Create new user and auth identity
					const [newUser] = await db
						.insert(users)
						.values({
							email: userData.email,
							firstName: userData.first_name,
							lastName: userData.last_name,
							type: "MEMBER",
						})
						.returning({ id: users.id });

					logger.info("Creating profile", { userId: newUser.id });
					// Create profile record
					await db.insert(profiles).values({
						userId: newUser.id,
					});

					logger.info("Creating auth identity", {
						userId: newUser.id,
						providerSubject: userData.id,
					});
					// Create auth identity
					await db.insert(authIdentities).values({
						userId: newUser.id,
						providerType: "workos",
						providerSubject: userData.id,
						emailAtProvider: userData.email,
					});

					logger.info("Creating audit log", { userId: newUser.id });
					// Audit log: Track user creation from WorkOS
					await logAudit({
						userId: newUser.id,
						action: AUDIT_ACTIONS.CREATE,
						resourceType: AUDIT_RESOURCE_TYPES.USER,
						resourceId: newUser.id,
						status: AUDIT_STATUS.SUCCESS,
						metadata: {
							source: "workos_webhook",
							eventType: webhookEvent.event,
							providerSubject: userData.id,
						},
					});

					logger.info("User created successfully", {
						userId: newUser.id,
						providerSubject: userData.id,
					});
				}
				break;
			}

			case "user.deleted": {
				const userData = webhookEvent.data as WorkOSUserData;

				// Find user via auth_identities and delete
				const [authIdentity] = await db
					.select({ userId: authIdentities.userId })
					.from(authIdentities)
					.where(
						and(
							eq(authIdentities.providerType, "workos"),
							eq(authIdentities.providerSubject, userData.id),
						),
					)
					.limit(1);

				if (authIdentity?.userId) {
					await db.delete(users).where(eq(users.id, authIdentity.userId));

					await logAudit({
						userId: authIdentity.userId,
						action: AUDIT_ACTIONS.DELETE,
						resourceType: AUDIT_RESOURCE_TYPES.USER,
						resourceId: authIdentity.userId,
						status: AUDIT_STATUS.SUCCESS,
						metadata: {
							source: "workos_webhook",
							eventType: webhookEvent.event,
							providerSubject: userData.id,
						},
					});
				}
				break;
			}

			case "organization.created":
			case "organization.updated": {
				const orgData = webhookEvent.data as WorkOSOrgData;

				const [org] = await db
					.insert(organizations)
					.values({
						workosOrgId: orgData.id,
						name: orgData.name,
					})
					.onConflictDoUpdate({
						target: organizations.workosOrgId,
						set: {
							name: orgData.name,
							updatedAt: new Date().toISOString(),
						},
					})
					.returning({ id: organizations.id });

				await logAudit({
					organizationId: org?.id,
					action:
						webhookEvent.event === "organization.created"
							? AUDIT_ACTIONS.CREATE
							: AUDIT_ACTIONS.UPDATE,
					resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
					resourceId: org?.id,
					status: AUDIT_STATUS.SUCCESS,
					metadata: {
						source: "workos_webhook",
						eventType: webhookEvent.event,
						workosOrgId: orgData.id,
					},
				});
				break;
			}

			case "organization.deleted": {
				const orgData = webhookEvent.data as WorkOSOrgData;

				const [deleted] = await db
					.select({ id: organizations.id })
					.from(organizations)
					.where(eq(organizations.workosOrgId, orgData.id))
					.limit(1);

				await db
					.delete(organizations)
					.where(eq(organizations.workosOrgId, orgData.id));

				if (deleted) {
					await logAudit({
						organizationId: deleted.id,
						action: AUDIT_ACTIONS.DELETE,
						resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
						resourceId: deleted.id,
						status: AUDIT_STATUS.SUCCESS,
						metadata: {
							source: "workos_webhook",
							eventType: webhookEvent.event,
							workosOrgId: orgData.id,
						},
					});
				}
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
		logger.error("Error processing webhook", { error });
		return formatError(error, requestId);
	}
};

export const handler = withPublicCors(webhookHandler);
