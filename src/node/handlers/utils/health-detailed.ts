import { Logger } from "@aws-lambda-powertools/logger";
import { sql } from "drizzle-orm";
import { getDb } from "../../lib/db";
import { errorMessage } from "../../lib/error-utils";
import { createSuccessResponse } from "../../lib/response";
import { withPublicCors } from "../../lib/withPublicCors";

const logger = new Logger({ serviceName: "health-detailed" });

/**
 * @swagger
 * /v1/health/detailed:
 *   get:
 *     tags: [Utils]
 *     summary: Detailed health check endpoint
 *     description: Returns comprehensive health status including database connectivity and external service checks. No authentication required.
 *     security: []
 *     responses:
 *       200:
 *         description: Health check results
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
 *                       enum: [healthy, degraded, unhealthy]
 *                       example: healthy
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     version:
 *                       type: string
 *                       example: v1
 *                     stage:
 *                       type: string
 *                       example: production
 *                     checks:
 *                       type: object
 *                       properties:
 *                         database:
 *                           type: object
 *                           properties:
 *                             status:
 *                               type: string
 *                               enum: [ok, error]
 *                             responseTime:
 *                               type: number
 *                               description: Response time in milliseconds
 *                             message:
 *                               type: string
 *                         workos:
 *                           type: object
 *                           properties:
 *                             status:
 *                               type: string
 *                               enum: [ok, error, skipped]
 *                             configured:
 *                               type: boolean
 *                         s3:
 *                           type: object
 *                           properties:
 *                             status:
 *                               type: string
 *                               enum: [ok, error, skipped]
 *                             configured:
 *                               type: boolean
 */

interface HealthCheck {
	status: "ok" | "error" | "skipped";
	responseTime?: number;
	message?: string;
	configured?: boolean;
}

async function checkDatabase(): Promise<HealthCheck> {
	const start = Date.now();
	try {
		// Simple query to check database connectivity
		const db = await getDb();
		await db.execute(sql`SELECT 1`);
		const responseTime = Date.now() - start;

		return {
			status: "ok",
			responseTime,
			message: "Database connection successful",
		};
	} catch (error) {
		const responseTime = Date.now() - start;
		logger.error("Database health check failed", {
			error: errorMessage(error),
		});
		return {
			status: "error",
			responseTime,
			message: "Database check failed",
		};
	}
}

async function checkWorkOS(): Promise<HealthCheck> {
	const clientId = process.env.WORKOS_CLIENT_ID;
	const secretArn = process.env.WORKOS_SECRET_ARN;

	if (!clientId || !secretArn) {
		return {
			status: "skipped",
			configured: false,
			message: "WorkOS not configured",
		};
	}

	// WorkOS is configured - we don't make actual API calls in health check
	// to avoid rate limits, just verify configuration exists
	return {
		status: "ok",
		configured: true,
		message: "WorkOS configured",
	};
}

async function checkS3(): Promise<HealthCheck> {
	const bucket = process.env.IMAGES_BUCKET;
	const cdnUrl = process.env.IMAGES_CDN_URL;

	if (!bucket || !cdnUrl) {
		return {
			status: "skipped",
			configured: false,
			message: "S3 not configured",
		};
	}

	// S3 is configured - we don't make actual API calls in health check
	// to avoid costs, just verify configuration exists
	return {
		status: "ok",
		configured: true,
		message: "S3 configured",
	};
}

const healthHandler = async () => {
	// Run all health checks in parallel
	const [database, workos, s3] = await Promise.all([
		checkDatabase(),
		checkWorkOS(),
		checkS3(),
	]);

	// Determine overall status
	let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

	// Critical: Database must be ok
	if (database.status === "error") {
		overallStatus = "unhealthy";
	}

	// Degraded: External services have issues but not critical
	else if (workos.status === "error" || s3.status === "error") {
		overallStatus = "degraded";
	}

	// Log full details for internal debugging; public response is minimal
	logger.info("Health check completed", {
		status: overallStatus,
		checks: { database, workos, s3 },
	});

	const httpStatus = overallStatus === "unhealthy" ? 503 : 200;

	return createSuccessResponse(
		{
			status: overallStatus,
			timestamp: new Date().toISOString(),
			version: process.env.API_VERSION || "v1",
		},
		httpStatus,
	);
};

export const handler = withPublicCors(healthHandler);
