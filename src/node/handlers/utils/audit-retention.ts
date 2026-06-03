import { Logger } from "@aws-lambda-powertools/logger";
import type { ScheduledHandler } from "aws-lambda";
import { cleanupExpiredAuditLogs } from "../../lib/audit";
import { errorMessage } from "../../lib/error-utils";

const logger = new Logger({ serviceName: "audit-retention" });

/**
 * Scheduled job that prunes audit logs past the SOC 2 retention window.
 * Deletion of in-window rows is blocked by the `audit_logs_guard` DB trigger,
 * so this job can only ever remove genuinely expired entries.
 */
export const handler: ScheduledHandler = async (_event, context) => {
	logger.addContext(context);

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
};
