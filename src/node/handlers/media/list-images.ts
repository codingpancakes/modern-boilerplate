import { Context } from 'aws-lambda';
import { S3Client, ListObjectsV2Command, _Object } from '@aws-sdk/client-s3';
import { Logger } from '@aws-lambda-powertools/logger';
import { withAuth, AuthenticatedEvent } from '../../lib/middleware';
import { parseQuery, mediaSchemas } from '../../lib/validation';
import { createSuccessResponse } from '../../lib/response';
import { Errors } from '../../lib/errors';

const logger = new Logger({ serviceName: 'media-list-images' });

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
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter images by category
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 1000
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
 *         description: Unauthorized
 *         schema: { $ref: '#/definitions/StandardErrorResponse' }
 */
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const claims = event.claims;
  const userId = claims.sub;

  // Add persistent context to all logs
  logger.appendKeys({ userId });

  if (!userId) {
    throw Errors.Unauthorized();
  }

  // Validate environment variables
  const BUCKET_NAME = process.env.IMAGES_BUCKET;
  if (!BUCKET_NAME) {
    throw new Error('IMAGES_BUCKET environment variable must be set');
  }

  // Parse and validate query parameters
  const query = parseQuery(event, mediaSchemas.listImages);
  const category = query.prefix; // Using prefix instead of category for flexibility
  const limit = query.limit;
  const continuationToken = query.continuationToken;

  // Build S3 prefix based on parameters
  let prefix = `users/${userId}/`;
  if (category) {
    prefix += `${category}/`;
  }

  logger.info('Listing user images', { category, limit, prefix });

  // List objects from S3
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix,
    MaxKeys: limit,
    ContinuationToken: continuationToken
  });

  const response = await s3Client.send(command);
  
  // Format the response
  const images = (response.Contents || []).map((obj: _Object) => {
    const key = obj.Key || '';
    const parts = key.split('/');
    const categoryFromPath = parts.length > 3 ? parts[3] : 'general';
    
    return {
      key,
      url: `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`,
      size: obj.Size,
      lastModified: obj.LastModified?.toISOString(),
      category: categoryFromPath,
      filename: parts[parts.length - 1]
    };
  });

  logger.info('Images listed successfully', {
    imageCount: images.length,
    hasMore: response.IsTruncated
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
