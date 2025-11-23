import { Context } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { withAuth } from '../../lib/middleware';
import { AuthenticatedEvent } from '../../lib/middleware';
import { Errors } from '../../lib/errors';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'media-upload-direct' });
const tracer = new Tracer({ serviceName: 'media-upload-direct' });

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
 *                 description: Base64 encoded image data
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

    // Parse request body
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { 
      filename, 
      contentType, 
      imageData, 
      baseDir = 'users',
      userId: customUserId,
      nameRoute = 'general' 
    } = body;

    // Log the incoming request
    logger.info('Upload request received', {
      hasCustomUserId: !!customUserId,
      customUserId,
      claimsUserId: userId,
      baseDir,
      nameRoute,
      filename
    });

    // Validate required fields
    if (!filename || !contentType || !imageData) {
      throw Errors.BadRequest('Missing required fields: filename, contentType, and imageData are required');
    }

    // Validate content type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(contentType)) {
      throw Errors.BadRequest(`Invalid content type. Allowed types: ${allowedTypes.join(', ')}`);
    }

    // Use custom userId if provided, otherwise use claims userId
    const finalUserId = customUserId || userId;

    // Decode base64 image data
    let imageBuffer: Buffer;
    try {
      // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } catch (error) {
      throw Errors.BadRequest('Invalid base64 image data');
    }

    // Validate image size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (imageBuffer.length > maxSize) {
      throw Errors.BadRequest(`Image size exceeds maximum allowed size of 10MB`);
    }

    // Generate unique S3 key
    const timestamp = Date.now();
    const uniqueId = uuidv4();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `${baseDir}/${finalUserId}/${nameRoute}/${timestamp}_${uniqueId}_${sanitizedFilename}`;

    logger.info('Uploading image to S3', { 
      claimsUserId: userId,
      customUserId: customUserId,
      finalUserId: finalUserId, 
      baseDir,
      nameRoute,
      key,
      size: imageBuffer.length,
      contentType,
      BUCKET_NAME,
      IMAGES_BUCKET_ENV: process.env.IMAGES_BUCKET
    });

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
      Metadata: {
        userId: finalUserId,
        baseDir,
        nameRoute,
        originalFilename: filename,
        uploadedAt: new Date().toISOString(),
      },
    });

    await s3Client.send(uploadCommand);

    // Generate the image URL using CloudFront CDN
    const imageUrl = `${CDN_URL}/${key}`;

    logger.info('Image uploaded successfully', {
      key,
      imageUrl,
    });

    // 5. RESPONSE STRUCTURE - Return standardized success response
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: {
          imageUrl,
          key,
          bucket: BUCKET_NAME
        }
      }),
    };
  } catch (error: any) {
    // 2. ERROR HANDLING - Proper error handling
    logger.error('Failed to upload image', { error: error.message, stack: error.stack });
    throw error; // Middleware handles formatting
  }
};

// 5. ARCHITECTURE - Consistent pattern with withAuth
export const handler = withAuth(handlerFn);
