import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import type { z } from "zod";
import {
	organizationMembers,
	organizations,
	users,
} from "../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	type AuditContext,
	logAudit,
} from "../audit";
import type { DbInstance } from "../db";
import { ApiError } from "../errors";
import { createPaginatedResponse, decodeCursor } from "../pagination";
import { sanitizeObject } from "../sanitize";
import type { organizationSchemas } from "../validation";

type CreateOrganizationInput = z.infer<typeof organizationSchemas.create>;
type UpdateOrganizationInput = z.infer<typeof organizationSchemas.update>;
type InviteMemberInput = z.infer<typeof organizationSchemas.inviteMember>;
type UpdateMemberRoleInput = z.infer<
	typeof organizationSchemas.updateMemberRole
>;

export const ROLE_HIERARCHY: Record<string, number> = {
	VIEWER: 0,
	MEMBER: 1,
	MANAGER: 2,
	ADMIN: 3,
	OWNER: 4,
};

export function roleLevel(role: string): number {
	const level = ROLE_HIERARCHY[role];
	if (level === undefined) {
		throw new ApiError(500, "INTERNAL_SERVER_ERROR", `Unknown role: ${role}`);
	}
	return level;
}

export function hasMinRole(userRole: string, requiredRole: string): boolean {
	return roleLevel(userRole) >= roleLevel(requiredRole);
}

export function hasHigherRole(userRole: string, targetRole: string): boolean {
	return roleLevel(userRole) > roleLevel(targetRole);
}

export async function requireActiveMembership(
	db: DbInstance,
	userId: string,
	organizationId: string,
	minRole?: string,
) {
	const membership = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.userId, userId),
			eq(organizationMembers.organizationId, organizationId),
			eq(organizationMembers.status, "ACTIVE"),
		),
	});

	if (!membership) {
		throw new ApiError(
			403,
			"FORBIDDEN",
			"Organization not found or you are not a member",
		);
	}

	if (minRole && !hasMinRole(membership.role ?? "MEMBER", minRole)) {
		throw new ApiError(403, "FORBIDDEN", `Requires ${minRole} role or higher`);
	}

	return membership;
}

export function assertCanAssignRole(
	actorRole: string,
	targetRole: string,
): void {
	if (!hasMinRole(actorRole, targetRole)) {
		throw new ApiError(
			403,
			"FORBIDDEN",
			"Cannot assign a role higher than your own",
		);
	}
}

export function assertCanModifyRole(
	actorRole: string,
	targetRole: string,
): void {
	if (!hasHigherRole(actorRole, targetRole)) {
		throw new ApiError(
			403,
			"FORBIDDEN",
			"Cannot modify a member with equal or higher role",
		);
	}
}

export function assertCanRemoveRole(
	actorRole: string,
	targetRole: string,
): void {
	if (!hasHigherRole(actorRole, targetRole)) {
		throw new ApiError(
			403,
			"FORBIDDEN",
			"Cannot remove a member with equal or higher role",
		);
	}
}

interface OrganizationServiceOptions {
	db: DbInstance;
	actorUserId: string;
	auditContext: AuditContext;
	source: "graphql";
}

