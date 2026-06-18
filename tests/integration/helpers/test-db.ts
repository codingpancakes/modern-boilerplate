import path from "node:path";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/db/schema/index";

/**
 * Integration-test database harness.
 *
 * Connects to a REAL Postgres (docker-compose `postgres` service by default,
 * override with TEST_DATABASE_URL), applies the project migrations, and hands
 * back a Drizzle instance. Tests use this to exercise actual transaction
 * commit/rollback semantics against a real engine — not mocks.
 *
 * Driver note: this uses the `node-postgres` driver for a hermetic local DB.
 * Production uses the `neon-serverless` driver; that choice is guarded
 * separately by tests/unit/lib/db.test.ts. Drizzle's transaction API and the
 * underlying SQL (BEGIN/COMMIT/ROLLBACK) are identical across both, so the
 * transactional behaviour proven here matches production.
 *
 * Default target is the disposable `postgres-test` docker-compose service
 * (port 5434, db `serverless_test`) — NOT the dev `postgres` service — so the
 * suite's TRUNCATEs can never wipe local dev data. Override with
 * TEST_DATABASE_URL (CI sets this to its own throwaway Postgres).
 */

const DEFAULT_TEST_DB_URL =
	"postgres://postgres:postgres@localhost:5434/serverless_test";

export type TestDb = NodePgDatabase<typeof schema>;

export async function createTestDb(): Promise<{ db: TestDb; pool: Pool }> {
	const connectionString = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB_URL;
	const pool = new Pool({ connectionString });

	// The schema uses the `citext` column type; ensure the extension exists
	// before running migrations (Neon ships it preinstalled, a bare Postgres
	// does not).
	await pool.query("CREATE EXTENSION IF NOT EXISTS citext;");

	const db = drizzle(pool, { schema });

	await migrate(db, {
		migrationsFolder: path.join(__dirname, "../../../src/node/db/migrations"),
	});

	return { db, pool };
}

/** Wipe user-graph tables between tests (cascades to profiles + identities). */
export async function truncateUserGraph(pool: Pool): Promise<void> {
	await pool.query("TRUNCATE TABLE users RESTART IDENTITY CASCADE;");
}

/**
 * Wipe the idempotency-key table between tests.
 *
 * The user graph (truncateUserGraph) is separate; the idempotency and webhook
 * suites also write lock rows here, so they must clean up after themselves.
 */
export async function truncateIdempotencyKeys(pool: Pool): Promise<void> {
	await pool.query("TRUNCATE TABLE idempotency_keys RESTART IDENTITY CASCADE;");
}

/** Wipe audit-log rows between tests (provisioning + dead-letter handling write here). */
export async function truncateAuditLogs(pool: Pool): Promise<void> {
	await pool.query("TRUNCATE TABLE audit_logs RESTART IDENTITY CASCADE;");
}

/** Wipe the organization graph between tests (cascades to members). */
export async function truncateOrganizations(pool: Pool): Promise<void> {
	await pool.query("TRUNCATE TABLE organizations RESTART IDENTITY CASCADE;");
}
