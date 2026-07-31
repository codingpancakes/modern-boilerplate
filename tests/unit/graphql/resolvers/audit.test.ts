import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLContext } from "@/handlers/graphql/context";
import { auditResolvers } from "@/handlers/graphql/resolvers/audit";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

type MockContext = GraphQLContext & {
	db: GraphQLContext["db"] & {
		select: ReturnType<typeof vi.fn>;
		query: GraphQLContext["db"]["query"] & {
			organizationMembers: {
				findFirst: ReturnType<typeof vi.fn>;
			};
			users: {
				findFirst: ReturnType<typeof vi.fn>;
			};
		};
	};
};

function createMockContext(options: {
	membership?: { role?: string } | null;
	user?: { id: string; type: string } | null;
	rows?: unknown[];
}): MockContext {
	const limit = vi.fn().mockResolvedValue(options.rows ?? []);
	const orderBy = vi.fn().mockReturnValue({ limit });
	const where = vi.fn().mockReturnValue({ orderBy });
	const from = vi.fn().mockReturnValue({ where });
	const select = vi.fn().mockReturnValue({ from });

	return {
		userId: "current-user-id",
		organizationId: "current-org-id",
		role: "MEMBER",
		email: "test@example.com",
		providerSubject: "workos-123",
		claims: {},
		requestId: "test-request-id",
		db: {
			query: {
				organizationMembers: {
					findFirst: vi.fn().mockResolvedValue(options.membership),
				},
				users: {
					findFirst: vi.fn().mockResolvedValue(options.user),
				},
			},
			select,
		} as unknown as MockContext["db"],
		loaders: {} as unknown as GraphQLContext["loaders"],
	} as MockContext;
}

describe("Audit Resolvers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns organization audit logs for an active admin", async () => {
		const rows = [{ id: "audit-1", organizationId: ORG_ID }];
		const context = createMockContext({
			membership: { role: "ADMIN" },
			rows,
		});

		const result = await auditResolvers.Query.auditLogs(
			null,
			{ organizationId: ORG_ID, limit: 200, action: "UPDATE" },
			context,
		);

		expect(result).toEqual(rows);
		expect(
			context.db.query.organizationMembers.findFirst,
		).toHaveBeenCalledOnce();
		expect(context.db.query.users.findFirst).not.toHaveBeenCalled();
		expect(context.db.select).toHaveBeenCalledOnce();
	});

	it("rejects organization audit logs for a non-admin member", async () => {
		const context = createMockContext({
			membership: { role: "MEMBER" },
		});

		await expect(
			auditResolvers.Query.auditLogs(
				null,
				{ organizationId: ORG_ID },
				context,
			),
		).rejects.toThrow("Requires ADMIN role or higher");

		expect(context.db.select).not.toHaveBeenCalled();
	});

	it("returns org-less audit logs for operator users", async () => {
		const rows = [{ id: "audit-2", organizationId: null, userId: USER_ID }];
		const context = createMockContext({
			user: { id: "current-user-id", type: "OPERATOR" },
			rows,
		});

		const result = await auditResolvers.Query.auditLogs(
			null,
			{ userId: USER_ID, resourceType: "WEBHOOK" },
			context,
		);

		expect(result).toEqual(rows);
		expect(context.db.query.users.findFirst).toHaveBeenCalledOnce();
		expect(
			context.db.query.organizationMembers.findFirst,
		).not.toHaveBeenCalled();
		expect(context.db.select).toHaveBeenCalledOnce();
	});

	it("rejects org-less audit logs for non-operator users", async () => {
		const context = createMockContext({
			user: { id: "current-user-id", type: "MEMBER" },
		});

		await expect(
			auditResolvers.Query.auditLogs(null, { userId: USER_ID }, context),
		).rejects.toThrow("Requires OPERATOR user type");

		expect(context.db.select).not.toHaveBeenCalled();
	});

	it("rejects invalid scalar filters before checking access", async () => {
		const context = createMockContext({
			user: { id: "current-user-id", type: "OPERATOR" },
		});

		await expect(
			auditResolvers.Query.auditLogs(null, { userId: "not-a-uuid" }, context),
		).rejects.toMatchObject({
			extensions: {
				code: "BAD_USER_INPUT",
				http: { status: 400 },
			},
		});

		expect(context.db.query.users.findFirst).not.toHaveBeenCalled();
		expect(context.db.select).not.toHaveBeenCalled();
	});
});
