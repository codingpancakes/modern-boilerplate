import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../lib/db";
import { errorMessage } from "../lib/error-utils";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";
import { createLogger } from "../lib/logger";

/**
 * Utility routes (public). Mounted at `/v1` by the barrel in
 * `routes/index.ts` — this module owns the health endpoints only.
 *
 *   GET /health           — liveness + version/stage info
 *   GET /health/detailed  — DB / WorkOS / media-storage checks
 *
 * OPTIONS preflight is answered globally by the CORS middleware in
 * `lib/hono/middleware.ts` (documented below as /v1/utils/options for
 * OpenAPI parity); the janitor and audit-retention jobs are Cron Triggers
 * (`src/node/cron.ts`), not HTTP routes.
 */
export const utils = new Hono<AppEnv>();

const logger = createLogger({ serviceName: "health-detailed" });

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

	if (!clientId) {
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

async function checkMediaStorage(): Promise<HealthCheck> {
	const bucket = process.env.IMAGES_BUCKET;
	const cdnUrl = process.env.IMAGES_CDN_URL;

	if (!bucket || !cdnUrl) {
		return {
			status: "skipped",
			configured: false,
			message: "Media storage not configured",
		};
	}

	// R2 is configured - we don't make actual API calls in health check
	// to avoid costs, just verify configuration exists
	return {
		status: "ok",
		configured: true,
		message: "Media storage configured",
	};
}

/**
 * @swagger
 * /v1/utils/options:
 *   options:
 *     tags: [Utils]
 *     summary: CORS preflight handler
 *     description: Handles OPTIONS preflight requests for CORS. Returns 204 No Content with proper CORS headers.
 *     security: []
 *     responses:
 *       204:
 *         description: No content - CORS preflight successful
 */

/**
 * @swagger
 * /v1/health:
 *   get:
 *     tags: [Utils]
 *     summary: Health check endpoint
 *     description: Returns API health status, version, and environment information. No authentication required.
 *     security: []
 *     responses:
 *       200:
 *         description: API is healthy
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
 *                       example: ok
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-12-05T20:00:00.000Z"
 *                     version:
 *                       type: string
 *                       example: v1
 *                     stage:
 *                       type: string
 *                       example: production
 */
utils.get("/health", (c) => {
	return sendSuccess(c, {
		status: "ok",
		timestamp: new Date().toISOString(),
		version: process.env.API_VERSION || "v1",
		stage: process.env.STAGE || "dev",
	});
});

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
utils.get("/health/detailed", async (c) => {
	// Run all health checks in parallel
	const [database, workos, storage] = await Promise.all([
		checkDatabase(),
		checkWorkOS(),
		checkMediaStorage(),
	]);

	// Determine overall status
	let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

	// Critical: Database must be ok
	if (database.status === "error") {
		overallStatus = "unhealthy";
	}

	// Degraded: External services have issues but not critical
	else if (workos.status === "error" || storage.status === "error") {
		overallStatus = "degraded";
	}

	// Log full details for internal debugging; public response is minimal
	logger.info("Health check completed", {
		status: overallStatus,
		checks: { database, workos, storage },
	});

	const httpStatus = overallStatus === "unhealthy" ? 503 : 200;

	return sendSuccess(
		c,
		{
			status: overallStatus,
			timestamp: new Date().toISOString(),
			version: process.env.API_VERSION || "v1",
		},
		httpStatus,
	);
});
