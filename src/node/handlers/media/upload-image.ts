import { randomUUID } from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Context } from "aws-lambda";
import { getUserIdFromClaims } from "../../lib/auth";
import { Errors } from "../../lib/errors";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { ALLOWED_FILE_EXTENSIONS, sanitizeFilename } from "../../lib/sanitize";
import { parseBody } from "../../lib/validation/helpers";
import { uploadImageRequest } from "../../lib/validation/media";

const logger = new Logger({ serviceName: "media-upload-image" });

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const UPLOAD_EXPIRY_SECONDS = 300; // 5 minutes

/**
 * @swagger
 * /v1/media/upload-image:
 *   post:
 *     summary: Generate presigned URL for image upload
 *     description: Creates a presigned S3 URL for uploading user images
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
 *                       description: S3 key where the image will be stored
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
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
	logger.addContext(context);

	// Get internal user ID from JWT claims
	const userId = await getUserIdFromClaims(event);

	// Add persistent context to all logs
	logger.appendKeys({ userId });

	// Get bucket name and CDN URL from environment variables
	const BUCKET_NAME = process.env.IMAGES_BUCKET;
	const CDN_URL = process.env.IMAGES_CDN_URL;

	if (!BUCKET_NAME || !CDN_URL) {
		logger.error("Missing required environment variables", {
			bucket: !!BUCKET_NAME,
			cdn: !!CDN_URL,
		});
		throw Errors.InternalServerError();
	}

	// Validate request body with Zod
	const input = parseBody(event, uploadImageRequest);

	// Validate file extension
	const fileExtension = input.filename.split(".").pop()?.toLowerCase() || "";
	if (!ALLOWED_FILE_EXTENSIONS.IMAGE.includes(fileExtension as any)) {
		throw Errors.BadRequest(
			`File type .${fileExtension} is not allowed. Allowed types: ${ALLOWED_FILE_EXTENSIONS.IMAGE.join(", ")}`,
		);
	}

	// Validate content type matches extension
	const contentTypeMap: Record<string, string[]> = {
		"image/jpeg": ["jpg", "jpeg"],
		"image/png": ["png"],
		"image/gif": ["gif"],
		"image/webp": ["webp"],
	};
	const allowedExtensions = contentTypeMap[input.contentType] || [];
	if (!allowedExtensions.includes(fileExtension)) {
		throw Errors.BadRequest(
			`Content type ${input.contentType} does not match file extension .${fileExtension}`,
		);
	}

	const baseDir = "users";
	const finalUserId = userId;
	const nameRoute = input.category || "general";

	// Sanitize filename
	const safeName = sanitizeFilename(input.filename, {
		maxLength: 100,
		allowedExtensions: ALLOWED_FILE_EXTENSIONS.IMAGE as unknown as string[],
	});

	// Generate unique image key
	const timestamp = Date.now();
	const uniqueId = randomUUID();
	const key = `${baseDir}/${finalUserId}/${nameRoute}/${timestamp}_${uniqueId}_${safeName}`;

	logger.info("Generating presigned URL for image upload", {
		finalUserId,
		baseDir,
		nameRoute,
		key,
		contentType: input.contentType,
	});

	// Create presigned URL for upload
	const command = new PutObjectCommand({
		Bucket: BUCKET_NAME,
		Key: key,
		ContentType: input.contentType,
		ServerSideEncryption: "AES256",
		Metadata: {
			userId: finalUserId,
			baseDir,
			nameRoute,
			originalFilename: input.filename,
			uploadedAt: new Date().toISOString(),
		},
	});

	const uploadUrl = await getSignedUrl(s3Client, command, {
		expiresIn: UPLOAD_EXPIRY_SECONDS,
	});

	logger.info("Presigned URL generated successfully", { key });

	return createSuccessResponse({
		uploadUrl,
		imageUrl: `${CDN_URL}/${key}`,
		key,
	});
};

// 5. ARCHITECTURE - Export with withAuth wrapper
export const handler = withAuth(handlerFn);
