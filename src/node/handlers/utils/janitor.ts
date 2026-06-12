// Cron Trigger job — dispatched via the registry in src/node/cron.ts
// ("0 4 * * *" in wrangler.toml [triggers]).
import { errorMessage } from "../../lib/error-utils";
import { cleanupExpiredKeys } from "../../lib/idempotency";
import { createLogger } from "../../lib/logger";

const logger = createLogger({ serviceName: "idempotency-janitor" });

/**
 * Daily janitor job — deletes expired idempotency keys. Throws on failure so
 * the platform records a failed cron invocation (the DLQ-alarm equivalent).
 */
export async function runJanitor(): Promise<void> {
	try {
		logger.info("Starting idempotency key cleanup");

		const deletedCount = await cleanupExpiredKeys();

		logger.info("Idempotency key cleanup completed", { deletedCount });
	} catch (error) {
		logger.error("Error during cleanup", {
			error: errorMessage(error),
		});
		throw error;
	}
}
