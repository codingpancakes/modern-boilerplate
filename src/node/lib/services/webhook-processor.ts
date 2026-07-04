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

/** How long a "processing" claim may sit before a redelivery may steal it. */
export const WEBHOOK_STALE_PROCESSING_MS = 5 * 60 * 1000;

/**
 * Thrown when an event's idempotency lock is held by another (possibly
 * crashed) attempt. The consumer must NOT ack — it retries with a delay of at
 * least the staleness window so the redelivery can reclaim the lock. Acking
 * here would permanently drop the event: WorkOS already got its 200 at
 * ingest, so the queue message is the only copy left.
 */
export class WebhookInProgressError extends Error {
	readonly retryDelaySeconds = Math.ceil(WEBHOOK_STALE_PROCESSING_MS / 1000);

	constructor(idempotencyKey: string, claimStatus: string) {
		super(
			`Webhook event lock is held (status: ${claimStatus}) for ${idempotencyKey}; retry after the staleness window`,
		);
		this.name = "WebhookInProgressError";
	}
}

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
		staleProcessingMs: WEBHOOK_STALE_PROCESSING_MS,
		resetCreatedAtOnReclaim: true,
		expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
	});

	if (claim.status === "completed") {
		logger.warn("Duplicate event detected, skipping", { idempotencyKey });
		return;
	}
	if (claim.status !== "claimed") {
		// Another attempt holds the lock — either it is actively processing or it
		// crashed mid-flight (isolate eviction, deploy) and its "processing" row
		// is not yet stale. Do NOT treat this as success: throw so the consumer
		// retries after the staleness window, at which point the lock is either
		// completed (dedup no-op) or stale (reclaimed and re-run).
		logger.warn("Event lock held; deferring to redelivery", {
			idempotencyKey,
			claimStatus: claim.status,
		});
		throw new WebhookInProgressError(idempotencyKey, claim.status);
	}
	if (claim.source === "reclaimed") {
		logger.warn("Reclaimed idempotency key for retry", { idempotencyKey });
	}
	// We now own the lock; a failure past this point must release it (catch).
	logger.info("Processing event", { idempotencyKey });

	try {
		// Authentication-lifecycle events (login / failed login / session) are
		// audited rather than mutating domain tables. Write the audit row AND
		// mark the key completed in ONE transaction: otherwise a crash between
		// the audit commit and the (separate) completion would leave the key
		// "processing", and a post-stale-window reclaim would re-run this and
		// write a DUPLICATE login row into the append-only, un-dedupable trail.
		// Atomic completion makes the auth path exactly-once.
		if (isWorkOSAuthEvent(webhookEvent.event)) {
			const authData = parseWorkOSAuthData(
				webhookEvent.data as Record<string, unknown>,
			);
			await db.transaction(async (tx) => {
				await recordAuthEventFromWorkOS(tx, authData, webhookEvent.event);
				await completeIdempotencyKey(tx, idempotencyKey);
			});
			logger.info("Webhook processed successfully", {
				eventId: webhookEvent.id,
			});
			return;
		}

		// Delegate to service-layer functions for each event type. NOTE: domain
		// provisioning is idempotent (upserts converge), but each provisioning
		// function opens its own transaction and the completion below is a
		// separate statement — so a crash in that narrow window can, after a
		// reclaim, write a duplicate CREATE/UPDATE audit row. Domain STATE stays
		// correct; only the audit trail may gain a duplicate. This is the
		// accepted at-least-once cost for the domain path (folding completion
		// into each provisioning tx conflicts with the email-collision escape
		// hatch in upsertUserFromWorkOS).
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
