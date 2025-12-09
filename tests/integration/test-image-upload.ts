#!/usr/bin/env tsx
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
import * as dotenv from 'dotenv';

// Get stage from command line argument or default to staging
const stage = process.argv[2] || 'staging';
const envFile = `.env.${stage}`;

console.log(`🔧 Loading environment from: ${envFile}\n`);
dotenv.config({ path: envFile });

const BUCKET_NAME = process.env.IMAGES_BUCKET;
const CDN_URL = process.env.IMAGES_CDN_URL;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_PROFILE = process.env.AWS_PROFILE || 'outdream';

if (!BUCKET_NAME) {
  console.error('❌ IMAGES_BUCKET not set in environment');
  console.error(`   Make sure ${envFile} exists and has IMAGES_BUCKET set`);
  process.exit(1);
}

// Set AWS profile in environment for SDK to use
process.env.AWS_PROFILE = AWS_PROFILE;

const s3Client = new S3Client({ 
  region: AWS_REGION,
  // Will automatically use AWS_PROFILE from environment
});

async function testImageUpload() {
  console.log('🧪 Testing Image Upload to S3\n');
  console.log(`🎯 Stage: ${stage}`);
  console.log(`📦 Bucket: ${BUCKET_NAME}`);
  console.log(`🌐 CDN: ${CDN_URL}`);
  console.log(`📍 Region: ${AWS_REGION}`);
  console.log(`👤 Profile: ${AWS_PROFILE}\n`);

  // Create a test image (1x1 pixel PNG)
  const testImageBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  const testUserId = 'test-user-' + Date.now();
  const imageId = uuidv4();
  const key = `users/${testUserId}/images/${imageId}.png`;

  console.log(`👤 Test User ID: ${testUserId}`);
  console.log(`🖼️  Image ID: ${imageId}`);
  console.log(`🔑 S3 Key: ${key}\n`);

  try {
    // Step 1: Upload image to S3
    console.log('📤 Step 1: Uploading image to S3...');
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: testImageBuffer,
      ContentType: 'image/png',
      Metadata: {
        userId: testUserId,
        uploadedAt: new Date().toISOString(),
      },
    });

    await s3Client.send(putCommand);
    console.log('✅ Image uploaded successfully!\n');

    // Step 2: Generate presigned URL for download
    console.log('🔗 Step 2: Generating presigned URL...');
    const presignedUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      }),
      { expiresIn: 300 }
    );
    console.log(`✅ Presigned URL: ${presignedUrl.substring(0, 100)}...\n`);

    // Step 3: List objects in user's folder
    console.log('📋 Step 3: Listing objects in user folder...');
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `users/${testUserId}/`,
    });

    const listResult = await s3Client.send(listCommand);
    console.log(`✅ Found ${listResult.Contents?.length || 0} objects:`);
    listResult.Contents?.forEach(obj => {
      console.log(`   - ${obj.Key} (${obj.Size} bytes)`);
    });
    console.log('');

    // Step 4: Construct CDN URL
    if (CDN_URL) {
      const cdnUrl = `${CDN_URL}/${key}`;
      console.log('🌐 CDN URL:');
      console.log(`   ${cdnUrl}\n`);
    }

    console.log('✅ All tests passed!\n');
    console.log('🧹 Cleanup: To delete test image, run:');
    console.log(`   aws s3 rm s3://${BUCKET_NAME}/${key} --profile ${AWS_PROFILE} --region ${AWS_REGION}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testImageUpload();
