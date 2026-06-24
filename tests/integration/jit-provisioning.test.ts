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

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: getDbMock }));

import { auditLogs, authIdentities, profiles, users } from "@/db/schema/index";
import { getUserIdFromClaims } from "@/lib/auth";
import {
	createTestDb,
	type TestDb,
	truncateAuditLogs,
	truncateUserGraph,
} from "./helpers/test-db";

let db: TestDb;
let pool: Pool;

beforeAll(async () => {
	({ db, pool } = await createTestDb());
	getDbMock.mockResolvedValue(db);
}, 60_000);

afterAll(async () => {
	await dropJitFailureTrigger();
	await pool?.end();
});

beforeEach(async () => {
	await dropJitFailureTrigger();
	await truncateAuditLogs(pool);
	await truncateUserGraph(pool);
});

afterEach(async () => {
	await dropJitFailureTrigger();
	vi.clearAllMocks();
	getDbMock.mockResolvedValue(db);
});

async function dropJitFailureTrigger(): Promise<void> {
	if (!pool) return;
	await pool.query(`
		DROP TRIGGER IF EXISTS fail_jit_user_insert ON users;
		DROP FUNCTION IF EXISTS fail_jit_user_insert();
	`);
}

async function installJitFailureTrigger(): Promise<void> {
	await pool.query(`
		CREATE OR REPLACE FUNCTION fail_jit_user_insert()
		RETURNS trigger
		LANGUAGE plpgsql
		AS $$
		BEGIN
			IF NEW.email = 'boom@example.com' THEN
				RAISE EXCEPTION 'jit insert boom' USING ERRCODE = 'P0001';
			END IF;
			RETURN NEW;
		END;
		$$;

		CREATE TRIGGER fail_jit_user_insert
		BEFORE INSERT ON users
		FOR EACH ROW
		EXECUTE FUNCTION fail_jit_user_insert();
	`);
}

async function rowsForSubject(providerSubject: string) {
	return db
		.select()
		.from(authIdentities)
		.where(eq(authIdentities.providerSubject, providerSubject));
}

describe("getUserIdFromClaims JIT provisioning (real Postgres)", () => {
	it("provisions one user graph on first-login auth identity miss", async () => {
		const userId = await getUserIdFromClaims({
			sub: "user_jit_miss",
			email: "jit@example.com",
		});

		const identities = await rowsForSubject("user_jit_miss");
		expect(identities).toHaveLength(1);
		expect(identities[0]?.userId).toBe(userId);

		const userRows = await db.select().from(users).where(eq(users.id, userId));
		expect(userRows).toHaveLength(1);
		expect(userRows[0]?.email).toBe("jit@example.com");

		const profileRows = await db
			.select()
			.from(profiles)
			.where(eq(profiles.userId, userId));
		expect(profileRows).toHaveLength(1);

		const auditRows = await db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.resourceId, userId));
		expect(auditRows).toHaveLength(1);
		expect(auditRows[0]?.metadata).toMatchObject({
			source: "jit_provisioning",
			providerSubject: "user_jit_miss",
		});
	});

	it("handles concurrent same-sub first logins by creating exactly one user", async () => {
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				getUserIdFromClaims({
					sub: "user_jit_race",
					email: "race@example.com",
				}),
			),
		);

		expect(new Set(results).size).toBe(1);

		const identities = await rowsForSubject("user_jit_race");
		expect(identities).toHaveLength(1);

		const userRows = await db.select().from(users);
		expect(userRows).toHaveLength(1);

		const profileRows = await db.select().from(profiles);
		expect(profileRows).toHaveLength(1);
	});

	it("rethrows non-unique provisioning errors instead of retrying as auth races", async () => {
		await installJitFailureTrigger();

		let thrown: unknown;
		try {
			await getUserIdFromClaims({
				sub: "user_jit_non_unique_failure",
				email: "boom@example.com",
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect(thrown instanceof Error ? thrown.cause : undefined).toBeInstanceOf(
			Error,
		);
		expect(
			thrown instanceof Error && thrown.cause instanceof Error
				? thrown.cause.message
				: "",
		).toContain("jit insert boom");

		const identities = await rowsForSubject("user_jit_non_unique_failure");
		expect(identities).toHaveLength(0);
	});
});
