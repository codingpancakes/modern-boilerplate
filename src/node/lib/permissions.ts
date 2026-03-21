/**
 * Permission Helpers
 *
 * Centralized functions for checking organization membership and resource access.
 * Used by API handlers to enforce authorization rules.
 */

import { and, eq } from "drizzle-orm";
import { organizationMembers } from "../db/schema/index";
import { getDb } from "./db";
import { Errors } from "./errors";

/**
 * Role hierarchy for permission checks
 */
const ROLE_HIERARCHY = [
	"VIEWER",
	"MEMBER",
	"MANAGER",
	"ADMIN",
	"OWNER",
] as const;
type OrgRole = (typeof ROLE_HIERARCHY)[number];

/**
 * Check if user is member of organization with optional role requirement
 *
 * @param userId - User ID from JWT claims
 * @param orgId - Organization ID from request
 * @param minRole - Minimum required role (optional)
 * @returns Organization membership record
 * @throws Forbidden if not a member or insufficient permissions
 *
 * @example
 * // Check basic membership
 * const membership = await requireOrgMembership(userId, orgId);
 *
 * // Require admin or higher
 * const membership = await requireOrgMembership(userId, orgId, 'admin');
 */
export async function requireOrgMembership(
	userId: string,
	orgId: string,
	minRole?: OrgRole,
) {
	const db = await getDb();

	const [membership] = await db
		.select()
		.from(organizationMembers)
		.where(
			and(
				eq(organizationMembers.userId, userId),
				eq(organizationMembers.organizationId, orgId),
				eq(organizationMembers.status, "ACTIVE"),
			),
		)
		.limit(1);

	if (!membership) {
		throw Errors.Forbidden();
	}

	if (minRole && !hasMinRole(membership.role as OrgRole, minRole)) {
		throw Errors.Forbidden();
	}

	return membership;
}

/**
 * Check if user has minimum required role
 *
 * @param userRole - User's current role
 * @param minRole - Minimum required role
 * @returns true if user has sufficient permissions
 *
 * @example
 * if (hasMinRole('manager', 'member')) {
 *   // Manager has member permissions and higher
 * }
 */
export function hasMinRole(userRole: OrgRole, minRole: OrgRole): boolean {
	const userLevel = ROLE_HIERARCHY.indexOf(userRole);
	const minLevel = ROLE_HIERARCHY.indexOf(minRole);

	if (userLevel === -1 || minLevel === -1) {
		return false;
	}

	return userLevel >= minLevel;
}

/**
 * Check if user is operator (platform admin)
 *
 * @param userType - User type from JWT claims
 * @returns true if user is operator
 *
 * @example
 * if (isOperator(claims.type)) {
 *   // User has platform-wide access
 * }
 */
export function isOperator(userType: string): boolean {
	return userType === "OPERATOR";
}

/**
 * Get all organizations user is member of
 *
 * @param userId - User ID from JWT claims
 * @returns Array of organization memberships
 *
 * @example
 * const orgs = await getUserOrganizations(userId);
 * console.log(`User is member of ${orgs.length} organizations`);
 */
export async function getUserOrganizations(userId: string) {
	const db = await getDb();

	return db
		.select()
		.from(organizationMembers)
		.where(
			and(
				eq(organizationMembers.userId, userId),
				eq(organizationMembers.status, "ACTIVE"),
			),
		);
}