export async function listMyOrganizations(options: {
	db: DbInstance;
	userId: string;
	limit?: number;
	cursor?: string;
}) {
	const clampedLimit = Math.min(Math.max(options.limit ?? 20, 1), 100);
	const parsed = options.cursor ? decodeCursor(options.cursor) : null;

	const rows = await options.db.query.organizationMembers.findMany({
		where: and(
			eq(organizationMembers.userId, options.userId),
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
		orderBy: [asc(organizationMembers.createdAt), asc(organizationMembers.id)],
		limit: clampedLimit + 1,
	});

	return createPaginatedResponse(
		rows as ((typeof rows)[0] & { createdAt: string })[],
		clampedLimit,
	);
}

export async function getOrganization(options: {
	db: DbInstance;
	userId: string;
	organizationId: string;
}) {
	await requireActiveMembership(
		options.db,
		options.userId,
		options.organizationId,
	);

	return options.db.query.organizations.findFirst({
		where: eq(organizations.id, options.organizationId),
	});
}

export async function listOrganizationMembers(options: {
	db: DbInstance;
	userId: string;
	organizationId: string;
	limit?: number;
	cursor?: string;
}) {
	await requireActiveMembership(
		options.db,
		options.userId,
		options.organizationId,
	);

	const clampedLimit = Math.min(Math.max(options.limit ?? 20, 1), 100);
	const parsed = options.cursor ? decodeCursor(options.cursor) : null;

	const rows = await options.db.query.organizationMembers.findMany({
		where: and(
			eq(organizationMembers.organizationId, options.organizationId),
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
		orderBy: [asc(organizationMembers.createdAt), asc(organizationMembers.id)],
		limit: clampedLimit + 1,
	});

	return createPaginatedResponse(
		rows as ((typeof rows)[0] & { createdAt: string })[],
		clampedLimit,
	);
}

export async function createOrganization(
	options: OrganizationServiceOptions & {
		input: CreateOrganizationInput;
	},
) {
	const sanitized = sanitizeObject(options.input);

	const org = await options.db.transaction(async (tx) => {
		const ownedOrgs = await tx.query.organizationMembers.findMany({
			where: and(
				eq(organizationMembers.userId, options.actorUserId),
				eq(organizationMembers.role, "OWNER"),
				eq(organizationMembers.status, "ACTIVE"),
			),
		});

		if (ownedOrgs.length >= 10) {
			throw new ApiError(
				403,
				"FORBIDDEN",
				"Organization limit reached (max 10)",
			);
		}

		const [created] = await tx
			.insert(organizations)
			.values({ ...sanitized })
			.returning();

		await tx.insert(organizationMembers).values({
			organizationId: created.id,
			userId: options.actorUserId,
			role: "OWNER",
			status: "ACTIVE",
		});

		return created;
	});

	void logAudit({
		userId: options.actorUserId,
		organizationId: org.id,
		...options.auditContext,
		action: AUDIT_ACTIONS.CREATE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
		resourceId: org.id,
		status: AUDIT_STATUS.SUCCESS,
		metadata: { source: options.source },
	});

	return org;
}

export async function updateOrganization(
	options: OrganizationServiceOptions & {
		organizationId: string;
		input: UpdateOrganizationInput;
	},
) {
	await requireActiveMembership(
		options.db,
		options.actorUserId,
		options.organizationId,
		"ADMIN",
	);

	const sanitized = sanitizeObject(options.input);
	if (Object.keys(sanitized).length === 0) {
		throw new ApiError(400, "BAD_REQUEST", "No fields to update");
	}

	const { before, updated } = await options.db.transaction(async (tx) => {
		const [b] = await tx
			.select()
			.from(organizations)
			.where(eq(organizations.id, options.organizationId))
			.limit(1);

		const [u] = await tx
			.update(organizations)
			.set({
				...sanitized,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(organizations.id, options.organizationId))
			.returning();

		return { before: b, updated: u };
	});

	if (!updated) {
		throw new ApiError(404, "NOT_FOUND", "Organization not found");
	}

	void logAudit({
		userId: options.actorUserId,
		organizationId: options.organizationId,
		...options.auditContext,
		action: AUDIT_ACTIONS.UPDATE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
		resourceId: options.organizationId,
		changes: { before, after: updated },
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: options.source,
			updatedFields: Object.keys(options.input),
		},
	});

	return updated;
}

export async function deleteOrganization(
	options: OrganizationServiceOptions & {
		organizationId: string;
	},
): Promise<boolean> {
	await requireActiveMembership(
		options.db,
		options.actorUserId,
		options.organizationId,
		"OWNER",
	);

	const deleted = await options.db.transaction(async (tx) => {
		const [del] = await tx
			.update(organizations)
			.set({
				status: "DELETED",
				updatedAt: new Date().toISOString(),
			})
			.where(eq(organizations.id, options.organizationId))
			.returning({ id: organizations.id });

		if (!del) return false;

		await tx
			.update(organizationMembers)
			.set({
				status: "INACTIVE",
				updatedAt: new Date().toISOString(),
			})
			.where(eq(organizationMembers.organizationId, options.organizationId));

		return true;
	});

	if (!deleted) {
		throw new ApiError(404, "NOT_FOUND", "Organization not found");
	}

	void logAudit({
		userId: options.actorUserId,
		organizationId: options.organizationId,
		...options.auditContext,
		action: AUDIT_ACTIONS.DELETE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
		resourceId: options.organizationId,
		status: AUDIT_STATUS.SUCCESS,
		metadata: { source: options.source },
	});

	return true;
}

export async function inviteMember(
	options: OrganizationServiceOptions & {
		organizationId: string;
		input: InviteMemberInput;
	},
) {
	const callerMembership = await requireActiveMembership(
		options.db,
		options.actorUserId,
		options.organizationId,
		"ADMIN",
	);
	const targetRole = options.input.role ?? "MEMBER";
	assertCanAssignRole(callerMembership.role ?? "MEMBER", targetRole);

	const targetUser = await options.db.query.users.findFirst({
		where: eq(users.id, options.input.userId),
	});
	if (!targetUser) {
		throw new ApiError(404, "NOT_FOUND", "User not found");
	}

	const existing = await options.db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.userId, options.input.userId),
			eq(organizationMembers.organizationId, options.organizationId),
			inArray(organizationMembers.status, ["ACTIVE", "PENDING"]),
		),
	});

	if (existing) {
		throw new ApiError(
			400,
			"BAD_REQUEST",
			existing.status === "PENDING"
				? "User already has a pending invitation to this organization"
				: "User is already a member of this organization",
		);
	}

	const [membership] = await options.db
		.insert(organizationMembers)
		.values({
			organizationId: options.organizationId,
			userId: options.input.userId,
			role: targetRole,
			status: "PENDING",
		})
		.onConflictDoUpdate({
			target: [organizationMembers.userId, organizationMembers.organizationId],
			set: {
				role: targetRole,
				status: "PENDING",
				updatedAt: new Date().toISOString(),
			},
		})
		.returning();

	void logAudit({
		userId: options.actorUserId,
		organizationId: options.organizationId,
		...options.auditContext,
		action: AUDIT_ACTIONS.CREATE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
		resourceId: membership.id,
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: options.source,
			action: "invite_member",
			targetUserId: options.input.userId,
			role: targetRole,
		},
	});

	return membership;
}

