import { z } from 'zod';
import { ApiError, Errors } from './errors';

export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Errors.ValidationError(result.error.format());
  }
  return result.data;
}

// Common schemas
export const schemas = {
  // Pagination
  paginationQuery: z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
  }),

  // User schemas
  createUser: z.object({
    email: z.string().email(),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    organizationId: z.string().uuid().optional(),
  }),

  updateUser: z.object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    organizationId: z.string().uuid().optional(),
  }),

  // Organization schemas
  createOrganization: z.object({
    name: z.string().min(1).max(200),
    branding: z.record(z.any()).optional(),
  }),

  // Org Unit schemas
  createOrgUnit: z.object({
    organizationId: z.string().uuid(),
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(100),
    isRoot: z.boolean().optional(),
    primaryDomain: z.string().min(1).optional(),
    branding: z.record(z.any()).optional(),
  }),

  // ID parameter
  idParam: z.object({
    id: z.string().uuid(),
  }),

  // WorkOS webhook event
  workosWebhookEvent: z.object({
    id: z.string(),
    event: z.string(),
    data: z.record(z.any()),
    created_at: z.string(),
  }),
};
