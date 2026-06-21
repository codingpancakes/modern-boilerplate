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
	AUDIT_ACTIONS,
	auditLogs,
	authIdentities,
	idempotencyKeys,
	organizationMembers,
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

function userUpdatedEvent(
	eventId: string,
	workosUserId: string,
): WorkOSWebhookEvent {
	return {
		id: eventId,
		event: "user.updated",
		data: {
			id: workosUserId,
			email: "ada.updated@example.com",
			first_name: "Augusta",
			last_name: "King",
		},
		created_at: "2026-06-14T00:01:00Z",
	};
}

function userDeletedEvent(
	eventId: string,
	workosUserId: string,
): WorkOSWebhookEvent {
	return {
		id: eventId,
		event: "user.deleted",
		data: {
			id: workosUserId,
			email: "ada.updated@example.com",
			first_name: "Augusta",
			last_name: "King",
		},
		created_at: "2026-06-14T00:02:00Z",
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

function orgUpdatedEvent(
	eventId: string,
	workosOrgId: string,
): WorkOSWebhookEvent {
	return {
		id: eventId,
		event: "organization.updated",
		data: { id: workosOrgId, name: "Acme Updated" },
		created_at: "2026-06-14T00:01:00Z",
	};
}

function orgDeletedEvent(
	eventId: string,
	workosOrgId: string,
): WorkOSWebhookEvent {
	return {
		id: eventId,
		event: "organization.deleted",
		data: { id: workosOrgId, name: "Acme Updated" },
		created_at: "2026-06-14T00:02:00Z",
	};
}

function authEvent(eventId: string): WorkOSWebhookEvent {
	return {
		id: eventId,
		event: "authentication.password_failed",
		data: {
			user_id: "user_workos_auth",
			email: "auth@example.com",
			ip_address: "203.0.113.10",
			user_agent: "Vitest",
			type: "password",
		},
		created_at: "2026-06-14T00:03:00Z",
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

	it("updates an existing user for user.updated", async () => {
		await processWorkosEvent(
			userCreatedEvent("evt_user_create", "user_workos_update"),
		);
		await processWorkosEvent(
			userUpdatedEvent("evt_user_update", "user_workos_update"),
		);

		const [identity] = await db
			.select()
			.from(authIdentities)
			.where(eq(authIdentities.providerSubject, "user_workos_update"));
		const userId = identity?.userId;
		if (!userId) throw new Error("expected user id");

		const [updated] = await db.select().from(users).where(eq(users.id, userId));
		expect(updated?.email).toBe("ada.updated@example.com");
		expect(updated?.firstName).toBe("Augusta");
		expect(updated?.lastName).toBe("King");

		const auditRows = await db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.resourceId, userId));
		expect(auditRows.map((row) => row.action).sort()).toEqual([
			"CREATE",
			"UPDATE",
		]);
	});

	it("soft-deletes a user and removes its WorkOS identity for user.deleted", async () => {
		await processWorkosEvent(
			userCreatedEvent("evt_user_create_delete", "user_workos_delete"),
		);
		await processWorkosEvent(
			userDeletedEvent("evt_user_delete", "user_workos_delete"),
		);

		const identities = await db
			.select()
			.from(authIdentities)
			.where(eq(authIdentities.providerSubject, "user_workos_delete"));
		expect(identities).toHaveLength(0);

		const [deleted] = await db.select().from(users);
		expect(deleted?.status).toBe("DELETED");
		expect(deleted?.email).toBeNull();
		expect(deleted?.firstName).toBeNull();

		const auditRows = await db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.resourceId, deleted?.id));
		expect(auditRows.some((row) => row.action === "DELETE")).toBe(true);
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

	it("updates an organization for organization.updated", async () => {
		await processWorkosEvent(
			orgCreatedEvent("evt_org_create_update", "org_workos_update"),
		);
		await processWorkosEvent(
			orgUpdatedEvent("evt_org_update", "org_workos_update"),
		);

		const [org] = await db
			.select()
			.from(organizations)
			.where(eq(organizations.workosOrgId, "org_workos_update"));
		expect(org?.name).toBe("Acme Updated");

		const auditRows = await db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.resourceId, org?.id));
		expect(auditRows.map((row) => row.action).sort()).toEqual([
			"CREATE",
			"UPDATE",
		]);
	});

	it("soft-deletes an organization and inactivates memberships for organization.deleted", async () => {
		await processWorkosEvent(
			orgCreatedEvent("evt_org_create_delete", "org_workos_delete"),
		);
		const [org] = await db
			.select()
			.from(organizations)
			.where(eq(organizations.workosOrgId, "org_workos_delete"));
		if (!org) throw new Error("expected organization");

		const [user] = await db
			.insert(users)
			.values({ email: "member@example.com", type: "MEMBER" })
			.returning();
		await db.insert(organizationMembers).values({
			organizationId: org.id,
			userId: user.id,
			role: "MEMBER",
			status: "ACTIVE",
		});

		await processWorkosEvent(
			orgDeletedEvent("evt_org_delete", "org_workos_delete"),
		);

		const [deletedOrg] = await db
			.select()
			.from(organizations)
			.where(eq(organizations.id, org.id));
		expect(deletedOrg?.status).toBe("DELETED");

		const [membership] = await db
			.select()
			.from(organizationMembers)
			.where(eq(organizationMembers.organizationId, org.id));
		expect(membership?.status).toBe("INACTIVE");
	});

	it("audits authentication lifecycle events without mutating users or organizations", async () => {
		await processWorkosEvent(authEvent("evt_auth_failed"));

		const userRows = await db.select().from(users);
		const orgRows = await db.select().from(organizations);
		expect(userRows).toHaveLength(0);
		expect(orgRows).toHaveLength(0);

		const [auditRow] = await db.select().from(auditLogs);
		expect(auditRow?.action).toBe(AUDIT_ACTIONS.LOGIN_FAILED);
		expect(auditRow?.resourceType).toBe("USER");
		expect(auditRow?.status).toBe("FAILURE");
		expect(auditRow?.metadata).toMatchObject({
			source: "workos_webhook",
			eventType: "authentication.password_failed",
		});
	});
});
