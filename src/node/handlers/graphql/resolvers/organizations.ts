import { and, asc, eq, gt, or } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { organizationMembers, organizations } from "../../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "../../../lib/audit";
import { createPaginatedResponse, decodeCursor } from "../../../lib/pagination";
import { sanitizeObject } from "../../../lib/sanitize";
import { organizationSchemas } from "../../../lib/validation";
import type { GraphQLContext } from "../context";

const ROLE_HIERARCHY: Record<string, number> = {
	VIEWER: 0,
	MEMBER: 1,
	MANAGER: 2,
	ADMIN: 3,
	OWNER: 4,
};

function hasMinRole(userRole: string, requiredRole: string): boolean {
	return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}

function hasHigherRole(userRole: string, targetRole: string): boolean {
	return (ROLE_HIERARCHY[userRole] ?? 0) > (ROLE_HIERARCHY[targetRole] ?? 0);
}

async function requireMembership(
	context: GraphQLContext,
	organizationId: string,
	minRole?: string,
) {
	const membership = await context.db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.userId, context.userId),
			eq(organizationMembers.organizationId, organizationId),
			eq(organizationMembers.status, "ACTIVE"),
		),
	});

	if (!membership) {
		throw new GraphQLError("Organization not found or you are not a member", {
			extensions: { code: "FORBIDDEN" },
		});
	}

	if (minRole && !hasMinRole(membership.role ?? "MEMBER", minRole)) {
		throw new GraphQLError(`Requires ${minRole} role or higher`, {
			extensions: { code: "FORBIDDEN" },
		});
	}

	return membership;
}

