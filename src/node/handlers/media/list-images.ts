import { Logger } from "@aws-lambda-powertools/logger";
import {
	type _Object,
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3";
import type { Context } from "aws-lambda";
import { getUserIdFromClaims } from "../../lib/auth";
import { Errors } from "../../lib/errors";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { mediaSchemas, parseQuery } from "../../lib/validation";

const logger = new Logger({ serviceName: "media-list-images" });

const s3Client = new S3Client({ region: process.env.AWS_REGION });

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
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
	logger.addContext(context);

	// Get internal user ID from JWT claims
	const userId = await getUserIdFromClaims(event);

	// Add persistent context to all logs
	logger.appendKeys({ userId });

	// Validate environment variables
	const BUCKET_NAME = process.env.IMAGES_BUCKET;
	const CDN_URL = process.env.IMAGES_CDN_URL;
	if (!BUCKET_NAME) {
		logger.error("Missing required environment variable: IMAGES_BUCKET");
		throw Errors.InternalServerError();
	}

	// Parse and validate query parameters
	const query = parseQuery(event, mediaSchemas.listImages);
	const category = query.prefix;
	const limit = query.limit;
	const continuationToken = query.continuationToken;

	// Build S3 prefix based on parameters
	let prefix = `users/${userId}/`;
	if (category) {
		prefix += `${category}/`;
	}

	logger.info("Listing user images", { category, limit, prefix });

	// List objects from S3
	const command = new ListObjectsV2Command({
		Bucket: BUCKET_NAME,
		Prefix: prefix,
		MaxKeys: limit,
		ContinuationToken: continuationToken,
	});

	const response = await s3Client.send(command);

	// Format the response
	const images = (response.Contents || []).map((obj: _Object) => {
		const key = obj.Key || "";
		const parts = key.split("/");
		// S3 key format: users/{userId}/{category}/{timestamp}_{uuid}_{filename}
		const categoryFromPath = parts.length > 2 ? parts[2] : "general";

		return {
			key,
			url: CDN_URL
				? `${CDN_URL}/${key}`
				: `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`,
			size: obj.Size,
			lastModified: obj.LastModified?.toISOString(),
			category: categoryFromPath,
			filename: parts[parts.length - 1],
		};
	});

	logger.info("Images listed successfully", {
		imageCount: images.length,
		hasMore: response.IsTruncated,
	});

	return createSuccessResponse({
		images,
		count: images.length,
		continuationToken: response.NextContinuationToken,
		hasMore: response.IsTruncated || false,
	});
};

// 5. ARCHITECTURE - Export with withAuth wrapper
export const handler = withAuth(handlerFn);
