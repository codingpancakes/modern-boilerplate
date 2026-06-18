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

// Resolvers call logAudit() (fire-and-forget) which reaches the DB via getDb();
// route it to the test harness so those writes hit the real test engine.
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: getDbMock }));

import { organizationMembers, organizations, users } from "@/db/schema/index";
import type { GraphQLContext } from "@/handlers/graphql/context";
import { organizationResolvers } from "@/handlers/graphql/resolvers/organizations";
import {
	createTestDb,
	type TestDb,
	truncateOrganizations,
	truncateUserGraph,
} from "./helpers/test-db";

/**
 * Integration test for the org-membership CONSENT flow (the inviteMember IDOR
 * fix): an invite creates a PENDING membership that is invisible to the
 * ACTIVE-filtered queries until the invited user accepts it themselves.
 */
describe("organization invitation consent flow", () => {
	let db: TestDb;
	let pool: Pool;

	// Resolvers type context.db as the neon-serverless instance; the harness is
	// the node-postgres instance with an identical query/transaction surface
	// (see test-db.ts). Cast once for the test context.
	const ctx = (userId: string, organizationId: string): GraphQLContext =>
		({
			userId,
			organizationId,
			requestId: "test-req",
			db: db as unknown as GraphQLContext["db"],
		}) as GraphQLContext;

	const ownerId = "11111111-1111-1111-1111-111111111111";
	const inviteeId = "22222222-2222-2222-2222-222222222222";
	let orgId: string;

	beforeAll(async () => {
		const t = await createTestDb();
		db = t.db;
		pool = t.pool;
		getDbMock.mockResolvedValue(db);
	});
	afterAll(async () => {
		await pool.end();
	});

	beforeEach(async () => {
		await truncateOrganizations(pool);
		await truncateUserGraph(pool);
		await db.insert(users).values([
			{ id: ownerId, type: "MEMBER" },
			{ id: inviteeId, type: "MEMBER" },
		]);
		const [org] = await db
			.insert(organizations)
			.values({ name: "Acme", slug: "acme" })
			.returning();
		orgId = org.id;
		await db.insert(organizationMembers).values({
			organizationId: orgId,
			userId: ownerId,
			role: "OWNER",
			status: "ACTIVE",
		});
	});
	afterEach(async () => {
		await truncateOrganizations(pool);
		await truncateUserGraph(pool);
	});

	const invite = organizationResolvers.Mutation.inviteMember;
	const accept = organizationResolvers.Mutation.acceptInvitation;
	const listMembers = organizationResolvers.Query.organizationMembers;

	it("invite creates a PENDING membership that is NOT exposed to active member queries", async () => {
		const membership = await invite(
			null,
			{ organizationId: orgId, input: { userId: inviteeId, role: "MEMBER" } },
			ctx(ownerId, orgId),
		);
		expect(membership.status).toBe("PENDING");

		// The invitee must NOT appear in the active-members listing.
		const page = await listMembers(
			null,
			{ organizationId: orgId },
			ctx(ownerId, orgId),
		);
		const memberUserIds = page.items.map((m) => m.userId);
		expect(memberUserIds).toContain(ownerId);
		expect(memberUserIds).not.toContain(inviteeId);
	});

	it("acceptInvitation flips the caller's own PENDING invite to ACTIVE", async () => {
		await invite(
			null,
			{ organizationId: orgId, input: { userId: inviteeId, role: "MEMBER" } },
			ctx(ownerId, orgId),
		);

		const accepted = await accept(
			null,
			{ organizationId: orgId },
			ctx(inviteeId, orgId),
		);
		expect(accepted.status).toBe("ACTIVE");

		const [row] = await db
			.select()
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.userId, inviteeId),
					eq(organizationMembers.organizationId, orgId),
				),
			);
		expect(row.status).toBe("ACTIVE");
	});

	it("rejects inviting a non-existent user", async () => {
		await expect(
			invite(
				null,
				{
					organizationId: orgId,
					input: {
						userId: "33333333-3333-3333-3333-333333333333",
						role: "MEMBER",
					},
				},
				ctx(ownerId, orgId),
			),
		).rejects.toThrow();
	});
});
