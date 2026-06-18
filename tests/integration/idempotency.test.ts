import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

// The modules under test call getDb() internally (no db param). Route that to
// the real node-postgres test harness instead of the production neon-serverless
// driver (which can't talk to a bare local Postgres). The Drizzle query API and
// emitted SQL are identical across both drivers, so this still exercises real
// INSERT ON CONFLICT / UPDATE-with-predicate semantics against a live engine.
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: getDbMock }));

import { idempotencyKeys } from "@/db/schema/index";
import { ApiError } from "@/lib/errors";
import {
	cleanupExpiredKeys,
	type IdempotentRequest,
	type StoredResponse,
	withIdempotency,
} from "@/lib/idempotency";
import {
	createTestDb,
	type TestDb,
	truncateIdempotencyKeys,
} from "./helpers/test-db";

/**
 * Real-database integration tests for withIdempotency (src/node/lib/idempotency.ts).
 *
 * Proves the at-most-once guarantees that mocks can't: that the atomic
 * INSERT ... ON CONFLICT DO NOTHING claim, the stored-response replay, the
 * request-hash-mismatch rejection, the in-flight 409, and the failed-key
 * reclaim all behave correctly against a live Postgres.
 */

let db: TestDb;
let pool: Pool;

beforeAll(async () => {
	({ db, pool } = await createTestDb());
	getDbMock.mockResolvedValue(db);
}, 60_000);

afterAll(async () => {
	await pool?.end();
});

beforeEach(async () => {
	await truncateIdempotencyKeys(pool);
});

afterEach(async () => {
	vi.clearAllMocks();
	getDbMock.mockResolvedValue(db);
});

const baseRequest = (key: string): IdempotentRequest => ({
	key,
	sub: "user-1",
	method: "PATCH",
	path: "/v1/users/me",
	body: '{"user":{"firstName":"Ada"}}',
});

const okResponse: StoredResponse = {
	statusCode: 200,
	headers: { "content-type": "application/json" },
	body: '{"ok":true}',
};

describe("withIdempotency (real Postgres)", () => {
	it("runs the handler once and replays the stored response on a repeat with the same key + request", async () => {
		const handler = vi.fn(() => Promise.resolve(okResponse));

		const first = await withIdempotency(baseRequest("key-replay"), handler);
		expect(first).toEqual(okResponse);
		expect(handler).toHaveBeenCalledOnce();

		// The row is now "completed" with the serialized response.
		const [row] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, "key-replay"));
		expect(row?.status).toBe("completed");

		const second = await withIdempotency(baseRequest("key-replay"), handler);
		expect(second).toEqual(okResponse);
		// Handler NOT re-run — the stored response was replayed.
		expect(handler).toHaveBeenCalledOnce();
	});

	it("rejects the same key with a different request hash (422 IDEMPOTENCY_KEY_REUSED)", async () => {
		const handler = vi.fn(() => Promise.resolve(okResponse));
		await withIdempotency(baseRequest("key-reuse"), handler);

		const conflicting: IdempotentRequest = {
			...baseRequest("key-reuse"),
			body: '{"user":{"firstName":"DIFFERENT"}}',
		};

		await expect(withIdempotency(conflicting, handler)).rejects.toMatchObject({
			statusCode: 422,
			code: "IDEMPOTENCY_KEY_REUSED",
		});
		await expect(withIdempotency(conflicting, handler)).rejects.toBeInstanceOf(
			ApiError,
		);
		// Original handler ran once; the conflicting attempts never invoked it again.
		expect(handler).toHaveBeenCalledOnce();
	});

	it("returns 409 REQUEST_IN_PROGRESS for a concurrent attempt while the key is processing", async () => {
		// Claim the key for real but never let the handler resolve, so the row
		// stays status=processing while a second attempt (same key + same request
		// hash) races in and must get a 409.
		let releaseHandler!: () => void;
		const gate = new Promise<void>((r) => {
			releaseHandler = r;
		});
		const slowHandler = vi.fn(async () => {
			await gate;
			return okResponse;
		});

		const inflight = withIdempotency(baseRequest("key-inflight"), slowHandler);
		// Let the claim INSERT land before the second attempt races in.
		await vi.waitFor(async () => {
			const [row] = await db
				.select()
				.from(idempotencyKeys)
				.where(eq(idempotencyKeys.key, "key-inflight"));
			expect(row?.status).toBe("processing");
		});

		await expect(
			withIdempotency(baseRequest("key-inflight"), vi.fn()),
		).rejects.toMatchObject({
			statusCode: 409,
			code: "REQUEST_IN_PROGRESS",
		});

		releaseHandler();
		await expect(inflight).resolves.toEqual(okResponse);
	});

	it("marks the key failed when the handler throws, and a retry can reclaim + re-run", async () => {
		const failingHandler = vi.fn(() =>
			Promise.reject(new Error("handler exploded")),
		);

		await expect(
			withIdempotency(baseRequest("key-retry"), failingHandler),
		).rejects.toThrow("handler exploded");

		const [failedRow] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, "key-retry"));
		expect(failedRow?.status).toBe("failed");

		// A retry with the same key reclaims the failed lock and re-runs.
		const recoveringHandler = vi.fn(() => Promise.resolve(okResponse));
		const result = await withIdempotency(
			baseRequest("key-retry"),
			recoveringHandler,
		);
		expect(result).toEqual(okResponse);
		expect(recoveringHandler).toHaveBeenCalledOnce();

		const [completedRow] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, "key-retry"));
		expect(completedRow?.status).toBe("completed");
	});

	it("skips the idempotency machinery entirely when no key is supplied", async () => {
		const handler = vi.fn(() => Promise.resolve(okResponse));
		const { key: _omit, ...keyless } = baseRequest("unused");

		const result = await withIdempotency(keyless, handler);

		expect(result).toEqual(okResponse);
		expect(handler).toHaveBeenCalledOnce();
		const rows = await db.select().from(idempotencyKeys);
		expect(rows).toHaveLength(0);
	});
});

describe("cleanupExpiredKeys (real Postgres)", () => {
	it("deletes only rows whose expiresAt is in the past", async () => {
		await db.insert(idempotencyKeys).values([
			{
				key: "expired-1",
				requestHash: "h1",
				status: "completed",
				createdAt: new Date(Date.now() - 200_000).toISOString(),
				expiresAt: new Date(Date.now() - 100_000).toISOString(),
			},
			{
				key: "live-1",
				requestHash: "h2",
				status: "completed",
				createdAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 100_000).toISOString(),
			},
		]);

		const deleted = await cleanupExpiredKeys();
		expect(deleted).toBe(1);

		const remaining = await db.select().from(idempotencyKeys);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.key).toBe("live-1");
	});
});
