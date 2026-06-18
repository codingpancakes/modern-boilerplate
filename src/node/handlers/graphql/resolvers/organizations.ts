import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { GraphQLError } from "graphql";
import {
	organizationMembers,
	organizations,
	users,
} from "../../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	auditRequestContext,
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

function roleLevel(role: string): number {
	const level = ROLE_HIERARCHY[role];
	if (level === undefined) {
		throw new GraphQLError(`Unknown role: ${role}`, {
			extensions: { code: "INTERNAL_SERVER_ERROR" },
		});
	}
	return level;
}

function hasMinRole(userRole: string, requiredRole: string): boolean {
	return roleLevel(userRole) >= roleLevel(requiredRole);
}

function hasHigherRole(userRole: string, targetRole: string): boolean {
	return roleLevel(userRole) > roleLevel(targetRole);
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
			const clampedLimit = Math.min(Math.max(limit ?? 20, 1), 100);
			// `parsed.createdAt` is the stored timestamp string carried losslessly
			// through the cursor — compare it directly (no Date round-trip) so
			// keyset boundaries hold at full microsecond precision.
			const parsed = cursor ? decodeCursor(cursor) : null;

			const rows = await context.db.query.organizationMembers.findMany({
				where: and(
					eq(organizationMembers.userId, context.userId),
					eq(organizationMembers.status, "ACTIVE"),
					parsed
						? or(
								gt(organizationMembers.createdAt, parsed.createdAt),
								and(
									eq(organizationMembers.createdAt, parsed.createdAt),
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

			const clampedLimit = Math.min(Math.max(limit ?? 20, 1), 100);
			// See myOrganizations: compare the lossless stored-string cursor value.
			const parsed = cursor ? decodeCursor(cursor) : null;

			const rows = await context.db.query.organizationMembers.findMany({
				where: and(
					eq(organizationMembers.organizationId, organizationId),
					eq(organizationMembers.status, "ACTIVE"),
					parsed
						? or(
								gt(organizationMembers.createdAt, parsed.createdAt),
								and(
									eq(organizationMembers.createdAt, parsed.createdAt),
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
			const validated = organizationSchemas.create.parse(input);
			const sanitized = sanitizeObject(validated);

			const result = await context.db.transaction(async (tx) => {
				const ownedOrgs = await tx.query.organizationMembers.findMany({
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

				const [org] = await tx
					.insert(organizations)
					.values({
						...sanitized,
					})
					.returning();

				await tx.insert(organizationMembers).values({
					organizationId: org.id,
					userId: context.userId,
					role: "OWNER",
					status: "ACTIVE",
				});

				return org;
			});

			const org = result;

			void logAudit({
				userId: context.userId,
				organizationId: org.id,
				...auditRequestContext(context),
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

			const { before, updated } = await context.db.transaction(async (tx) => {
				const [b] = await tx
					.select()
					.from(organizations)
					.where(eq(organizations.id, id))
					.limit(1);

				const [u] = await tx
					.update(organizations)
					.set({
						...sanitized,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(organizations.id, id))
					.returning();

				return { before: b, updated: u };
			});

			if (!updated) {
				throw new GraphQLError("Organization not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			void logAudit({
				userId: context.userId,
				organizationId: id,
				...auditRequestContext(context),
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

			const deleted = await context.db.transaction(async (tx) => {
				const [del] = await tx
					.update(organizations)
					.set({
						status: "DELETED",
						updatedAt: new Date().toISOString(),
					})
					.where(eq(organizations.id, id))
					.returning({ id: organizations.id });

				if (!del) return false;

				await tx
					.update(organizationMembers)
					.set({
						status: "INACTIVE",
						updatedAt: new Date().toISOString(),
					})
					.where(eq(organizationMembers.organizationId, id));

				return true;
			});

			if (!deleted) {
				throw new GraphQLError("Organization not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			void logAudit({
				userId: context.userId,
				organizationId: id,
				...auditRequestContext(context),
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

			// The target user must exist — don't mint memberships for arbitrary IDs.
			const targetUser = await context.db.query.users.findFirst({
				where: eq(users.id, validated.userId),
			});
			if (!targetUser) {
				throw new GraphQLError("User not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			// Reject if there's already an active member or an outstanding invite.
			const existing = await context.db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.userId, validated.userId),
					eq(organizationMembers.organizationId, organizationId),
					inArray(organizationMembers.status, ["ACTIVE", "PENDING"]),
				),
			});

			if (existing) {
				throw new GraphQLError(
					existing.status === "PENDING"
						? "User already has a pending invitation to this organization"
						: "User is already a member of this organization",
					{ extensions: { code: "BAD_USER_INPUT" } },
				);
			}

			// Create as PENDING, not ACTIVE: the invitee is invisible to the
			// ACTIVE-filtered member/user queries until they accept, so an invite
			// cannot expose the invitee's data without their consent.
			const [membership] = await context.db
				.insert(organizationMembers)
				.values({
					organizationId,
					userId: validated.userId,
					role: validated.role,
					status: "PENDING",
				})
				.returning();

			void logAudit({
				userId: context.userId,
				organizationId,
				...auditRequestContext(context),
				action: AUDIT_ACTIONS.CREATE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
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

			// Read-check-write in one transaction with the target row locked
			// (FOR UPDATE) so concurrent role changes to the same member can't
			// both pass the role checks and race the write.
			const { updated, target } = await context.db.transaction(async (tx) => {
				const [target] = await tx
					.select()
					.from(organizationMembers)
					.where(
						and(
							eq(organizationMembers.id, validated.memberId),
							eq(organizationMembers.organizationId, organizationId),
							eq(organizationMembers.status, "ACTIVE"),
						),
					)
					.limit(1)
					.for("update");

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

				const [updated] = await tx
					.update(organizationMembers)
					.set({
						role: validated.role,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(organizationMembers.id, validated.memberId))
					.returning();

				return { updated, target };
			});

			void logAudit({
				userId: context.userId,
				organizationId,
				...auditRequestContext(context),
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
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

			const target = await context.db.transaction(async (tx) => {
				const [target] = await tx
					.select()
					.from(organizationMembers)
					.where(
						and(
							eq(organizationMembers.id, memberId),
							eq(organizationMembers.organizationId, organizationId),
							eq(organizationMembers.status, "ACTIVE"),
						),
					)
					.limit(1)
					.for("update");

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

				await tx
					.update(organizationMembers)
					.set({
						status: "INACTIVE",
						updatedAt: new Date().toISOString(),
					})
					.where(eq(organizationMembers.id, memberId));

				return target;
			});

			void logAudit({
				userId: context.userId,
				organizationId,
				...auditRequestContext(context),
				action: AUDIT_ACTIONS.DELETE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
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

			await context.db.transaction(async (tx) => {
				if (membership.role === "OWNER") {
					// Lock the ACTIVE owner rows so two owners can't both pass the
					// "more than one owner" check and leave concurrently → 0 owners.
					const owners = await tx
						.select()
						.from(organizationMembers)
						.where(
							and(
								eq(organizationMembers.organizationId, organizationId),
								eq(organizationMembers.role, "OWNER"),
								eq(organizationMembers.status, "ACTIVE"),
							),
						)
						.for("update");

					if (owners.length <= 1) {
						throw new GraphQLError(
							"Cannot leave: you are the only owner. Transfer ownership first.",
							{ extensions: { code: "FORBIDDEN" } },
						);
					}
				}

				await tx
					.update(organizationMembers)
					.set({
						status: "INACTIVE",
						updatedAt: new Date().toISOString(),
					})
					.where(eq(organizationMembers.id, membership.id));
			});

			void logAudit({
				userId: context.userId,
				organizationId,
				...auditRequestContext(context),
				action: AUDIT_ACTIONS.DELETE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
				resourceId: membership.id,
				status: AUDIT_STATUS.SUCCESS,
				metadata: { source: "graphql", action: "leave_organization" },
			});

			return true;
		},

		// The invited user accepts their own PENDING invite → it becomes ACTIVE.
		acceptInvitation: async (
			_parent: unknown,
			{ organizationId }: { organizationId: string },
			context: GraphQLContext,
		) => {
			const [accepted] = await context.db.transaction(async (tx) => {
				const [invite] = await tx
					.select()
					.from(organizationMembers)
					.where(
						and(
							eq(organizationMembers.userId, context.userId),
							eq(organizationMembers.organizationId, organizationId),
							eq(organizationMembers.status, "PENDING"),
						),
					)
					.limit(1)
					.for("update");

				if (!invite) {
					throw new GraphQLError("No pending invitation found", {
						extensions: { code: "NOT_FOUND" },
					});
				}

				return tx
					.update(organizationMembers)
					.set({ status: "ACTIVE", updatedAt: new Date().toISOString() })
					.where(eq(organizationMembers.id, invite.id))
					.returning();
			});

			void logAudit({
				userId: context.userId,
				organizationId,
				...auditRequestContext(context),
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
				resourceId: accepted.id,
				status: AUDIT_STATUS.SUCCESS,
				metadata: { source: "graphql", action: "accept_invitation" },
			});

			return accepted;
		},

		// The invited user declines their own PENDING invite.
		declineInvitation: async (
			_parent: unknown,
			{ organizationId }: { organizationId: string },
			context: GraphQLContext,
		) => {
			const result = await context.db
				.update(organizationMembers)
				.set({ status: "INACTIVE", updatedAt: new Date().toISOString() })
				.where(
					and(
						eq(organizationMembers.userId, context.userId),
						eq(organizationMembers.organizationId, organizationId),
						eq(organizationMembers.status, "PENDING"),
					),
				)
				.returning();

			if (result.length === 0) {
				throw new GraphQLError("No pending invitation found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			void logAudit({
				userId: context.userId,
				organizationId,
				...auditRequestContext(context),
				action: AUDIT_ACTIONS.DELETE,
				resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
				resourceId: result[0].id,
				status: AUDIT_STATUS.SUCCESS,
				metadata: { source: "graphql", action: "decline_invitation" },
			});

			return true;
		},
	},
};
