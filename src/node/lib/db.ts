import { Logger } from "@aws-lambda-powertools/logger";
import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "../db/schema/index";
import { errorMessage } from "./error-utils";

const logger = new Logger({ serviceName: "db" });

// Neon serverless driver configuration.
//
// We use the WebSocket-capable `neon-serverless` driver (NOT `neon-http`)
// because interactive transactions — `db.transaction(async (tx) => { ... })` —
// are a hard requirement of this codebase (user provisioning, profile updates,
// org mutations, webhook upserts). The `neon-http` driver throws
// "No transactions support in neon-http driver" on any `.transaction()` call.
//
// To keep Lambda cold starts cheap we set `poolQueryViaFetch`: every ordinary
// (non-transactional) query is sent over stateless HTTP fetch, exactly like the
// http driver did. A WebSocket connection is only opened when an interactive
// transaction actually runs (drizzle calls `pool.connect()` for BEGIN/COMMIT),
// and is released back to the pool immediately afterwards.
if (typeof WebSocket !== "undefined") {
	// Node 24 (and the Lambda runtime) expose a global WebSocket; reuse it so we
	// don't need to bundle the `ws` package.
	neonConfig.webSocketConstructor = WebSocket;
}
neonConfig.poolQueryViaFetch = true;

export type DbInstance = NeonDatabase<typeof schema>;

let dbInstance: DbInstance | null = null;
let poolInstance: Pool | null = null;
let dbInitPromise: Promise<DbInstance> | null = null;
let dbUrl: string | null = null;
let dbUrlCachedAt: number | null = null;
const DB_URL_TTL_MS = 15 * 60 * 1000;

// Hard ceiling on a single statement (server-enforced via Postgres
// `statement_timeout`) so a hung query can't pin a Lambda for its whole timeout.
const STATEMENT_TIMEOUT_MS = 8000;

/**
 * Tear down the current pool + drizzle instance (e.g. when a rotated secret
 * means we must reconnect with a new URL). Best-effort: a failure to drain the
 * old pool must not block reconnection.
 */
function resetConnection(): void {
	const pool = poolInstance;
	poolInstance = null;
	dbInstance = null;
	if (pool) {
		void pool.end().catch((error) => {
			logger.warn("Failed to drain previous database pool", {
				error: errorMessage(error),
			});
		});
	}
}

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

		// Cache expired or missing — drop the pool so it reconnects with the new URL
		resetConnection();
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

function isDbUrlExpired(): boolean {
	if (process.env.DATABASE_URL) return false;
	if (!process.env.DB_SECRET_ARN) return false;
	return !dbUrlCachedAt || Date.now() - dbUrlCachedAt >= DB_URL_TTL_MS;
}

/**
 * Get the shared Drizzle database instance.
 *
 * Backed by a module-level Neon serverless pool that is reused across warm
 * Lambda invocations. The pool is rebuilt when a rotated DB secret is detected
 * (see {@link isDbUrlExpired}). Concurrent first-callers share a single
 * in-flight init so we never construct duplicate pools.
 *
 * @throws Error if credentials cannot be resolved
 * @returns Drizzle database instance
 */
export async function getDb(): Promise<DbInstance> {
	// Check TTL even when dbInstance exists so secret rotation is picked up
	if (dbInstance && !isDbUrlExpired()) return dbInstance;

	// Reuse in-flight init to prevent concurrent callers from creating duplicates
	if (!dbInitPromise) {
		dbInitPromise = (async () => {
			const url = await getDbUrl();
			const db = createDbConnection(url);
			dbInstance = db;
			return db;
		})().finally(() => {
			dbInitPromise = null;
		});
	}

	return dbInitPromise;
}

/**
 * Build a Neon serverless pool + Drizzle instance.
 *
 * `new Pool()` is lazy — it does not open a socket until the first query (HTTP
 * fetch) or first transaction (`connect()`), so there is nothing to retry at
 * construction time; per-statement failures surface on the query itself and are
 * bounded by `statement_timeout`.
 */
function createDbConnection(url: string): DbInstance {
	const pool = new Pool({
		connectionString: url,
		// Lambda handles one request at a time, but DataLoaders can fan out
		// parallel queries within a single invocation — a small pool covers that.
		max: 5,
		connectionTimeoutMillis: STATEMENT_TIMEOUT_MS,
		idleTimeoutMillis: 10_000,
		statement_timeout: STATEMENT_TIMEOUT_MS,
	});

	// node-postgres emits 'error' on idle clients whose connection drops — common
	// in serverless when Neon closes an idle WebSocket. Without a listener the
	// unhandled event would crash the Lambda process; log and swallow instead.
	pool.on("error", (error) => {
		logger.error("Idle database client error", {
			error: errorMessage(error),
		});
	});

	poolInstance = pool;

	return drizzle(pool, {
		schema,
		logger: process.env.NODE_ENV === "development",
	});
}

export { schema };
