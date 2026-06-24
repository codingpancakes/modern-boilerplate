import { getDb } from "../db";
import { errorMessage } from "../error-utils";
import {
	claimIdempotencyKey,
	completeIdempotencyKey,
	failIdempotencyKey,
} from "../idempotency";
import { createLogger } from "../logger";
import {
	isWorkOSAuthEvent,
	parseWorkOSAuthData,
	parseWorkOSOrgData,
	parseWorkOSUserData,
	type WorkOSWebhookEvent,
} from "../validation/webhooks";
import {
	deleteOrgFromWorkOS,
	deleteUserFromWorkOS,
	recordAuthEventFromWorkOS,
	upsertOrgFromWorkOS,
	upsertUserFromWorkOS,
} from "./user-provisioning";

/**
 * WorkOS webhook processor — the idempotent provisioning core, extracted from
 * the HTTP route so it can run from the Cloudflare Queue consumer
 * (src/node/queue.ts) instead of inline on the ingest path.
 *
 * Signature verification stays on the HTTP ingest path (routes/webhooks.ts);
 * by the time an event reaches here it has already been verified and Zod-
 * validated. This function owns ONLY the race-safe idempotency lock + the
 * event-type switch + provisioning.
 *
 * Failure contract: on any failure past claiming the lock, the lock is set to
 * "failed" and the error is RETHROWN so the queue consumer can `message.retry()`
 * (Queues redelivers, eventually routing to the dead-letter queue). A reclaim
 * of a "failed" or stale ">5min processing" lock lets a redelivery re-run.
 */
const logger = createLogger({ serviceName: "webhook-processor" });

export async function processWorkosEvent(
	webhookEvent: WorkOSWebhookEvent,
): Promise<void> {
	logger.info("Processing WorkOS webhook", {
		eventId: webhookEvent.id,
		eventType: webhookEvent.event,
	});

	const db = await getDb();

	const idempotencyKey = `workos-webhook-${webhookEvent.id}`;
	const claim = await claimIdempotencyKey(db, {
		key: idempotencyKey,
		requestHash: webhookEvent.id,
		completedMode: "return",
		reclaimFailed: true,
		staleProcessingMs: 5 * 60 * 1000,
		resetCreatedAtOnReclaim: true,
		expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
	});

	if (claim.status === "completed") {
		logger.warn("Duplicate event detected, skipping", { idempotencyKey });
		return;
	}
	if (claim.status !== "claimed") {
		// Another attempt is actively processing this event, or the key was
		// malformed/reused in a way this event stream should never produce.
		logger.warn("Event is already being processed", {
			idempotencyKey,
			claimStatus: claim.status,
		});
		return;
	}
	if (claim.source === "reclaimed") {
		logger.warn("Reclaimed idempotency key for retry", { idempotencyKey });
	}
	// We now own the lock; a failure past this point must release it (catch).
	logger.info("Processing event", { idempotencyKey });

	try {
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
		await completeIdempotencyKey(db, idempotencyKey);

		logger.info("Webhook processed successfully", { eventId: webhookEvent.id });
	} catch (error) {
		// Release our idempotency lock (status -> "failed") so a queue redelivery
		// can re-run this event instead of getting a spurious "already processing"
		// short-circuit. Then rethrow so the consumer retries the message.
		logger.error("Error processing webhook", {
			error: errorMessage(error),
		});

		try {
			await failIdempotencyKey(db, idempotencyKey);
		} catch (releaseError) {
			logger.error("Failed to release idempotency lock after error", {
				idempotencyKey,
				error: errorMessage(releaseError),
			});
		}

		throw error;
	}
}
