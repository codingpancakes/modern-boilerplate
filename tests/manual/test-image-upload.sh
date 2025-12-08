#!/bin/bash

# Test image upload endpoints
# Usage: ./test-image-upload.sh staging|production <JWT_TOKEN>

set -e

# Load environment helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../scripts/lib/env-helper.sh"

STAGE=${1:-staging}
JWT_TOKEN=${2:-}

if [ -z "$JWT_TOKEN" ]; then
  echo "❌ Error: JWT token required"
  echo "Usage: ./test-image-upload.sh staging|production <JWT_TOKEN>"
  exit 1
fi

# Get API URL from environment
API_URL=$(get_api_url "$STAGE")

echo "🧪 Testing Image Upload on $STAGE"
echo "API: $API_URL"
echo ""

# Test 1: Generate presigned URL
echo "📝 Test 1: Generate presigned URL for upload"
RESPONSE=$(curl -s -X POST "$API_URL/v1/media/upload-image" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test-image.jpg",
    "contentType": "image/jpeg"
  }')

echo "Response: $RESPONSE"

# Check if response contains uploadUrl
if echo "$RESPONSE" | grep -q "uploadUrl"; then
  echo "✅ Test 1 PASSED: Presigned URL generated"
  
  # Extract uploadUrl
  UPLOAD_URL=$(echo "$RESPONSE" | jq -r '.data.uploadUrl')
  IMAGE_KEY=$(echo "$RESPONSE" | jq -r '.data.key')
  
  echo "Upload URL: $UPLOAD_URL"
  echo "Image Key: $IMAGE_KEY"
  echo ""
  
  # Test 2: Upload a test image
  echo "📝 Test 2: Upload test image to presigned URL"
  
  # Create a tiny test image (1x1 pixel JPEG)
  TEST_IMAGE="/tmp/test-image-$$.jpg"
  # Base64 encoded 1x1 red pixel JPEG
  echo "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==" | base64 -d > "$TEST_IMAGE"
  
  UPLOAD_RESPONSE=$(curl -s -X PUT "$UPLOAD_URL" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@$TEST_IMAGE" \
    -w "\nHTTP_CODE:%{http_code}")
  
  HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
  
  if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Test 2 PASSED: Image uploaded successfully"
  else
    echo "❌ Test 2 FAILED: Upload failed with HTTP $HTTP_CODE"
  fi
  
  # Cleanup
  rm -f "$TEST_IMAGE"
  
else
  echo "❌ Test 1 FAILED: No uploadUrl in response"
  exit 1
fi

echo ""

# Test 3: Direct upload endpoint
echo "📝 Test 3: Direct upload endpoint"
DIRECT_RESPONSE=$(curl -s -X POST "$API_URL/v1/media/upload-image-direct" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test-direct.jpg",
    "contentType": "image/jpeg",
    "imageData": "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q=="
  }')

echo "Response: $DIRECT_RESPONSE"

if echo "$DIRECT_RESPONSE" | grep -q "imageUrl"; then
  echo "✅ Test 3 PASSED: Direct upload successful"
  IMAGE_URL=$(echo "$DIRECT_RESPONSE" | jq -r '.data.imageUrl')
  echo "Image URL: $IMAGE_URL"
else
  echo "❌ Test 3 FAILED: No imageUrl in response"
fi

echo ""
echo "🎉 Image upload tests completed for $STAGE"
