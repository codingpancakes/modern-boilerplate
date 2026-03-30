import { Logger } from "@aws-lambda-powertools/logger";
import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { type NeonQueryFunction, neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "../db/schema/index";
import { errorMessage } from "./error-utils";

const logger = new Logger({ serviceName: "db" });

export type DbInstance = NeonHttpDatabase<typeof schema>;

let dbInstance: DbInstance | null = null;
let dbInitPromise: Promise<DbInstance> | null = null;
let dbUrl: string | null = null;
let dbUrlCachedAt: number | null = null;
const DB_URL_TTL_MS = 15 * 60 * 1000;
let connectionAttempts = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

async function getDbUrl(): Promise<string> {
	// Option 1: Use DATABASE_URL from environment (no TTL — env vars don't rotate)
	if (process.env.DATABASE_URL) {
		if (!dbUrl) dbUrl = process.env.DATABASE_URL;
		return dbUrl;
	}

	// Option 2: Fetch from Secrets Manager — apply TTL so rotation is picked up
	if (process.env.DB_SECRET_ARN) {
		const expired =
			!dbUrl || !dbUrlCachedAt || Date.now() - dbUrlCachedAt >= DB_URL_TTL_MS;

		if (!expired && dbUrl) return dbUrl;

		// Cache expired or missing — reset instance so it reconnects with new URL
		dbInstance = null;
		dbUrl = null;

		const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
		const command = new GetSecretValueCommand({
			SecretId: process.env.DB_SECRET_ARN,
		});

		try {
			const response = await client.send(command);
			if (response.SecretString) {
				const secret = JSON.parse(response.SecretString) as Record<
					string,
					unknown
				>;

				if (
					typeof secret.url === "string" &&
					secret.url.startsWith("postgresql")
				) {
					dbUrl = secret.url;
					dbUrlCachedAt = Date.now();
					return dbUrl;
				}

				// Fallback: RDS-style secret with individual fields
				if (
					typeof secret.username === "string" &&
					typeof secret.password === "string" &&
					typeof secret.host === "string" &&
					typeof secret.database === "string"
				) {
					const sslmode =
						typeof secret.sslmode === "string" ? secret.sslmode : "require";
					const channelBinding =
						typeof secret.channel_binding === "string"
							? `&channel_binding=${secret.channel_binding}`
							: "";
					dbUrl = `postgresql://${encodeURIComponent(secret.username as string)}:${encodeURIComponent(secret.password as string)}@${secret.host}:${secret.port || 5432}/${secret.database}?sslmode=${sslmode}${channelBinding}`;
					dbUrlCachedAt = Date.now();
					return dbUrl;
				}

				throw new Error(
					"Secret JSON missing required fields (url or username/password/host/database)",
				);
			}
		} catch (error) {
			logger.error("Failed to retrieve database secret", {
				error: errorMessage(error),
			});
			throw new Error("Failed to retrieve database credentials");
		}
	}

	throw new Error("DATABASE_URL or DB_SECRET_ARN must be configured");
}

/**
 * Get database instance with connection pooling and retry logic
 *
 * @throws Error if connection fails after retries
 * @returns Drizzle database instance
 */
function isDbUrlExpired(): boolean {
	if (process.env.DATABASE_URL) return false;
	if (!process.env.DB_SECRET_ARN) return false;
	return !dbUrlCachedAt || Date.now() - dbUrlCachedAt >= DB_URL_TTL_MS;
}

export async function getDb(): Promise<DbInstance> {
	// Check TTL even when dbInstance exists so secret rotation is picked up
	if (dbInstance && !isDbUrlExpired()) return dbInstance;

	// Reuse in-flight init to prevent concurrent callers from creating duplicates
	if (!dbInitPromise) {
		dbInitPromise = (async () => {
			const url = await getDbUrl();
			const db = await createDbConnection(url);
			dbInstance = db;
			return db;
		})().finally(() => {
			dbInitPromise = null;
		});
	}

	return dbInitPromise;
}

/**
 * Create database connection with optimized settings for serverless
 */
async function createDbConnection(
	url: string,
	retryCount = 0,
): Promise<DbInstance> {
	if (retryCount === 0) connectionAttempts = 0;

	try {
		const sql: NeonQueryFunction<boolean, boolean> = neon(url, {
			fetchOptions: {
				cache: "no-store", // Disable caching for fresh data
				signal: AbortSignal.timeout(8000), // 8s hard timeout per query
			},
			// Optimize for serverless - query via fetch for better cold starts
			fullResults: false,
		});

		const db = drizzle(sql, {
			schema,
			logger: process.env.NODE_ENV === "development",
		});

		return db;
	} catch (error) {
		connectionAttempts++;

		if (retryCount < MAX_RETRIES) {
			// Exponential backoff
			const delay = RETRY_DELAY_MS * 2 ** retryCount;
			logger.warn("Database connection attempt failed, retrying", {
				attempt: retryCount + 1,
				retryInMs: delay,
				error: errorMessage(error),
			});

			await new Promise((resolve) => setTimeout(resolve, delay));
			return createDbConnection(url, retryCount + 1);
		}

		logger.error("Database connection failed after retries", {
			attempts: connectionAttempts,
			error: errorMessage(error),
		});
		throw new Error("Failed to connect to database after multiple attempts");
	}
}

export { schema };
