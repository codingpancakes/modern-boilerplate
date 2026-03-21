import { randomUUID } from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Context } from "aws-lambda";
import { getUserIdFromClaims } from "../../lib/auth";
import { Errors } from "../../lib/errors";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { parseBody } from "../../lib/validation/helpers";
import { uploadImageDirectRequest } from "../../lib/validation/media";

const logger = new Logger({ serviceName: "media-upload-direct" });

const s3Client = new S3Client({ region: process.env.AWS_REGION });

/**
 * @swagger
 * /v1/media/upload-image-direct:
 *   post:
 *     summary: Upload an image directly to S3
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
 *                       description: S3 key of the uploaded image
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
	const input = parseBody(event, uploadImageDirectRequest);

	const baseDir = "users";
	const finalUserId = userId;
	const nameRoute = input.category || "general";

	// Decode base64 image data
	let imageBuffer: Buffer;
	try {
		// Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
		const base64Data = input.imageData.replace(/^data:[^;]*;base64,/, "");
		imageBuffer = Buffer.from(base64Data, "base64");
	} catch (_error) {
		throw Errors.BadRequest("Invalid base64 image data");
	}

	// Lambda synchronous payload limit is ~6MB. Base64 encoding adds ~33% overhead,
	// so the effective max decoded image size is ~4.5MB.
	const maxSize = 4.5 * 1024 * 1024;
	if (imageBuffer.length > maxSize) {
		throw Errors.BadRequest(
			"Image size exceeds maximum allowed size of 4.5MB for direct upload. Use the presigned URL endpoint (/v1/media/upload-image) for larger files.",
		);
	}

	// Generate unique S3 key
	const timestamp = Date.now();
	const uniqueId = randomUUID();
	const sanitizedFilename = input.filename.replace(/[^a-zA-Z0-9.-]/g, "_");
	const key = `${baseDir}/${finalUserId}/${nameRoute}/${timestamp}_${uniqueId}_${sanitizedFilename}`;

	logger.info("Uploading image to S3", {
		finalUserId,
		baseDir,
		nameRoute,
		key,
		size: imageBuffer.length,
		contentType: input.contentType,
	});

	// Upload to S3
	const uploadCommand = new PutObjectCommand({
		Bucket: BUCKET_NAME,
		Key: key,
		Body: imageBuffer,
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

	await s3Client.send(uploadCommand);

	// Generate the image URL using CloudFront CDN
	const imageUrl = `${CDN_URL}/${key}`;

	logger.info("Image uploaded successfully", { key, imageUrl });

	return createSuccessResponse({
		imageUrl,
		key,
		bucket: BUCKET_NAME,
	});
};

// 5. ARCHITECTURE - Consistent pattern with withAuth
export const handler = withAuth(handlerFn);
