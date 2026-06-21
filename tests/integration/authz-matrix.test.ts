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

// Resolvers reach the DB (and fire-and-forget logAudit) via getDb(); route it
// to the real test engine, exactly as org-invite.test.ts does.
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
 * AUTHORIZATION REGRESSION MATRIX.
 *
 * The org resolvers enforce tenant- and role-scoped access in code
 * (`requireMembership` + role-hierarchy checks). That logic is correct today,
 * but it's enforced by hand in every resolver — exactly the kind of invariant
 * that silently regresses when someone adds a mutation and forgets the gate.
 *
 * This suite turns "I read the code and it looks right" into "the build fails
 * if anyone weakens a gate". Every org-scoped operation is asserted to DENY:
 *   1. a non-member          (tenant isolation)
 *   2. an under-privileged member (role floor)
 *   3. a member of a DIFFERENT org  (cross-tenant isolation)
 *   4. privilege escalation  (assign/modify a role >= your own)
 *   5. removing the last owner (integrity)
 *
 * Run against real Postgres because `requireMembership` issues real queries.
 */
describe("authorization matrix (org resolvers)", () => {
	let db: TestDb;
	let pool: Pool;

	const ctx = (userId: string, organizationId: string): GraphQLContext =>
		({
			userId,
			organizationId,
			requestId: "test-req",
			db: db as unknown as GraphQLContext["db"],
		}) as GraphQLContext;

	// org A principals
	const ownerId = "11111111-1111-1111-1111-111111111111";
	const adminId = "22222222-2222-2222-2222-222222222222";
	const memberId = "33333333-3333-3333-3333-333333333333";
	const targetMemberUserId = "44444444-4444-4444-4444-444444444444";
	const outsiderId = "55555555-5555-5555-5555-555555555555";
	// org B owner (for cross-tenant checks)
	const otherOwnerId = "66666666-6666-6666-6666-666666666666";

	let orgA: string;
	let orgB: string;
	let targetMembershipId: string; // an ACTIVE MEMBER row in org A (a valid victim)
	let ownerMembershipIdA: string; // org A OWNER membership row

	const M = organizationResolvers.Mutation;
	const Q = organizationResolvers.Query;

	beforeAll(async () => {
		const t = await createTestDb();
		db = t.db;
		pool = t.pool;
		getDbMock.mockResolvedValue(db);
	});
	afterAll(async () => {
		await pool.end();
	});

	// The role column is an enum; keep the param to the role union so Drizzle's
	// insert typing is satisfied (a plain `string` widens it and fails tsc).
	type MemberRole = NonNullable<
		(typeof organizationMembers.$inferInsert)["role"]
	>;
	const insertMember = async (
		organizationId: string,
		userId: string,
		role: MemberRole,
	) => {
		const [row] = await db
			.insert(organizationMembers)
			.values({ organizationId, userId, role, status: "ACTIVE" })
			.returning();
		return row.id;
	};

	beforeEach(async () => {
		await truncateOrganizations(pool);
		await truncateUserGraph(pool);
		await db.insert(users).values([
			{ id: ownerId, type: "MEMBER" },
			{ id: adminId, type: "MEMBER" },
			{ id: memberId, type: "MEMBER" },
			{ id: targetMemberUserId, type: "MEMBER" },
			{ id: outsiderId, type: "MEMBER" },
			{ id: otherOwnerId, type: "MEMBER" },
		]);
		const [a] = await db
			.insert(organizations)
			.values({ name: "Acme", slug: "acme" })
			.returning();
		const [b] = await db
			.insert(organizations)
			.values({ name: "Globex", slug: "globex" })
			.returning();
		orgA = a.id;
		orgB = b.id;

		ownerMembershipIdA = await insertMember(orgA, ownerId, "OWNER");
		await insertMember(orgA, adminId, "ADMIN");
		await insertMember(orgA, memberId, "MEMBER");
		targetMembershipId = await insertMember(orgA, targetMemberUserId, "MEMBER");
		// outsiderId is deliberately NOT a member of org A.
		await insertMember(orgB, otherOwnerId, "OWNER");
	});
	afterEach(async () => {
		// Let fire-and-forget audit writes drain before truncating (see org-invite).
		await new Promise((resolve) => setTimeout(resolve, 50));
		await truncateOrganizations(pool);
		await truncateUserGraph(pool);
	});

	// Each gated op, invoked with otherwise-valid args so any rejection is
	// authorization, not input validation. `requireMembership` runs first in
	// every one of these, so a caller without the membership/role is denied
	// before any argument parsing.
	const gatedOps: Array<{
		name: string;
		run: (callerId: string, organizationId: string) => Promise<unknown>;
	}> = [
		{
			name: "Query.organizationMembers",
			run: (c, org) =>
				Q.organizationMembers(null, { organizationId: org }, ctx(c, org)),
		},
		{
			name: "Mutation.updateOrganization",
			run: (c, org) =>
				M.updateOrganization(
					null,
					{ id: org, input: { name: "Renamed" } },
					ctx(c, org),
				),
		},
		{
			name: "Mutation.inviteMember",
			run: (c, org) =>
				M.inviteMember(
					null,
					{
						organizationId: org,
						input: { userId: outsiderId, role: "MEMBER" },
					},
					ctx(c, org),
				),
		},
		{
			name: "Mutation.updateMemberRole",
			run: (c, org) =>
				M.updateMemberRole(
					null,
					{
						organizationId: org,
						input: { memberId: targetMembershipId, role: "MANAGER" },
					},
					ctx(c, org),
				),
		},
		{
			name: "Mutation.removeMember",
			run: (c, org) =>
				M.removeMember(
					null,
					{ organizationId: org, memberId: targetMembershipId },
					ctx(c, org),
				),
		},
	];

	describe("tenant isolation — a non-member is denied every org-scoped op", () => {
		for (const op of gatedOps) {
			it(`${op.name} denies a non-member`, async () => {
				await expect(op.run(outsiderId, orgA)).rejects.toThrow(
					/not a member|forbidden|requires/i,
				);
			});
		}
	});

	describe("role floor — an ADMIN-gated op denies a plain MEMBER", () => {
		// organizationMembers only needs membership, so exclude it here.
		const adminGated = gatedOps.filter(
			(o) => o.name !== "Query.organizationMembers",
		);
		for (const op of adminGated) {
			it(`${op.name} denies a MEMBER (needs ADMIN+)`, async () => {
				await expect(op.run(memberId, orgA)).rejects.toThrow(
					/requires ADMIN|forbidden/i,
				);
			});
		}
	});

	describe("cross-tenant isolation — org-A OWNER cannot act on org B", () => {
		for (const op of gatedOps) {
			it(`${op.name} denies an owner of a different org`, async () => {
				// ownerId owns org A but has no membership in org B → must be denied.
				await expect(op.run(ownerId, orgB)).rejects.toThrow(
					/not a member|forbidden|requires/i,
				);
			});
		}
	});

	describe("privilege escalation is blocked", () => {
		it("ADMIN cannot invite a member at a role higher than their own (OWNER)", async () => {
			await expect(
				M.inviteMember(
					null,
					{
						organizationId: orgA,
						input: { userId: outsiderId, role: "OWNER" },
					},
					ctx(adminId, orgA),
				),
			).rejects.toThrow(/higher than your own/i);
		});

		it("ADMIN cannot modify a member with an equal-or-higher role (the OWNER)", async () => {
			await expect(
				M.updateMemberRole(
					null,
					{
						organizationId: orgA,
						input: { memberId: ownerMembershipIdA, role: "MEMBER" },
					},
					ctx(adminId, orgA),
				),
			).rejects.toThrow(/equal or higher role/i);
		});

		it("ADMIN cannot remove a member with an equal-or-higher role (the OWNER)", async () => {
			await expect(
				M.removeMember(
					null,
					{ organizationId: orgA, memberId: ownerMembershipIdA },
					ctx(adminId, orgA),
				),
			).rejects.toThrow(/equal or higher role/i);
		});

		it("ADMIN cannot promote a member to a role higher than their own", async () => {
			await expect(
				M.updateMemberRole(
					null,
					{
						organizationId: orgA,
						input: { memberId: targetMembershipId, role: "OWNER" },
					},
					ctx(adminId, orgA),
				),
			).rejects.toThrow(/higher than your own/i);
		});
	});

	describe("integrity — sole-owner protection", () => {
		it("the only OWNER cannot leave the organization", async () => {
			await expect(
				M.leaveOrganization(null, { organizationId: orgA }, ctx(ownerId, orgA)),
			).rejects.toThrow(/only owner/i);
		});
	});

	describe("positive control — a legitimately-privileged caller succeeds", () => {
		it("ADMIN can update an org (proves the gate isn't deny-all)", async () => {
			const result = await M.updateOrganization(
				null,
				{ id: orgA, input: { name: "Acme Renamed" } },
				ctx(adminId, orgA),
			);
			expect(result).toMatchObject({ name: "Acme Renamed" });
		});

		it("ADMIN can update a lower-ranked member's role", async () => {
			const result = await M.updateMemberRole(
				null,
				{
					organizationId: orgA,
					input: { memberId: targetMembershipId, role: "MANAGER" },
				},
				ctx(adminId, orgA),
			);
			expect(result).toMatchObject({ role: "MANAGER" });
		});
	});
});
