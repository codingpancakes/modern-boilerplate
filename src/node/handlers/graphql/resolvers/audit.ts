import { and, desc, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { auditLogs, organizationMembers } from "../../../db/schema/index";
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

export const auditResolvers = {
	Query: {
		auditLogs: async (
			_parent: unknown,
			{
				organizationId,
				limit = 50,
				action,
				resourceType,
			}: {
				organizationId: string;
				limit?: number;
				action?: string;
				resourceType?: string;
			},
			context: GraphQLContext,
		) => {
			await requireAuditReadAccess(context, organizationId);

			const clampedLimit = Math.min(Math.max(limit ?? 50, 1), 200);

			const rows = await context.db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.organizationId, organizationId),
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
