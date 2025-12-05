/**
 * Media Validation Schemas
 * 
 * Schemas for image and media upload operations.
 */

import { z } from 'zod';

/**
 * Allowed image content types
 */
const imageContentTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

/**
 * Upload image request (presigned URL)
 */
export const uploadImageRequest = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(imageContentTypes),
  category: z.string().max(50).optional(),
});

/**
 * Upload image direct request (base64)
 */
export const uploadImageDirectRequest = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(imageContentTypes),
  imageData: z.string().min(1), // Base64 encoded image
  category: z.string().max(50).optional(),
});

/**
 * List images query parameters
 */
export const listImagesQuery = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  prefix: z.string().optional(),
  continuationToken: z.string().optional(),
});

/**
 * Media schemas object
 */
export const mediaSchemas = {
  uploadImage: uploadImageRequest,
  uploadImageDirect: uploadImageDirectRequest,
  listImages: listImagesQuery,
};
