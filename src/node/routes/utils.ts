import { Logger } from "@aws-lambda-powertools/logger";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../lib/db";
import { errorMessage } from "../lib/error-utils";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";

/**
 * Utility routes (public). Mounted at `/v1` by the barrel in
 * `routes/index.ts` — this module owns the health endpoints only.
 *
 * Ported from the Lambda handlers (which are now thin re-exports of the
 * shared app handler). The @swagger blocks stay in the entry files because
 * `scripts/generate-openapi.js` only globs `src/node/handlers/**`:
 *   GET /health           ← src/node/handlers/utils/health.ts          (API GW: GET /v1/health)
 *   GET /health/detailed  ← src/node/handlers/utils/health-detailed.ts (API GW: GET /v1/health/detailed)
 *
 * NOT ported here:
 *   - handlers/utils/options.ts — OPTIONS preflight (incl. API GW's
 *     OPTIONS /v1/{proxy+}) is answered globally by the CORS middleware in
 *     `lib/hono/middleware.ts`.
 *   - handlers/utils/janitor.ts / audit-retention.ts — scheduled Lambdas,
 *     not HTTP routes.
 */
export const utils = new Hono<AppEnv>();

const logger = new Logger({ serviceName: "health-detailed" });

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

utils.get("/health", (c) => {
	return sendSuccess(c, {
		status: "ok",
		timestamp: new Date().toISOString(),
		version: process.env.API_VERSION || "v1",
		stage: process.env.STAGE || "dev",
	});
});

utils.get("/health/detailed", async (c) => {
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
