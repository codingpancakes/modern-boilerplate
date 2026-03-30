/**
 * Media Validation Schemas
 *
 * Schemas for image and media upload operations.
 */

import { z } from "zod";
import { FILE_SIZE_LIMITS } from "../sanitize";

const CATEGORY_MAX_LENGTH = 50;
const CATEGORY_REGEX = /^[a-zA-Z0-9_-]+$/;
const CATEGORY_REGEX_MSG =
	"Category may only contain letters, numbers, hyphens, and underscores";

export const categoryField = z
	.string()
	.max(CATEGORY_MAX_LENGTH)
	.regex(CATEGORY_REGEX, CATEGORY_REGEX_MSG);

/**
 * Validate a category string (for use in non-Zod contexts like GraphQL resolvers).
 * Throws a descriptive error if invalid.
 */
export function validateCategory(category: string): void {
	if (category.length > CATEGORY_MAX_LENGTH) {
		throw new Error("Category must be 50 characters or less");
	}
	if (!CATEGORY_REGEX.test(category)) {
		throw new Error(CATEGORY_REGEX_MSG);
	}
}

/**
 * Allowed image content types
 */
const imageContentTypes = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
] as const;

/**
 * Upload image request (presigned URL)
 */
export const uploadImageRequest = z.object({
	filename: z.string().min(1).max(255),
	contentType: z.enum(imageContentTypes),
	category: categoryField.optional(),
	fileSize: z.number().min(1).max(FILE_SIZE_LIMITS.IMAGE),
});

/**
 * Upload image direct request (base64)
 */
export const uploadImageDirectRequest = z.object({
	filename: z.string().min(1).max(255),
	contentType: z.enum(imageContentTypes),
	imageData: z
		.string()
		.min(1)
		.max(Math.ceil(FILE_SIZE_LIMITS.IMAGE * 1.37) + 100) // base64 overhead (~37%) + data URI prefix
		.regex(
			/^(?:data:[^;]*;base64,)?[A-Za-z0-9+/\n\r]+=*$/,
			"Invalid base64 format",
		),
	category: categoryField.optional(),
});

/**
 * List images query parameters
 */
export const listImagesQuery = z.object({
	limit: z.coerce.number().min(1).max(100).default(20),
	prefix: z
		.string()
		.max(100)
		.regex(/^[a-zA-Z0-9._\-/]*$/, "Invalid prefix characters")
		.refine((v) => !v.includes(".."), "Path traversal not allowed")
		.optional(),
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
