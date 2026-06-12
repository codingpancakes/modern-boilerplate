// Cron Trigger job — dispatched via the registry in src/node/cron.ts
// ("0 5 * * *" in wrangler.toml [triggers]).
import { cleanupExpiredAuditLogs } from "../../lib/audit";
import { errorMessage } from "../../lib/error-utils";
import { createLogger } from "../../lib/logger";

const logger = createLogger({ serviceName: "audit-retention" });

/**
 * Daily job that prunes audit logs past the SOC 2 retention window.
 * Deletion of in-window rows is blocked by the `audit_logs_guard` DB trigger,
 * so this job can only ever remove genuinely expired entries. Throws on
 * failure so the platform records a failed cron invocation.
 */
export async function runAuditRetention(): Promise<void> {
	try {
		logger.info("Starting audit log retention cleanup");

		const deletedCount = await cleanupExpiredAuditLogs();

		logger.info("Audit log retention cleanup completed", { deletedCount });
	} catch (error) {
		logger.error("Error during audit log retention cleanup", {
			error: errorMessage(error),
		});
		throw error;
	}
}
