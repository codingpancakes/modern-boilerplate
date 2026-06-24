import { and, desc, eq, isNull } from "drizzle-orm";
import { GraphQLError } from "graphql";
import {
	auditLogs,
	organizationMembers,
	users,
} from "../../../db/schema/index";
import type { GraphQLContext } from "../context";

const ADMIN_ROLES = new Set(["ADMIN", "OWNER"]);

/**
 * Ensure the caller is an active ADMIN/OWNER of the target organization before
 * exposing its audit trail. Audit logs are sensitive, so read access is gated
 * the same way privileged org mutations are.
 */
async function requireAuditReadAccess(
	context: GraphQLContext,
	organizationId: string,
): Promise<void> {
	const membership = await context.db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.userId, context.userId),
			eq(organizationMembers.organizationId, organizationId),
			eq(organizationMembers.status, "ACTIVE"),
		),
	});

	if (!membership || !ADMIN_ROLES.has(membership.role ?? "MEMBER")) {
		throw new GraphQLError("Requires ADMIN role or higher", {
			extensions: { code: "FORBIDDEN" },
		});
	}
}

async function requireSystemAuditReadAccess(
	context: GraphQLContext,
): Promise<void> {
	const user = await context.db.query.users.findFirst({
		where: eq(users.id, context.userId),
	});

	if (user?.type !== "OPERATOR") {
		throw new GraphQLError("Requires OPERATOR user type", {
			extensions: { code: "FORBIDDEN" },
		});
	}
}

export const auditResolvers = {
	Query: {
		auditLogs: async (
			_parent: unknown,
			{
				organizationId,
				userId,
				limit = 50,
				action,
				resourceType,
			}: {
				organizationId?: string | null;
				userId?: string | null;
				limit?: number;
				action?: string | null;
				resourceType?: string | null;
			},
			context: GraphQLContext,
		) => {
			if (organizationId) {
				await requireAuditReadAccess(context, organizationId);
			} else {
				await requireSystemAuditReadAccess(context);
			}

			const clampedLimit = Math.min(Math.max(limit ?? 50, 1), 200);

			const rows = await context.db
				.select()
				.from(auditLogs)
				.where(
					and(
						organizationId
							? eq(auditLogs.organizationId, organizationId)
							: isNull(auditLogs.organizationId),
						userId ? eq(auditLogs.userId, userId) : undefined,
						action ? eq(auditLogs.action, action) : undefined,
						resourceType ? eq(auditLogs.resourceType, resourceType) : undefined,
					),
				)
				.orderBy(desc(auditLogs.timestamp))
				.limit(clampedLimit);

			return rows;
		},
	},
};
