const AWS = require('aws-sdk');
const sharp = require('sharp');

const s3 = new AWS.S3();

/**
 * Lambda function for processing images with dynamic resizing
 * Triggered by S3 events or API Gateway requests
 * 
 * Query parameters:
 * - w: width in pixels (max 4000)
 * - h: height in pixels (max 4000)
 * - q: quality (1-100, default 85)
 * - f: format (auto, webp, jpeg, png, avif)
 * - fit: resize fit (cover, contain, fill, inside, outside)
 * 
 * Examples:
 * - ?w=300&h=300&fit=cover - Square thumbnail
 * - ?w=1920&q=90 - High quality desktop size
 * - ?w=800&f=webp - Convert to WebP at 800px width
 * - ?h=600&fit=inside - Max height 600px maintaining aspect ratio
 */

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Parse request from API Gateway or CloudFront
    const request = event.Records ? event.Records[0].cf.request : event;
    const queryParams = parseQueryParams(request.queryStringParameters || {});
    
    // Extract bucket and key from request
    const bucket = process.env.SOURCE_BUCKET;
    const key = request.uri ? request.uri.substring(1) : request.pathParameters.key;
    
    if (!key) {
      return errorResponse(400, 'Missing image key');
    }
    
    // Get original image from S3
    const originalImage = await s3.getObject({
      Bucket: bucket,
      Key: key,
    }).promise();
    
    // Process image with Sharp
    let pipeline = sharp(originalImage.Body);
    
    // Get image metadata
    const metadata = await pipeline.metadata();
    
    // Apply resizing
    const resizeOptions = {};
    
    if (queryParams.width || queryParams.height) {
      resizeOptions.width = queryParams.width;
      resizeOptions.height = queryParams.height;
      resizeOptions.fit = queryParams.fit || 'inside';
      resizeOptions.withoutEnlargement = true;
      
      pipeline = pipeline.resize(resizeOptions);
    }
    
    // Apply format conversion
    let outputFormat = queryParams.format;
    if (outputFormat === 'auto') {
      // Auto-detect best format based on Accept header
      const acceptHeader = request.headers?.accept?.[0]?.value || '';
      if (acceptHeader.includes('image/avif')) {
        outputFormat = 'avif';
      } else if (acceptHeader.includes('image/webp')) {
        outputFormat = 'webp';
      } else {
        outputFormat = metadata.format;
      }
    }
    
    // Configure output format
    switch (outputFormat) {
      case 'webp':
        pipeline = pipeline.webp({ quality: queryParams.quality });
        break;
      case 'avif':
        pipeline = pipeline.avif({ quality: queryParams.quality });
        break;
      case 'jpeg':
      case 'jpg':
        pipeline = pipeline.jpeg({ quality: queryParams.quality, progressive: true });
        break;
      case 'png':
        pipeline = pipeline.png({ compressionLevel: 9 });
        break;
      default:
        // Keep original format
        if (metadata.format === 'jpeg') {
          pipeline = pipeline.jpeg({ quality: queryParams.quality, progressive: true });
        }
    }
    
    // Process the image
    const processedImage = await pipeline.toBuffer();
    
    // Return processed image
    return {
      statusCode: 200,
      headers: {
        'Content-Type': getContentType(outputFormat || metadata.format),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Original-Size': originalImage.ContentLength.toString(),
        'X-Processed-Size': processedImage.length.toString(),
        'X-Image-Format': outputFormat || metadata.format,
      },
      body: processedImage.toString('base64'),
      isBase64Encoded: true,
    };
    
  } catch (error) {
    console.error('Error processing image:', error);
    
    if (error.code === 'NoSuchKey') {
      return errorResponse(404, 'Image not found');
    }
    
    return errorResponse(500, 'Error processing image');
  }
};

function parseQueryParams(params) {
  return {
    width: params.w ? Math.min(parseInt(params.w), 4000) : undefined,
    height: params.h ? Math.min(parseInt(params.h), 4000) : undefined,
    quality: params.q ? Math.max(1, Math.min(100, parseInt(params.q))) : 85,
    format: params.f || 'auto',
    fit: params.fit || 'inside',
  };
}

function getContentType(format) {
  const types = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };
  return types[format] || 'application/octet-stream';
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify({
      success: false,
      error: message,
    }),
  };
}
