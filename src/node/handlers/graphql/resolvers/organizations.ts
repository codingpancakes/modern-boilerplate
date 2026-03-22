import { and, eq } from "drizzle-orm";
import { organizationMembers, organizations } from "../../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "../../../lib/audit";
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
		throw new Error("Organization not found or you are not a member");
	}

	if (minRole && !hasMinRole(membership.role ?? "MEMBER", minRole)) {
		throw new Error(`Requires ${minRole} role or higher`);
	}

	return membership;
}

export const organizationResolvers = {
	Query: {
		myOrganizations: async (
			_parent: unknown,
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.organizationMembers.findMany({
				where: and(
					eq(organizationMembers.userId, context.userId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});
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
			{ organizationId }: { organizationId: string },
			context: GraphQLContext,
		) => {
			await requireMembership(context, organizationId);

			return context.db.query.organizationMembers.findMany({
				where: and(
					eq(organizationMembers.organizationId, organizationId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});
		},
	},

	Mutation: {
		createOrganization: async (
			_parent: unknown,
			{ input }: { input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
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
				throw new Error("No fields to update");
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
				throw new Error("Organization not found");
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

			// Cannot invite at a role higher than your own
			if (!hasMinRole(callerMembership.role ?? "MEMBER", validated.role)) {
				throw new Error("Cannot assign a role higher than your own");
			}

			// Check if user is already a member
			const existing = await context.db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.userId, validated.userId),
					eq(organizationMembers.organizationId, organizationId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});

			if (existing) {
				throw new Error("User is already a member of this organization");
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
				throw new Error("Membership not found");
			}

			// Cannot change role of someone with equal or higher rank (strictly higher required)
			if (
				!hasHigherRole(
					callerMembership.role ?? "MEMBER",
					target.role ?? "MEMBER",
				)
			) {
				throw new Error("Cannot modify a member with equal or higher role");
			}

			// Cannot promote above own role
			if (!hasMinRole(callerMembership.role ?? "MEMBER", validated.role)) {
				throw new Error("Cannot assign a role higher than your own");
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
				throw new Error("Membership not found");
			}

			// Cannot remove someone with equal or higher rank (strictly higher required)
			if (
				!hasHigherRole(
					callerMembership.role ?? "MEMBER",
					target.role ?? "MEMBER",
				)
			) {
				throw new Error("Cannot remove a member with equal or higher role");
			}

			// Cannot remove yourself (use leaveOrganization instead)
			if (target.userId === context.userId) {
				throw new Error(
					"Cannot remove yourself. Use leaveOrganization instead.",
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

			// Owners cannot leave -- must transfer ownership first
			if (membership.role === "OWNER") {
				// Check if there's another owner
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
					throw new Error(
						"Cannot leave: you are the only owner. Transfer ownership first.",
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
