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
import { userResolvers } from "@/handlers/graphql/resolvers/users";
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
		// The mutations fire `void logAudit(...)` writes that settle after the
		// resolver returns. Let them drain before truncating, otherwise an
		// in-flight audit INSERT can deadlock against the TRUNCATE ... CASCADE.
		await new Promise((resolve) => setTimeout(resolve, 50));
		await truncateOrganizations(pool);
		await truncateUserGraph(pool);
	});

	const invite = organizationResolvers.Mutation.inviteMember;
	const accept = organizationResolvers.Mutation.acceptInvitation;
	const decline = organizationResolvers.Mutation.declineInvitation;
	const listMembers = organizationResolvers.Query.organizationMembers;
	const resolveMembershipUser = userResolvers.OrganizationMembership.user;

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

	it("re-invites a user who previously declined (INACTIVE row reactivates to PENDING)", async () => {
		// First invite → invitee declines → the row persists as INACTIVE.
		await invite(
			null,
			{ organizationId: orgId, input: { userId: inviteeId, role: "MEMBER" } },
			ctx(ownerId, orgId),
		);
		await decline(null, { organizationId: orgId }, ctx(inviteeId, orgId));

		const [declined] = await db
			.select()
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.userId, inviteeId),
					eq(organizationMembers.organizationId, orgId),
				),
			);
		expect(declined.status).toBe("INACTIVE");

		// Re-inviting must reactivate the same row to PENDING rather than hitting
		// the (userId, organizationId) unique index with a blind insert.
		const reinvited = await invite(
			null,
			{ organizationId: orgId, input: { userId: inviteeId, role: "MANAGER" } },
			ctx(ownerId, orgId),
		);
		expect(reinvited.status).toBe("PENDING");
		expect(reinvited.role).toBe("MANAGER");

		// Exactly one membership row exists for this (user, org) pair.
		const rows = await db
			.select()
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.userId, inviteeId),
					eq(organizationMembers.organizationId, orgId),
				),
			);
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe("PENDING");
	});

	it("hides a PENDING invitee's profile from the inviter, but resolves ACTIVE members", async () => {
		const pending = await invite(
			null,
			{ organizationId: orgId, input: { userId: inviteeId, role: "MEMBER" } },
			ctx(ownerId, orgId),
		);
		expect(pending.status).toBe("PENDING");

		// The FORBIDDEN gate fires before the userById loader is touched, so a
		// bare context (no loaders) is enough to prove the inviter is denied.
		expect(() =>
			resolveMembershipUser(
				{ userId: inviteeId, status: "PENDING" },
				undefined,
				ctx(ownerId, orgId),
			),
		).toThrow(/pending invitee/i);

		// An ACTIVE membership resolves normally; stub the loader the resolver uses.
		const loaded = { id: inviteeId, type: "MEMBER" };
		const activeCtx = {
			...ctx(ownerId, orgId),
			loaders: {
				userById: { load: async (id: string) => ({ ...loaded, id }) },
			},
		} as unknown as GraphQLContext;
		await expect(
			resolveMembershipUser(
				{ userId: inviteeId, status: "ACTIVE" },
				undefined,
				activeCtx,
			),
		).resolves.toMatchObject({ id: inviteeId });
	});
});
