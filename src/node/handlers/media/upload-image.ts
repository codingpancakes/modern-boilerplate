import { Context } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { withAuth } from '../../lib/middleware';
import { AuthenticatedEvent } from '../../lib/middleware';
import { Errors } from '../../lib/errors';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'media-upload-image' });
const tracer = new Tracer({ serviceName: 'media-upload-image' });

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
  const requestId = context.awsRequestId;
  logger.addContext(context);

  try {
    // Get bucket name and CDN URL from environment variables
    const BUCKET_NAME = process.env.IMAGES_BUCKET;
    const CDN_URL = process.env.IMAGES_CDN_URL;
    
    if (!BUCKET_NAME || !CDN_URL) {
      throw new Error('IMAGES_BUCKET and IMAGES_CDN_URL environment variables must be set');
    }
    
    // 1. CLAIMS USAGE - Always use claims from middleware
    const claims = event.claims; // Claims provided by withAuth middleware
    const userId = claims.sub;
    
    if (!userId) {
      throw Errors.Unauthorized();
    }

    // 2. Parse and validate request body
    const body = JSON.parse(event.body || '{}');
    const { 
      filename, 
      contentType, 
      baseDir = 'users',
      userId: customUserId,
      nameRoute = 'general' 
    } = body;

    // Log the incoming request
    logger.info('Presigned URL request received', {
      hasCustomUserId: !!customUserId,
      customUserId,
      claimsUserId: userId,
      baseDir,
      nameRoute,
      filename
    });

    // Validate required fields
    if (!filename || !contentType) {
      throw Errors.BadRequest('Missing required fields: filename and contentType');
    }

    // Use custom userId if provided, otherwise use claims userId
    const finalUserId = customUserId || userId;

    // Validate filename
    const fileExtension = filename.split('.').pop()?.toLowerCase();
    const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    if (!fileExtension || !validExtensions.includes(fileExtension)) {
      throw Errors.BadRequest(`Invalid file extension. Allowed extensions: ${validExtensions.join(', ')}`);
    }

    // Generate unique image key
    const timestamp = Date.now();
    const uniqueId = uuidv4();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `${baseDir}/${finalUserId}/${nameRoute}/${timestamp}_${uniqueId}_${sanitizedFilename}`;

    logger.info('Generating presigned URL for image upload', {
      userId: finalUserId,
      baseDir,
      nameRoute,
      key,
      contentType,
      requestId
    });

    // Create presigned URL for upload
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
      Metadata: {
        userId: finalUserId,
        baseDir,
        nameRoute,
        originalFilename: filename,
        uploadedAt: new Date().toISOString()
      }
      // Removed ServerSideEncryption to avoid signature mismatch issues
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: UPLOAD_EXPIRY_SECONDS
    });

    logger.info('Presigned URL generated successfully', {
      key,
      expiresIn: 300,
      requestId
    });

    // 3. RESPONSE STRUCTURE - Return standardized response
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: {
          uploadUrl,
          imageUrl: `${CDN_URL}/${key}`,
          key,
          bucket: BUCKET_NAME
        }
      }),
    };
  } catch (error) {
    logger.error('Error generating presigned URL', { error, requestId });
    // 2. ERROR HANDLING - Throw error for middleware to handle
    throw error;
  }
};

// 5. ARCHITECTURE - Export with withAuth wrapper
export const handler = withAuth(handlerFn);
