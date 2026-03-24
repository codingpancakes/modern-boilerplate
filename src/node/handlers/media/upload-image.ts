import { Logger } from "@aws-lambda-powertools/logger";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Context } from "aws-lambda";
import { getUserIdFromClaims } from "../../lib/auth";
import { Errors } from "../../lib/errors";
import {
	buildImageKey,
	buildImageUrl,
	getMediaConfig,
	getS3Client,
	validateContentTypeExtension,
} from "../../lib/media";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { parseBody } from "../../lib/validation/helpers";
import { uploadImageRequest } from "../../lib/validation/media";

const logger = new Logger({ serviceName: "media-upload-image" });

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

	const config = getMediaConfig();

	const input = parseBody(event, uploadImageRequest);

	const fileExtension = input.filename.split(".").pop()?.toLowerCase() || "";
	if (!validateContentTypeExtension(input.contentType, fileExtension)) {
		throw Errors.BadRequest(
			`Content type ${input.contentType} does not match file extension .${fileExtension}`,
		);
	}

	const key = buildImageKey(userId, input.category, input.filename);

	logger.info("Generating presigned URL for image upload", {
		userId,
		key,
		contentType: input.contentType,
	});

	const command = new PutObjectCommand({
		Bucket: config.bucketName,
		Key: key,
		ContentType: input.contentType,
		ServerSideEncryption: "AES256",
		Metadata: {
			userId,
			originalFilename: input.filename,
			uploadedAt: new Date().toISOString(),
		},
	});

	const uploadUrl = await getSignedUrl(getS3Client(), command, {
		expiresIn: UPLOAD_EXPIRY_SECONDS,
	});

	logger.info("Presigned URL generated successfully", { key });

	return createSuccessResponse({
		uploadUrl,
		imageUrl: buildImageUrl(key, config),
		key,
	});
};

export const handler = withAuth(handlerFn);
