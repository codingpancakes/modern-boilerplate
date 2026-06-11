import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authIdentities, profiles, users } from "@/db/schema/index";
import type { DbInstance } from "@/lib/db";
import { createUserWithIdentity } from "@/lib/services/user-provisioning";
import {
	createTestDb,
	type TestDb,
	truncateUserGraph,
} from "./helpers/test-db";

/**
 * Real-database transaction integration tests.
 *
 * Proves the behaviour that unit tests (which mock `db.transaction` as a
 * pass-through) cannot: that multi-step writes actually COMMIT atomically and
 * ROLL BACK fully on error against a real Postgres engine. This is the
 * regression guard for the original "neon-http can't do transactions" class of
 * bug — if transactions silently stopped being atomic, these fail.
 */

let db: TestDb;
let pool: Pool;

beforeAll(async () => {
	({ db, pool } = await createTestDb());
}, 60_000);

afterAll(async () => {
	await pool?.end();
});

beforeEach(async () => {
	await truncateUserGraph(pool);
});

describe("db transactions (real Postgres)", () => {
	it("commits a multi-step write: user + profile + identity all persist", async () => {
		const userId = await createUserWithIdentity(db as unknown as DbInstance, {
			providerSubject: "user_commit_1",
			email: "commit@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
		});

		expect(userId).toBeTruthy();

		const u = await db.select().from(users).where(eq(users.id, userId));
		const p = await db
			.select()
			.from(profiles)
			.where(eq(profiles.userId, userId));
		const a = await db
			.select()
			.from(authIdentities)
			.where(eq(authIdentities.providerSubject, "user_commit_1"));

		expect(u).toHaveLength(1);
		expect(p).toHaveLength(1);
		expect(a).toHaveLength(1);
		expect(u[0]?.firstName).toBe("Ada");
	});

	it("rolls back the whole transaction when a step throws (no partial rows)", async () => {
		await expect(
			db.transaction(async (tx) => {
				await tx
					.insert(users)
					.values({ email: "rollback@example.com", type: "MEMBER" });
				// Simulate a failure after the first write.
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		const all = await db.select().from(users);
		expect(all).toHaveLength(0);
	});

	it("rolls back partial inserts when a later unique constraint fails", async () => {
		// First provisioning succeeds.
		await createUserWithIdentity(db as unknown as DbInstance, {
			providerSubject: "dupe_subject",
			email: "first@example.com",
		});
		const before = await db.select().from(users);
		expect(before).toHaveLength(1);

		// Second provisioning reuses the same providerSubject. Inside the same
		// transaction it inserts a NEW user + profile, then the auth-identity
		// insert violates the (provider_type, provider_subject) unique index.
		// The whole transaction must roll back — no orphaned user/profile.
		await expect(
			createUserWithIdentity(db as unknown as DbInstance, {
				providerSubject: "dupe_subject",
				email: "second@example.com",
			}),
		).rejects.toThrow();

		const after = await db.select().from(users);
		expect(after).toHaveLength(before.length);
	});
});