export async function updateMemberRole(
	options: OrganizationServiceOptions & {
		organizationId: string;
		input: UpdateMemberRoleInput;
	},
) {
	const callerMembership = await requireActiveMembership(
		options.db,
		options.actorUserId,
		options.organizationId,
		"ADMIN",
	);

	const { updated, target } = await options.db.transaction(async (tx) => {
		const [target] = await tx
			.select()
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.id, options.input.memberId),
					eq(organizationMembers.organizationId, options.organizationId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			)
			.limit(1)
			.for("update");

		if (!target) {
			throw new ApiError(404, "NOT_FOUND", "Membership not found");
		}

		assertCanModifyRole(
			callerMembership.role ?? "MEMBER",
			target.role ?? "MEMBER",
		);
		assertCanAssignRole(callerMembership.role ?? "MEMBER", options.input.role);

		const [updated] = await tx
			.update(organizationMembers)
			.set({
				role: options.input.role,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(organizationMembers.id, options.input.memberId))
			.returning();

		return { updated, target };
	});

	void logAudit({
		userId: options.actorUserId,
		organizationId: options.organizationId,
		...options.auditContext,
		action: AUDIT_ACTIONS.UPDATE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
		resourceId: options.input.memberId,
		changes: {
			before: { role: target.role },
			after: { role: options.input.role },
		},
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: options.source,
			action: "update_member_role",
			targetUserId: target.userId,
		},
	});

	return updated;
}

