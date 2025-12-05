/**
 * Organization Validation Schemas
 * 
 * Schemas for organization and org unit operations.
 */

import { z } from 'zod';

/**
 * Create organization schema
 */
export const createOrganization = z.object({
  name: z.string().min(1).max(200),
  branding: z.record(z.unknown()).optional(),
});

/**
 * Create org unit schema
 */
export const createOrgUnit = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  isRoot: z.boolean().optional(),
  primaryDomain: z.string().min(1).optional(),
  branding: z.record(z.unknown()).optional(),
});

/**
 * Organization schemas object
 */
export const organizationSchemas = {
  create: createOrganization,
  createOrgUnit: createOrgUnit,
};
