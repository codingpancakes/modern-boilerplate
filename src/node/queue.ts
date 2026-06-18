import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "./lib/audit";
import { runWithDbScope } from "./lib/db";
import { errorMessage } from "./lib/error-utils";
import { createLogger } from "./lib/logger";
import { captureException } from "./lib/sentry";
import { processWorkosEvent } from "./lib/services/webhook-processor";
import type { WorkOSWebhookEvent } from "./lib/validation/webhooks";
import type { WorkerEnv } from "./worker";

/**
 * Cloudflare Queues consumer — the durable retry path that replaces the
 * webhook DLQ. `worker.queue` (src/node/worker.ts) dispatches every batch here.
 *
 * Two queues land in this one handler, distinguished by `batch.queue`:
 *
 *   - Main webhook queue (`sidedoor-webhooks-*`): each message body is a
 *     verified, Zod-validated WorkOS event. Process it inside a DB scope; ack on
 *     success. On failure, `message.retry()` (do NOT ack) so Queues redelivers,
 *     and after `max_retries` the platform routes it to the dead-letter queue.
 *
 *   - Dead-letter queue (`*-dlq-*`): a message that exhausted its retries. This
 *     is a PERMANENT failure — log it, report to Sentry, and write a durable
 *     audit row so the drop is alertable + on the compliance trail, then ack
 *     (acking drains the DLQ; there is nowhere left to retry to).
 */
const logger = createLogger({ serviceName: "webhook-queue" });

export async function handleQueueBatch(
	batch: MessageBatch<WorkOSWebhookEvent>,
	_env: WorkerEnv,
	_ctx: ExecutionContext,
): Promise<void> {
	const isDeadLetter = batch.queue.includes("dlq");

	for (const message of batch.messages) {
		if (isDeadLetter) {
			await handleDeadLetter(message.body);
			message.ack();
			continue;
		}

		try {
			await runWithDbScope(() => processWorkosEvent(message.body));
			message.ack();
		} catch (error) {
			// Do NOT ack — let Queues redeliver (and eventually dead-letter).
			logger.error("Webhook processing failed; will retry", {
				eventId: message.body?.id,
				eventType: message.body?.event,
				attempts: message.attempts,
				error: errorMessage(error),
			});
			message.retry();
		}
	}
}

/**
 * A webhook event that exhausted every retry. Make the permanent failure
 * durable (audit row) and alertable (Sentry) before acking it off the DLQ.
 */
async function handleDeadLetter(event: WorkOSWebhookEvent): Promise<void> {
	logger.error("Webhook permanently failed (dead-lettered)", {
		eventId: event?.id,
		eventType: event?.event,
	});

	captureException(new Error("Webhook permanently failed"), {
		eventId: event?.id,
		eventType: event?.event,
	});

	// Outside a request scope, logAudit awaits its write inline — so this is
	// durable without an audit-flush middleware around the queue consumer.
	await runWithDbScope(() =>
		logAudit({
			action: AUDIT_ACTIONS.WEBHOOK_FAILED,
			resourceType: AUDIT_RESOURCE_TYPES.WEBHOOK,
			resourceId: event?.id,
			status: AUDIT_STATUS.FAILURE,
			errorMessage: "Webhook permanently failed after exhausting retries",
			metadata: { eventType: event?.event },
		}),
	);
}
