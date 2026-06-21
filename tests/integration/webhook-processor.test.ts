import { and, eq } from "drizzle-orm";
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

// processWorkosEvent and the provisioning layer reach the DB via getDb() with
// no db param; route that to the node-postgres test harness (see the rationale
// in idempotency.test.ts). The Drizzle API + emitted SQL match production.
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: getDbMock }));

import {
	auditLogs,
	authIdentities,
	idempotencyKeys,
	organizations,
	users,
} from "@/db/schema/index";
import { processWorkosEvent } from "@/lib/services/webhook-processor";
import type { WorkOSWebhookEvent } from "@/lib/validation/webhooks";
import {
	createTestDb,
	type TestDb,
	truncateAuditLogs,
	truncateIdempotencyKeys,
	truncateOrganizations,
	truncateUserGraph,
} from "./helpers/test-db";

/**
 * Real-database integration tests for processWorkosEvent
 * (src/node/lib/services/webhook-processor.ts).
 *
 * Proves the idempotent provisioning core end-to-end: a user.created event
 * provisions the user graph AND writes a "completed" lock; replaying the same
 * event id is a no-op (no duplicate user, no error); organization.created
 * provisions an org. All against a live Postgres.
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
	await truncateUserGraph(pool);
	await truncateOrganizations(pool);
	await truncateIdempotencyKeys(pool);
	await truncateAuditLogs(pool);
});

afterEach(() => {
	vi.clearAllMocks();
	getDbMock.mockResolvedValue(db);
});

function userCreatedEvent(
	eventId: string,
	workosUserId: string,
): WorkOSWebhookEvent {
	return {
		id: eventId,
		event: "user.created",
		data: {
			id: workosUserId,
			email: "ada@example.com",
			first_name: "Ada",
			last_name: "Lovelace",
		},
		created_at: "2026-06-14T00:00:00Z",
	};
}

function orgCreatedEvent(
	eventId: string,
	workosOrgId: string,
): WorkOSWebhookEvent {
	return {
		id: eventId,
		event: "organization.created",
		data: { id: workosOrgId, name: "Acme Inc" },
		created_at: "2026-06-14T00:00:00Z",
	};
}

describe("processWorkosEvent (real Postgres)", () => {
	it("provisions a user and writes a completed idempotency lock for user.created", async () => {
		await processWorkosEvent(userCreatedEvent("evt_user_1", "user_workos_1"));

		const userRows = await db
			.select()
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, "user_workos_1"),
				),
			);
		expect(userRows).toHaveLength(1);

		const provisionedUserId = userRows[0].userId;
		if (!provisionedUserId) throw new Error("expected a provisioned user id");
		const provisioned = await db
			.select()
			.from(users)
			.where(eq(users.id, provisionedUserId));
		expect(provisioned).toHaveLength(1);
		expect(provisioned[0]?.firstName).toBe("Ada");
		expect(provisioned[0]?.email).toBe("ada@example.com");

		const [lock] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, "workos-webhook-evt_user_1"));
		expect(lock?.status).toBe("completed");
		expect(lock?.completedAt).toBeTruthy();

		const userAuditRows = await db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.resourceId, provisionedUserId));
		expect(userAuditRows).toHaveLength(1);
		expect(userAuditRows[0]?.action).toBe("CREATE");
		expect(userAuditRows[0]?.resourceType).toBe("USER");
	});

	it("is a no-op when the SAME event id is reprocessed (no duplicate user, no error)", async () => {
		const event = userCreatedEvent("evt_user_dupe", "user_workos_dupe");

		await processWorkosEvent(event);
		// Reprocessing the completed event must short-circuit cleanly.
		await expect(processWorkosEvent(event)).resolves.toBeUndefined();

		const identities = await db
			.select()
			.from(authIdentities)
			.where(eq(authIdentities.providerSubject, "user_workos_dupe"));
		expect(identities).toHaveLength(1);

		const allUsers = await db.select().from(users);
		expect(allUsers).toHaveLength(1);
	});

	it("provisions an organization for organization.created", async () => {
		await processWorkosEvent(orgCreatedEvent("evt_org_1", "org_workos_1"));

		const orgs = await db
			.select()
			.from(organizations)
			.where(eq(organizations.workosOrgId, "org_workos_1"));
		expect(orgs).toHaveLength(1);
		expect(orgs[0]?.name).toBe("Acme Inc");

		const [lock] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, "workos-webhook-evt_org_1"));
		expect(lock?.status).toBe("completed");

		const orgAuditRows = await db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.resourceId, orgs[0]?.id));
		expect(orgAuditRows).toHaveLength(1);
		expect(orgAuditRows[0]?.action).toBe("CREATE");
		expect(orgAuditRows[0]?.resourceType).toBe("ORGANIZATION");
	});
});
