import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import type { ScheduledHandler } from "aws-lambda";
import { cleanupExpiredKeys } from "../../lib/idempotency";

const logger = new Logger({ serviceName: "idempotency-janitor" });
const _tracer = new Tracer({ serviceName: "idempotency-janitor" });

export const handler: ScheduledHandler = async (_event, context) => {
	logger.addContext(context);

	try {
		logger.info("Starting idempotency key cleanup");

		const deletedCount = await cleanupExpiredKeys();

		logger.info("Idempotency key cleanup completed", { deletedCount });

		// ScheduledHandler doesn't return anything
	} catch (error) {
		logger.error("Error during cleanup", { error });
		throw error;
	}
};
