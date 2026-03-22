import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { type NeonQueryFunction, neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "../db/schema/index";

type DbInstance = NeonHttpDatabase<typeof schema>;

let dbInstance: DbInstance | null = null;
let dbUrl: string | null = null;
let connectionAttempts = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

async function getDbUrl(): Promise<string> {
	// Return cached URL if available
	if (dbUrl) return dbUrl;

	// Option 1: Use DATABASE_URL from environment
	if (process.env.DATABASE_URL) {
		dbUrl = process.env.DATABASE_URL;
		return dbUrl;
	}

	// Option 2: Fetch from Secrets Manager (preferred in deployed environments)
	if (process.env.DB_SECRET_ARN) {
		const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
		const command = new GetSecretValueCommand({
			SecretId: process.env.DB_SECRET_ARN,
		});

		try {
			const response = await client.send(command);
			if (response.SecretString) {
				const secret = JSON.parse(response.SecretString);
				// Format stored by sync-secrets script: { url: "postgresql://..." }
				if (secret.url) {
					dbUrl = String(secret.url);
					return dbUrl;
				}
				// Fallback: RDS-style secret with individual fields
				const sslmode = secret.sslmode || "require";
				const channelBinding = secret.channel_binding
					? `&channel_binding=${secret.channel_binding}`
					: "";
				dbUrl = `postgresql://${secret.username}:${secret.password}@${secret.host}:${secret.port || 5432}/${secret.database}?sslmode=${sslmode}${channelBinding}`;
				return dbUrl;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("Failed to retrieve database secret:", message);
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
export async function getDb(): Promise<DbInstance> {
	if (!dbInstance) {
		const url = await getDbUrl();
		dbInstance = await createDbConnection(url);
	}
	return dbInstance;
}

/**
 * Create database connection with optimized settings for serverless
 */
async function createDbConnection(
	url: string,
	retryCount = 0,
): Promise<DbInstance> {
	try {
		const sql: NeonQueryFunction<boolean, boolean> = neon(url, {
			fetchOptions: {
				cache: "no-store", // Disable caching for fresh data
			},
			// Optimize for serverless - query via fetch for better cold starts
			fullResults: false,
		});

		const db = drizzle(sql, {
			schema,
			logger: process.env.NODE_ENV === "development",
		});

		connectionAttempts = 0; // Reset on success
		return db;
	} catch (error) {
		connectionAttempts++;

		if (retryCount < MAX_RETRIES) {
			// Exponential backoff
			const delay = RETRY_DELAY_MS * 2 ** retryCount;
			const message = error instanceof Error ? error.message : String(error);
			console.warn(
				`Database connection attempt ${retryCount + 1} failed, retrying in ${delay}ms:`,
				message,
			);

			await new Promise((resolve) => setTimeout(resolve, delay));
			return createDbConnection(url, retryCount + 1);
		}

		const message = error instanceof Error ? error.message : String(error);
		console.error("Database connection failed after retries", {
			attempts: connectionAttempts,
			error: message,
		});
		throw new Error("Failed to connect to database after multiple attempts");
	}
}

/**
 * Reset database connection (useful for testing or connection issues)
 */
function _resetDbConnection(): void {
	dbInstance = null;
	dbUrl = null;
	connectionAttempts = 0;
}

export { schema };
