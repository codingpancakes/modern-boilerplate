import { and, desc, eq, isNull } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { z } from "zod";
import {
	auditLogs,
	organizationMembers,
	users,
} from "../../../db/schema/index";
import { validate } from "../../../lib/validation/helpers";
import type { GraphQLContext } from "../context";
import { toGraphQLError } from "../errors";

const ADMIN_ROLES = new Set(["ADMIN", "OWNER"]);

function parseInput<T>(schema: z.ZodSchema<T>, input: unknown): T {
	try {
		return validate(schema, input);
	} catch (error) {
		throw toGraphQLError(error);
	}
}

const optionalUuid = z
	.union([z.string().uuid(), z.null()])
	.optional()
	.transform((value) => value ?? undefined);

const optionalFilter = z
	.union([z.string().min(1).max(100), z.null()])
	.optional()
	.transform((value) => value ?? undefined);

const auditLogsArgs = z.object({
	organizationId: optionalUuid,
	userId: optionalUuid,
	limit: z.number().int().min(1).max(200).optional(),
	action: optionalFilter,
	resourceType: optionalFilter,
});

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
			const filters = parseInput(auditLogsArgs, {
				organizationId,
				userId,
				limit,
				action,
				resourceType,
			});

			if (filters.organizationId) {
				await requireAuditReadAccess(context, filters.organizationId);
			} else {
				await requireSystemAuditReadAccess(context);
			}

			const clampedLimit = filters.limit ?? 50;

			const rows = await context.db
				.select()
				.from(auditLogs)
				.where(
					and(
						filters.organizationId
							? eq(auditLogs.organizationId, filters.organizationId)
							: isNull(auditLogs.organizationId),
						filters.userId ? eq(auditLogs.userId, filters.userId) : undefined,
						filters.action ? eq(auditLogs.action, filters.action) : undefined,
						filters.resourceType
							? eq(auditLogs.resourceType, filters.resourceType)
							: undefined,
					),
				)
				.orderBy(desc(auditLogs.timestamp))
				.limit(clampedLimit);

			return rows;
		},
	},
};
