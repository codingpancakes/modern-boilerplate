import { AsyncLocalStorage } from "node:async_hooks";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "../db/schema/index";
import { errorMessage } from "./error-utils";
import { createLogger } from "./logger";

const logger = createLogger({ serviceName: "db" });

// Neon serverless driver configuration.
//
// We use the WebSocket-capable `neon-serverless` driver (NOT `neon-http`)
// because interactive transactions — `db.transaction(async (tx) => { ... })` —
// are a hard requirement of this codebase (user provisioning, profile updates,
// org mutations, webhook upserts). The `neon-http` driver throws
// "No transactions support in neon-http driver" on any `.transaction()` call.
//
// `poolQueryViaFetch` keeps ordinary (non-transactional) queries on stateless
// HTTP fetch — no socket is ever opened for them. A WebSocket connection is
// only opened when an interactive transaction actually runs (drizzle calls
// `pool.connect()` for BEGIN/COMMIT), and is released back to the pool
// immediately afterwards.
if (typeof WebSocket !== "undefined") {
	// Workers and Node 24 both expose a global WebSocket; reuse it so we don't
	// need to bundle the `ws` package.
	neonConfig.webSocketConstructor = WebSocket;
}
neonConfig.poolQueryViaFetch = true;

export type DbInstance = NeonDatabase<typeof schema>;

// Hard ceiling on a single statement (server-enforced via Postgres
// `statement_timeout`) so a hung query can't pin an invocation for its whole
// timeout.
const STATEMENT_TIMEOUT_MS = 8000;

/**
 * Per-request database lifecycle.
 *
 * Cloudflare Workers FORBIDS reusing I/O objects (sockets, in-flight fetches)
 * across requests: a module-level cached Pool created during request A throws
 * "Cannot perform I/O on behalf of a different request" when request B uses
 * it. So instead of the old warm-Lambda singleton, every request gets its own
 * pool, carried in AsyncLocalStorage so `getDb()` call sites stay unchanged:
 *
 *   - The `dbScope()` Hono middleware (lib/hono/middleware.ts) wraps each
 *     request in {@link runWithDbScope}; every `getDb()` within the request —
 *     including fire-and-forget audit writes drained by `flushAudits()` —
 *     shares one lazily-created pool, which is drained when the scope exits.
 *   - Callers OUTSIDE a scope (cron handlers, scripts) get a fresh instance
 *     per call. Pools are lazy and ordinary queries go over stateless fetch,
 *     so an un-drained pool holds no socket unless a transaction ran; cron
 *     jobs can wrap themselves in {@link runWithDbScope} for explicit cleanup.
 */
interface DbScope {
	db: DbInstance | null;
	pool: Pool | null;
}

const dbScopeStorage = new AsyncLocalStorage<DbScope>();

function getDbUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL must be configured");
	}
	return url;
}

/**
 * Get the Drizzle database instance for the current request scope.
 *
 * Inside a {@link runWithDbScope} scope (every HTTP request via the
 * `dbScope()` middleware) the same instance is returned for the whole
 * request and disposed when the scope exits. Outside a scope a fresh
 * instance is created per call — see {@link DbScope}.
 *
 * @throws Error if DATABASE_URL is not configured
 */
export async function getDb(): Promise<DbInstance> {
	const scope = dbScopeStorage.getStore();
	if (!scope) {
		return createDbConnection(getDbUrl()).db;
	}
	if (!scope.db) {
		const { db, pool } = createDbConnection(getDbUrl());
		scope.db = db;
		scope.pool = pool;
	}
	return scope.db;
}

/**
 * Run `fn` with a request-scoped database lifecycle: all `getDb()` calls in
 * its async context share one lazily-created pool, drained on exit. Pool
 * teardown is best-effort — a failure to drain never masks `fn`'s result.
 */
export async function runWithDbScope<T>(fn: () => Promise<T>): Promise<T> {
	const scope: DbScope = { db: null, pool: null };
	try {
		return await dbScopeStorage.run(scope, fn);
	} finally {
		if (scope.pool) {
			await scope.pool.end().catch((error: unknown) => {
				logger.warn("Failed to drain request database pool", {
					error: errorMessage(error),
				});
			});
		}
	}
}

/**
 * Build a Neon serverless pool + Drizzle instance.
 *
 * `new Pool()` is lazy — it does not open a socket until the first query (HTTP
 * fetch) or first transaction (`connect()`), so there is nothing to retry at
 * construction time; per-statement failures surface on the query itself and are
 * bounded by `statement_timeout`.
 */
function createDbConnection(url: string): { db: DbInstance; pool: Pool } {
	const pool = new Pool({
		connectionString: url,
		// One pool per request, but DataLoaders can fan out parallel queries
		// within a single request — a small pool covers that.
		max: 5,
		connectionTimeoutMillis: STATEMENT_TIMEOUT_MS,
		idleTimeoutMillis: 10_000,
		statement_timeout: STATEMENT_TIMEOUT_MS,
	});

	// node-postgres emits 'error' on idle clients whose connection drops —
	// common in serverless when Neon closes an idle WebSocket. Without a
	// listener the unhandled event would crash the process; log and swallow.
	pool.on("error", (error) => {
		logger.error("Idle database client error", {
			error: errorMessage(error),
		});
	});

	return {
		db: drizzle(pool, {
			schema,
			logger: process.env.NODE_ENV === "development",
		}),
		pool,
	};
}

export { schema };
