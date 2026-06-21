import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { organizations, users } from "@/db/schema/index";
import {
	createTestDb,
	type TestDb,
	truncateIdempotencyKeys,
	truncateOrganizations,
	truncateUserGraph,
} from "./helpers/test-db";

let db: TestDb;
let pool: Pool;

beforeAll(async () => {
	({ db, pool } = await createTestDb());
}, 60_000);

afterAll(async () => {
	await pool?.end();
});

beforeEach(async () => {
	await truncateIdempotencyKeys(pool);
	await truncateOrganizations(pool);
	await truncateUserGraph(pool);
});

async function expectConstraintViolation(
	promise: Promise<unknown>,
	constraint: string,
): Promise<void> {
	let thrown: unknown;
	try {
		await promise;
	} catch (error) {
		thrown = error;
	}

	expect(thrown).toBeInstanceOf(Error);
	const cause = thrown instanceof Error ? thrown.cause : undefined;
	expect(
		typeof cause === "object" && cause !== null && "constraint" in cause
			? cause.constraint
			: undefined,
	).toBe(constraint);
}

describe("database constraints (real Postgres)", () => {
	it("enforces canonical user and organization status values", async () => {
		await expectConstraintViolation(
			db.insert(users).values({
				email: "bad-status@example.com",
				type: "MEMBER",
				status: "deleted",
			}),
			"ck_users_status",
		);

		await expectConstraintViolation(
			db.insert(organizations).values({
				workosOrgId: "org_bad_status",
				name: "Bad Status",
				status: "deleted",
			}),
			"ck_organizations_status",
		);

		await expect(
			db.insert(users).values({
				email: "valid-status@example.com",
				type: "MEMBER",
				status: "DELETED",
			}),
		).resolves.toBeDefined();

		await expect(
			db.insert(organizations).values({
				workosOrgId: "org_valid_status",
				name: "Valid Status",
				status: "DELETED",
			}),
		).resolves.toBeDefined();
	});

	it("does not keep the redundant idempotency key/request_hash unique index", async () => {
		const result = await pool.query<{ indexname: string }>(`
			SELECT indexname
			FROM pg_indexes
			WHERE schemaname = 'public'
				AND tablename = 'idempotency_keys'
			ORDER BY indexname
		`);
		const indexNames = result.rows.map((row) => row.indexname);

		expect(indexNames).toContain("idempotency_keys_pkey");
		expect(indexNames).toContain("ix_idempotency_keys_expires");
		expect(indexNames).not.toContain(
			"idempotency_keys_key_request_hash_unique",
		);
	});
});
