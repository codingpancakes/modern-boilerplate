import { type Context, Hono } from "hono";
import type { z } from "zod";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	extractRequestContext,
	logAudit,
} from "../lib/audit";
import { getUserIdFromClaims } from "../lib/auth";
import { Errors } from "../lib/errors";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";
import { createLogger } from "../lib/logger";
import {
	buildImageKey,
	buildImageUrl,
	generatePresignedUploadUrl,
	getMediaConfig,
	listUserImages,
	putImageObject,
	validateContentTypeExtension,
	validateImageMagicBytes,
} from "../lib/media";
import {
	mediaSchemas,
	uploadImageDirectRequest,
	uploadImageRequest,
	validate,
} from "../lib/validation";

/**
 * /v1/media/* — media routes (protected; `requireAuth()` is applied by the
 * barrel in `routes/index.ts`, so `c.get("claims")` is always set).
 *
 * Storage is Cloudflare R2: the direct-upload route prefers the R2 binding
 * (`c.env.IMAGES`) and falls back to the S3-API client (`lib/media.ts`);
 * presigning and listing always go through the S3 API. When R2 is not
 * configured, endpoints fail with a clear 503 config error.
 *
 *   POST /upload-image         — presigned R2 upload URL
 *   POST /upload-image-direct  — base64 upload straight to R2
 *   GET  /images               — list the caller's images
 */
export const media = new Hono<AppEnv>();

// One logger per endpoint so log service names stay identical to the
// per-Lambda loggers the old entry files created.
const uploadImageLogger = createLogger({ serviceName: "media-upload-image" });
const uploadDirectLogger = createLogger({ serviceName: "media-upload-direct" });
const listImagesLogger = createLogger({ serviceName: "media-list-images" });

/**
 * Hono port of `parseBody` (lib/validation/helpers.ts) — same error bodies:
 * missing body and malformed JSON throw `Errors.BadRequest` with the exact
 * legacy messages, and schema failures throw `Errors.ValidationError` via the
 * shared `validate()`.
 */
async function parseJsonBody<T>(
	c: Context<AppEnv>,
	schema: z.ZodSchema<T>,
): Promise<T> {
	const raw = await c.req.text();
	if (!raw) {
		throw Errors.BadRequest("Request body is required");
	}
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		throw Errors.BadRequest("Invalid JSON in request body");
	}
	return validate(schema, body);
}

/** Audit request context from the Hono context. */
function requestAuditContext(c: Context<AppEnv>) {
	return extractRequestContext({
		requestId: c.get("requestId"),
		sourceIp: c.req.header("cf-connecting-ip"),
		userAgent: c.req.header("user-agent"),
	});
}

// POST /v1/media/upload-image — generate a presigned R2 upload URL.
/**
 * @swagger
 * /v1/media/upload-image:
 *   post:
 *     summary: Generate presigned URL for image upload
 *     description: Creates a presigned upload URL for user images
 *     tags:
 *       - Media
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filename
 *               - contentType
 *             properties:
 *               filename:
 *                 type: string
 *                 description: Original filename of the image
 *                 example: "profile-photo.jpg"
 *               contentType:
 *                 type: string
 *                 description: MIME type of the image
 *                 enum: ["image/jpeg", "image/png", "image/gif", "image/webp"]
 *                 example: "image/jpeg"
 *               category:
 *                 type: string
 *                 description: Category of the image (profile, document, etc.)
 *                 example: "profile"
 *     responses:
 *       200:
 *         description: Presigned upload URL generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     uploadUrl:
 *                       type: string
 *                       description: Presigned URL for uploading the image
 *                     imageKey:
 *                       type: string
 *                       description: Storage key where the image will be stored
 *                     expiresIn:
 *                       type: number
 *                       description: URL expiry time in seconds
 *       400:
 *         description: Invalid request parameters
 *         schema: { $ref: '#/definitions/StandardErrorResponse' }
 *       401:
 *         description: Unauthorized
 *         schema: { $ref: '#/definitions/StandardErrorResponse' }
 */
media.post("/upload-image", async (c) => {
	// Get internal user ID from verified claims (lookup + JIT provisioning)
	const userId = await getUserIdFromClaims(c.get("claims"));

	const input = await parseJsonBody(c, uploadImageRequest);

	const fileExtension = input.filename.split(".").pop()?.toLowerCase() || "";
	if (!validateContentTypeExtension(input.contentType, fileExtension)) {
		throw Errors.BadRequest(
			`Content type ${input.contentType} does not match file extension .${fileExtension}`,
		);
	}

	uploadImageLogger.info("Generating presigned URL for image upload", {
		userId,
		contentType: input.contentType,
	});

	const result = await generatePresignedUploadUrl(
		userId,
		input.filename,
		input.contentType,
		input.fileSize,
		input.category,
	);

	uploadImageLogger.info("Presigned URL generated successfully", {
		userId,
		key: result.key,
	});

	return sendSuccess(c, {
		uploadUrl: result.uploadUrl,
		imageUrl: result.imageUrl,
		key: result.key,
	});
});

