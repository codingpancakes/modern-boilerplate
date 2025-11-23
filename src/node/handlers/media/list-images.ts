import { Context } from 'aws-lambda';
import { S3Client, ListObjectsV2Command, _Object } from '@aws-sdk/client-s3';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { withAuth } from '../../lib/middleware';
import { AuthenticatedEvent } from '../../lib/middleware';
import { Errors } from '../../lib/errors';

const logger = new Logger({ serviceName: 'media-list-images' });
const tracer = new Tracer({ serviceName: 'media-list-images' });

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
  const requestId = context.awsRequestId;
  logger.addContext(context);

  // Validate environment variables
  const BUCKET_NAME = process.env.IMAGES_BUCKET;
  if (!BUCKET_NAME) {
    throw new Error('IMAGES_BUCKET environment variable must be set');
  }

  try {
    // 1. CLAIMS USAGE - Always use claims from middleware
    const claims = event.claims; // Claims provided by withAuth middleware
    const userId = claims.sub;
    
    if (!userId) {
      throw Errors.Unauthorized();
    }

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const category = queryParams.category;
    const limit = Math.min(parseInt(queryParams.limit || '100'), 1000);
    const continuationToken = queryParams.continuationToken;

    // Build S3 prefix based on parameters
    let prefix = `users/${userId}/`;
    if (category) {
      prefix += `${category}/`;
    }

    logger.info('Listing user images', {
      userId,
      category,
      limit,
      prefix,
      requestId
    });

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
      userId,
      imageCount: images.length,
      hasMore: response.IsTruncated,
      requestId
    });

    // 3. RESPONSE STRUCTURE - Return standardized response
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: {
          images: images,
          count: images.length
        }
      }),
    };
  } catch (error) {
    logger.error('Error listing images', { error, requestId });
    // 2. ERROR HANDLING - Throw error for middleware to handle
    throw error;
  }
};

// 5. ARCHITECTURE - Export with withAuth wrapper
export const handler = withAuth(handlerFn);
