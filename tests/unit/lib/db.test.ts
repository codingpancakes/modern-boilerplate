import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spies/objects must be hoisted so the vi.mock factories below can close over
// them (vi.mock calls are hoisted above imports).
const { drizzleMock, poolCtorSpy, neonConfigObj } = vi.hoisted(() => ({
	drizzleMock: vi.fn((..._args: unknown[]) => ({ __serverlessDrizzle: true })),
	poolCtorSpy: vi.fn(),
	neonConfigObj: {} as Record<string, unknown>,
}));

vi.mock("@neondatabase/serverless", () => {
	class Pool {
		constructor(opts: unknown) {
			poolCtorSpy(opts);
		}
		on() {}
		end() {
			return Promise.resolve();
		}
	}
	return { Pool, neonConfig: neonConfigObj };
});

vi.mock("drizzle-orm/neon-serverless", () => ({
	drizzle: drizzleMock,
}));

/**
 * Regression guard for the database driver choice.
 *
 * The app REQUIRES interactive transactions (`db.transaction(async (tx) => ...)`)
 * for user provisioning, profile updates, org mutations and webhook upserts.
 * The `neon-http` driver throws "No transactions support in neon-http driver"
 * at runtime — a failure unit tests with a mocked DB cannot see. These tests
 * assert that `db.ts` wires the WebSocket-capable `neon-serverless` Pool driver,
 * so a silent regression back to `neon-http` fails the build instead of prod.
 */
describe("database driver wiring", () => {
	beforeEach(() => {
		vi.resetModules();
		poolCtorSpy.mockClear();
		drizzleMock.mockClear();
		for (const key of Object.keys(neonConfigObj)) delete neonConfigObj[key];
		process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
		delete process.env.DB_SECRET_ARN;
	});

	afterEach(() => {
		delete process.env.DATABASE_URL;
	});

	it("builds a Neon serverless Pool and wires it through drizzle", async () => {
		const { getDb } = await import("@/lib/db");
		const { Pool } = await import("@neondatabase/serverless");

		const db = await getDb();

		expect(poolCtorSpy).toHaveBeenCalledTimes(1);
		expect(poolCtorSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionString: "postgresql://user:pass@localhost:5432/db",
			}),
		);
		expect(drizzleMock).toHaveBeenCalledTimes(1);

		// drizzle must receive the Pool instance (interactive-transaction capable),
		// not a bare neon() HTTP query function.
		const client = drizzleMock.mock.calls[0]?.[0];
		expect(client).toBeInstanceOf(Pool);
		expect(db).toBe(drizzleMock.mock.results[0]?.value);
	});

	it("routes ordinary queries over HTTP fetch (WebSocket only opens for transactions)", async () => {
		await import("@/lib/db");
		expect(neonConfigObj.poolQueryViaFetch).toBe(true);
	});

	it("reuses a single pool across calls within a warm invocation", async () => {
		const { getDb } = await import("@/lib/db");
		await getDb();
		await getDb();
		expect(poolCtorSpy).toHaveBeenCalledTimes(1);
	});
});
