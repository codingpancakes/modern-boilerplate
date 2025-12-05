/**
 * Permission Helpers
 * 
 * Centralized functions for checking organization membership and resource access.
 * Used by API handlers to enforce authorization rules.
 */

import { eq, and, or, isNull } from 'drizzle-orm';
import { getDb } from './db';
import { organizationMembers, resourceOwners } from '../db/schema';
import { Errors } from './errors';

/**
 * Role hierarchy for permission checks
 */
const ROLE_HIERARCHY = ['viewer', 'member', 'manager', 'admin', 'owner'] as const;
type OrgRole = typeof ROLE_HIERARCHY[number];

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
  minRole?: OrgRole
) {
  const db = await getDb();
  
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.organizationId, orgId),
      eq(organizationMembers.status, 'active')
    ))
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
 * Check if user can access a resource via resource_owners table
 * 
 * @param resourceType - Type of resource (e.g., 'contact_list', 'campaign')
 * @param resourceId - Resource UUID
 * @param userId - User ID from JWT claims
 * @param orgId - Organization ID from request
 * @returns Resource ownership record
 * @throws NotFound if resource doesn't exist or user has no access
 * 
 * @example
 * const ownership = await requireResourceAccess(
 *   'contact_list',
 *   listId,
 *   userId,
 *   orgId
 * );
 */
export async function requireResourceAccess(
  resourceType: string,
  resourceId: string,
  userId: string,
  orgId: string
) {
  const db = await getDb();
  
  const [ownership] = await db
    .select()
    .from(resourceOwners)
    .where(and(
      eq(resourceOwners.resourceType, resourceType),
      eq(resourceOwners.resourceId, resourceId),
      or(
        // User owns it directly
        and(
          eq(resourceOwners.ownerType, 'user'),
          eq(resourceOwners.ownerId, userId)
        ),
        // Organization owns it (and user is member)
        and(
          eq(resourceOwners.ownerType, 'organization'),
          eq(resourceOwners.ownerId, orgId)
        )
      )
    ))
    .limit(1);
  
  if (!ownership) {
    // Don't reveal if resource exists - just say not found
    throw Errors.NotFound('Resource');
  }
  
  return ownership;
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
  return userType === 'operator';
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
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, 'active')
    ));
}