// POST /v1/media/upload-image-direct — base64 upload straight to R2.
/**
 * @swagger
 * /v1/media/upload-image-direct:
 *   post:
 *     summary: Upload an image directly to storage
 *     tags: [Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filename
 *               - contentType
 *               - imageData
 *             properties:
 *               filename:
 *                 type: string
 *                 description: Original filename
 *                 example: "profile-photo.jpg"
 *               contentType:
 *                 type: string
 *                 description: MIME type of the image
 *                 example: "image/jpeg"
 *               imageData:
 *                 type: string
 *               category:
 *                 type: string
 *                 description: Category for organizing images
 *                 example: "profile"
 *     responses:
 *       200:
 *         description: Image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     key:
 *                       type: string
 *                       description: Storage key of the uploaded image
 *                     url:
 *                       type: string
 *                       description: Public URL of the uploaded image
 *                     size:
 *                       type: number
 *                       description: Size of the uploaded image in bytes
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
media.post("/upload-image-direct", async (c) => {
	// Get internal user ID from verified claims (lookup + JIT provisioning)
	const userId = await getUserIdFromClaims(c.get("claims"));

	const config = getMediaConfig();

	const input = await parseJsonBody(c, uploadImageDirectRequest);

	const fileExtension = input.filename.split(".").pop()?.toLowerCase() || "";
	if (!validateContentTypeExtension(input.contentType, fileExtension)) {
		throw Errors.BadRequest(
			`Content type ${input.contentType} does not match file extension .${fileExtension}`,
		);
	}

	// Decode base64 image data
	let imageBuffer: Buffer;
	try {
		// Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
		const base64Data = input.imageData.replace(/^data:[^;]*;base64,/, "");
		imageBuffer = Buffer.from(base64Data, "base64");
	} catch (_error) {
		throw Errors.BadRequest("Invalid base64 image data");
	}

	// Keep the legacy direct-upload cap (was bounded by Lambda's ~6MB payload
	// limit; base64 adds ~33%, so ~4.5MB decoded). Larger files use presigning.
	const maxSize = 4.5 * 1024 * 1024;
	if (imageBuffer.length > maxSize) {
		throw Errors.BadRequest(
			"Image size exceeds maximum allowed size of 4.5MB for direct upload. Use the presigned URL endpoint (/v1/media/upload-image) for larger files.",
		);
	}

	if (!validateImageMagicBytes(imageBuffer, input.contentType)) {
		throw Errors.BadRequest(
			"File content does not match the declared content type",
		);
	}

	const key = buildImageKey(userId, input.category, input.filename);

	uploadDirectLogger.info("Uploading image to R2", {
		userId,
		key,
		size: imageBuffer.length,
		contentType: input.contentType,
	});

	const uploadedAt = new Date().toISOString();
	const bucket = c.env?.IMAGES;
	if (bucket) {
		// R2 binding (Workers / wrangler dev --local): zero-copy, no signing.
		await bucket.put(key, imageBuffer, {
			httpMetadata: { contentType: input.contentType },
			customMetadata: {
				userId,
				originalFilename: input.filename,
				uploadedAt,
			},
		});
	} else {
		// No binding (local Node server): R2 S3 API via aws4fetch.
		await putImageObject(key, imageBuffer, input.contentType, {
			userid: userId,
			originalfilename: input.filename,
			uploadedat: uploadedAt,
		});
	}

	const imageUrl = buildImageUrl(key, config);

	uploadDirectLogger.info("Image uploaded successfully", {
		userId,
		key,
		imageUrl,
	});

	void logAudit({
		userId,
		action: AUDIT_ACTIONS.CREATE,
		resourceType: AUDIT_RESOURCE_TYPES.MEDIA,
		resourceId: key,
		...requestAuditContext(c),
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: "rest",
			handler: "media/upload-image-direct",
			contentType: input.contentType,
			size: imageBuffer.length,
			category: input.category,
		},
	});

	return sendSuccess(c, {
		imageUrl,
		key,
	});
});

// GET /v1/media/images — list the caller's images (user-scoped key prefix).
/**
 * @swagger
 * /v1/media/images:
 *   get:
 *     summary: List user images
 *     description: Retrieves a list of images uploaded by the authenticated user
 *     tags:
 *       - Media
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *         description: Filter images by category prefix
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Maximum number of images to return
 *       - in: query
 *         name: continuationToken
 *         schema:
 *           type: string
 *         description: Token for pagination
 *     responses:
 *       200:
 *         description: List of user images
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     images:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           key:
 *                             type: string
 *                           url:
 *                             type: string
 *                           size:
 *                             type: number
 *                           lastModified:
 *                             type: string
 *                             format: date-time
 *                           category:
 *                             type: string
 *                     continuationToken:
 *                       type: string
 *                       description: Token for retrieving next page
 *                     hasMore:
 *                       type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
media.get("/images", async (c) => {
	// Get internal user ID from verified claims (lookup + JIT provisioning)
	const userId = await getUserIdFromClaims(c.get("claims"));

	const query = validate(mediaSchemas.listImages, c.req.query());

	listImagesLogger.info("Listing user images", {
		userId,
		category: query.prefix,
		limit: query.limit,
	});

	const result = await listUserImages(
		userId,
		query.prefix,
		query.limit,
		query.continuationToken,
	);

	listImagesLogger.info("Images listed successfully", {
		userId,
		imageCount: result.count,
		hasMore: result.hasMore,
	});

	return sendSuccess(c, result);
});