export async function removeMember(
	options: OrganizationServiceOptions & {
		organizationId: string;
		memberId: string;
	},
): Promise<boolean> {
	const callerMembership = await requireActiveMembership(
		options.db,
		options.actorUserId,
		options.organizationId,
		"ADMIN",
	);

	const target = await options.db.transaction(async (tx) => {
		const [target] = await tx
			.select()
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.id, options.memberId),
					eq(organizationMembers.organizationId, options.organizationId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			)
			.limit(1)
			.for("update");

		if (!target) {
			throw new ApiError(404, "NOT_FOUND", "Membership not found");
		}

		assertCanRemoveRole(
			callerMembership.role ?? "MEMBER",
			target.role ?? "MEMBER",
		);

		if (target.userId === options.actorUserId) {
			throw new ApiError(
				400,
				"BAD_REQUEST",
				"Cannot remove yourself. Use leaveOrganization instead.",
			);
		}

		await tx
			.update(organizationMembers)
			.set({
				status: "INACTIVE",
				updatedAt: new Date().toISOString(),
			})
			.where(eq(organizationMembers.id, options.memberId));

		return target;
	});

	void logAudit({
		userId: options.actorUserId,
		organizationId: options.organizationId,
		...options.auditContext,
		action: AUDIT_ACTIONS.DELETE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
		resourceId: options.memberId,
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: options.source,
			action: "remove_member",
			targetUserId: target.userId,
		},
	});

	return true;
}

export async function leaveOrganization(
	options: OrganizationServiceOptions & {
		organizationId: string;
	},
): Promise<boolean> {
	const membership = await requireActiveMembership(
		options.db,
		options.actorUserId,
		options.organizationId,
	);

	await options.db.transaction(async (tx) => {
		if (membership.role === "OWNER") {
			const owners = await tx
				.select()
				.from(organizationMembers)
				.where(
					and(
						eq(organizationMembers.organizationId, options.organizationId),
						eq(organizationMembers.role, "OWNER"),
						eq(organizationMembers.status, "ACTIVE"),
					),
				)
				.for("update");

			if (owners.length <= 1) {
				throw new ApiError(
					403,
					"FORBIDDEN",
					"Cannot leave: you are the only owner. Transfer ownership first.",
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
		userId: options.actorUserId,
		organizationId: options.organizationId,
		...options.auditContext,
		action: AUDIT_ACTIONS.DELETE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
		resourceId: membership.id,
		status: AUDIT_STATUS.SUCCESS,
		metadata: { source: options.source, action: "leave_organization" },
	});

	return true;
}

export async function acceptInvitation(
	options: OrganizationServiceOptions & {
		organizationId: string;
	},
) {
	const [accepted] = await options.db.transaction(async (tx) => {
		const [invite] = await tx
			.select()
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.userId, options.actorUserId),
					eq(organizationMembers.organizationId, options.organizationId),
					eq(organizationMembers.status, "PENDING"),
				),
			)
			.limit(1)
			.for("update");

		if (!invite) {
			throw new ApiError(404, "NOT_FOUND", "No pending invitation found");
		}

		return tx
			.update(organizationMembers)
			.set({ status: "ACTIVE", updatedAt: new Date().toISOString() })
			.where(eq(organizationMembers.id, invite.id))
			.returning();
	});

	void logAudit({
		userId: options.actorUserId,
		organizationId: options.organizationId,
		...options.auditContext,
		action: AUDIT_ACTIONS.UPDATE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
		resourceId: accepted.id,
		status: AUDIT_STATUS.SUCCESS,
		metadata: { source: options.source, action: "accept_invitation" },
	});

	return accepted;
}

export async function declineInvitation(
	options: OrganizationServiceOptions & {
		organizationId: string;
	},
): Promise<boolean> {
	const result = await options.db
		.update(organizationMembers)
		.set({ status: "INACTIVE", updatedAt: new Date().toISOString() })
		.where(
			and(
				eq(organizationMembers.userId, options.actorUserId),
				eq(organizationMembers.organizationId, options.organizationId),
				eq(organizationMembers.status, "PENDING"),
			),
		)
		.returning();

	if (result.length === 0) {
		throw new ApiError(404, "NOT_FOUND", "No pending invitation found");
	}

	void logAudit({
		userId: options.actorUserId,
		organizationId: options.organizationId,
		...options.auditContext,
		action: AUDIT_ACTIONS.DELETE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION_MEMBER,
		resourceId: result[0].id,
		status: AUDIT_STATUS.SUCCESS,
		metadata: { source: options.source, action: "decline_invitation" },
	});

	return true;
}