export const organizationResolvers = {
	Query: {
		myOrganizations: async (
			_parent: unknown,
			{ limit = 20, cursor }: { limit?: number; cursor?: string },
			context: GraphQLContext,
		) => {
			const clampedLimit = Math.min(limit, 100);
			const parsed = cursor ? decodeCursor(cursor) : null;
			const cursorTs = parsed ? new Date(parsed.timestamp).toISOString() : null;

			const rows = await context.db.query.organizationMembers.findMany({
				where: and(
					eq(organizationMembers.userId, context.userId),
					eq(organizationMembers.status, "ACTIVE"),
					parsed && cursorTs
						? or(
								gt(organizationMembers.createdAt, cursorTs),
								and(
									eq(organizationMembers.createdAt, cursorTs),
									gt(organizationMembers.id, parsed.id),
								),
							)
						: undefined,
				),
				orderBy: [
					asc(organizationMembers.createdAt),
					asc(organizationMembers.id),
				],
				limit: clampedLimit + 1,
			});

			return createPaginatedResponse(
				rows as ((typeof rows)[0] & { createdAt: string })[],
				clampedLimit,
			);
		},

		organization: async (
			_parent: unknown,
			{ id }: { id: string },
			context: GraphQLContext,
		) => {
			await requireMembership(context, id);

			return context.db.query.organizations.findFirst({
				where: eq(organizations.id, id),
			});
		},

		organizationMembers: async (
			_parent: unknown,
			{
				organizationId,
				limit = 20,
				cursor,
			}: { organizationId: string; limit?: number; cursor?: string },
			context: GraphQLContext,
		) => {
			await requireMembership(context, organizationId);

			const clampedLimit = Math.min(limit, 100);
			const parsed = cursor ? decodeCursor(cursor) : null;
			const cursorTs = parsed ? new Date(parsed.timestamp).toISOString() : null;

			const rows = await context.db.query.organizationMembers.findMany({
				where: and(
					eq(organizationMembers.organizationId, organizationId),
					eq(organizationMembers.status, "ACTIVE"),
					parsed && cursorTs
						? or(
								gt(organizationMembers.createdAt, cursorTs),
								and(
									eq(organizationMembers.createdAt, cursorTs),
									gt(organizationMembers.id, parsed.id),
								),
							)
						: undefined,
				),
				orderBy: [
					asc(organizationMembers.createdAt),
					asc(organizationMembers.id),
				],
				limit: clampedLimit + 1,
			});

			return createPaginatedResponse(
				rows as ((typeof rows)[0] & { createdAt: string })[],
				clampedLimit,
			);
		},
	},

	Mutation: {
		createOrganization: async (
			_parent: unknown,
			{ input }: { input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const ownedOrgs = await context.db.query.organizationMembers.findMany({
				where: and(
					eq(organizationMembers.userId, context.userId),
					eq(organizationMembers.role, "OWNER"),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});

			if (ownedOrgs.length >= 10) {
				throw new GraphQLError("Organization limit reached (max 10)", {
					extensions: { code: "FORBIDDEN" },
				});
			}

			const validated = organizationSchemas.create.parse(input);
			const sanitized = sanitizeObject(validated);

			const [org] = await context.db
				.insert(organizations)
				.values({
					...sanitized,
				})
				.returning();

			// Creator becomes OWNER
			await context.db.insert(organizationMembers).values({
				organizationId: org.id,
				userId: context.userId,
				role: "OWNER",
				status: "ACTIVE",
			});

			void logAudit({
				userId: context.userId,
				organizationId: org.id,
				action: AUDIT_ACTIONS.CREATE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
				resourceId: org.id,
				status: AUDIT_STATUS.SUCCESS,
				metadata: { source: "graphql" },
			});

			return org;
		},

		updateOrganization: async (
			_parent: unknown,
			{ id, input }: { id: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			await requireMembership(context, id, "ADMIN");

			const validated = organizationSchemas.update.parse(input);
			const sanitized = sanitizeObject(validated);

			if (Object.keys(sanitized).length === 0) {
				throw new GraphQLError("No fields to update", {
					extensions: { code: "BAD_USER_INPUT" },
				});
			}

			const [before] = await context.db
				.select()
				.from(organizations)
				.where(eq(organizations.id, id))
				.limit(1);

			const [updated] = await context.db
				.update(organizations)
				.set({
					...sanitized,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(organizations.id, id))
				.returning();

			if (!updated) {
				throw new GraphQLError("Organization not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			void logAudit({
				userId: context.userId,
				organizationId: id,
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
				resourceId: id,
				changes: { before, after: updated },
				status: AUDIT_STATUS.SUCCESS,
				metadata: {
					source: "graphql",
					updatedFields: Object.keys(validated),
				},
			});

			return updated;
		},

		deleteOrganization: async (
			_parent: unknown,
			{ id }: { id: string },
			context: GraphQLContext,
		) => {
			await requireMembership(context, id, "OWNER");

			// Soft-delete: mark org as DELETED, deactivate all memberships
			await context.db
				.update(organizations)
				.set({ status: "DELETED", updatedAt: new Date().toISOString() })
				.where(eq(organizations.id, id));

			await context.db
				.update(organizationMembers)
				.set({ status: "INACTIVE", updatedAt: new Date().toISOString() })
				.where(eq(organizationMembers.organizationId, id));

			void logAudit({
				userId: context.userId,
				organizationId: id,
				action: AUDIT_ACTIONS.DELETE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
				resourceId: id,
				status: AUDIT_STATUS.SUCCESS,
				metadata: { source: "graphql" },
			});

			return true;
		},

		inviteMember: async (
			_parent: unknown,
			{
				organizationId,
				input,
			}: { organizationId: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const callerMembership = await requireMembership(
				context,
				organizationId,
				"ADMIN",
			);

			const validated = organizationSchemas.inviteMember.parse(input);

			if (!hasMinRole(callerMembership.role ?? "MEMBER", validated.role)) {
				throw new GraphQLError("Cannot assign a role higher than your own", {
					extensions: { code: "FORBIDDEN" },
				});
			}

			const existing = await context.db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.userId, validated.userId),
					eq(organizationMembers.organizationId, organizationId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});

			if (existing) {
				throw new GraphQLError(
					"User is already a member of this organization",
					{ extensions: { code: "BAD_USER_INPUT" } },
				);
			}

			const [membership] = await context.db
				.insert(organizationMembers)
				.values({
					organizationId,
					userId: validated.userId,
					role: validated.role,
					status: "ACTIVE",
				})
				.returning();

			void logAudit({
				userId: context.userId,
				organizationId,
				action: AUDIT_ACTIONS.CREATE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
				resourceId: membership.id,
				status: AUDIT_STATUS.SUCCESS,
				metadata: {
					source: "graphql",
					action: "invite_member",
					targetUserId: validated.userId,
					role: validated.role,
				},
			});

			return membership;
		},

		updateMemberRole: async (
			_parent: unknown,
			{
				organizationId,
				input,
			}: { organizationId: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const callerMembership = await requireMembership(
				context,
				organizationId,
				"ADMIN",
			);

			const validated = organizationSchemas.updateMemberRole.parse(input);

			// Fetch target membership
			const [target] = await context.db
				.select()
				.from(organizationMembers)
				.where(
					and(
						eq(organizationMembers.id, validated.memberId),
						eq(organizationMembers.organizationId, organizationId),
						eq(organizationMembers.status, "ACTIVE"),
					),
				)
				.limit(1);

			if (!target) {
				throw new GraphQLError("Membership not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			if (
				!hasHigherRole(
					callerMembership.role ?? "MEMBER",
					target.role ?? "MEMBER",
				)
			) {
				throw new GraphQLError(
					"Cannot modify a member with equal or higher role",
					{ extensions: { code: "FORBIDDEN" } },
				);
			}

			if (!hasMinRole(callerMembership.role ?? "MEMBER", validated.role)) {
				throw new GraphQLError("Cannot assign a role higher than your own", {
					extensions: { code: "FORBIDDEN" },
				});
			}

			const [updated] = await context.db
				.update(organizationMembers)
				.set({
					role: validated.role,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(organizationMembers.id, validated.memberId))
				.returning();

			void logAudit({
				userId: context.userId,
				organizationId,
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
				resourceId: validated.memberId,
				changes: {
					before: { role: target.role },
					after: { role: validated.role },
				},
				status: AUDIT_STATUS.SUCCESS,
				metadata: {
					source: "graphql",
					action: "update_member_role",
					targetUserId: target.userId,
				},
			});

			return updated;
		},

		removeMember: async (
			_parent: unknown,
			{
				organizationId,
				memberId,
			}: { organizationId: string; memberId: string },
			context: GraphQLContext,
		) => {
			const callerMembership = await requireMembership(
				context,
				organizationId,
				"ADMIN",
			);

			const [target] = await context.db
				.select()
				.from(organizationMembers)
				.where(
					and(
						eq(organizationMembers.id, memberId),
						eq(organizationMembers.organizationId, organizationId),
						eq(organizationMembers.status, "ACTIVE"),
					),
				)
				.limit(1);

			if (!target) {
				throw new GraphQLError("Membership not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			if (
				!hasHigherRole(
					callerMembership.role ?? "MEMBER",
					target.role ?? "MEMBER",
				)
			) {
				throw new GraphQLError(
					"Cannot remove a member with equal or higher role",
					{ extensions: { code: "FORBIDDEN" } },
				);
			}

			if (target.userId === context.userId) {
				throw new GraphQLError(
					"Cannot remove yourself. Use leaveOrganization instead.",
					{ extensions: { code: "BAD_USER_INPUT" } },
				);
			}

			await context.db
				.update(organizationMembers)
				.set({
					status: "INACTIVE",
					updatedAt: new Date().toISOString(),
				})
				.where(eq(organizationMembers.id, memberId));

			void logAudit({
				userId: context.userId,
				organizationId,
				action: AUDIT_ACTIONS.DELETE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
				resourceId: memberId,
				status: AUDIT_STATUS.SUCCESS,
				metadata: {
					source: "graphql",
					action: "remove_member",
					targetUserId: target.userId,
				},
			});

			return true;
		},

		leaveOrganization: async (
			_parent: unknown,
			{ organizationId }: { organizationId: string },
			context: GraphQLContext,
		) => {
			const membership = await requireMembership(context, organizationId);

			if (membership.role === "OWNER") {
				const otherOwners = await context.db.query.organizationMembers.findMany(
					{
						where: and(
							eq(organizationMembers.organizationId, organizationId),
							eq(organizationMembers.role, "OWNER"),
							eq(organizationMembers.status, "ACTIVE"),
						),
					},
				);

				if (otherOwners.length <= 1) {
					throw new GraphQLError(
						"Cannot leave: you are the only owner. Transfer ownership first.",
						{ extensions: { code: "FORBIDDEN" } },
					);
				}
			}

			await context.db
				.update(organizationMembers)
				.set({
					status: "INACTIVE",
					updatedAt: new Date().toISOString(),
				})
				.where(eq(organizationMembers.id, membership.id));

			void logAudit({
				userId: context.userId,
				organizationId,
				action: AUDIT_ACTIONS.DELETE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
				resourceId: membership.id,
				status: AUDIT_STATUS.SUCCESS,
				metadata: { source: "graphql", action: "leave_organization" },
			});

			return true;
		},
	},
};
