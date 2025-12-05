/**
 * Common Validation Schemas
 * 
 * Shared schemas used across multiple domains.
 */

import { z } from 'zod';

/**
 * Pagination query parameters
 */
export const paginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});

/**
 * UUID path parameter
 */
export const idParam = z.object({
  id: z.string().uuid(),
});

/**
 * Common schemas object
 */
export const commonSchemas = {
  pagination: paginationQuery,
  idParam,
};
