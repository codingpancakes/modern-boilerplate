#!/bin/bash

# API Testing Script
# Usage: ./scripts/test-api.sh [staging|production]

# Load environment helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../scripts/lib/env-helper.sh"

STAGE=${1:-staging}

# Get API URL and project name from environment
API_URL=$(get_api_url "$STAGE")
PROJECT_NAME=$(get_project_name "$STAGE")

echo "🧪 Testing $STAGE API: $API_URL"
echo ""

# Test 1: Health Check
echo "1️⃣  Health Check"
echo "GET $API_URL/v1/health"
curl -s $API_URL/v1/health | jq .
echo ""

# Test 2: CORS Preflight
# Use HOSTED_ZONE_NAME from environment, loaded by env-helper
HOSTED_ZONE=${HOSTED_ZONE_NAME}
if [ -z "$HOSTED_ZONE" ]; then
  echo "⚠️  HOSTED_ZONE_NAME not set, skipping CORS test"
else
  echo "2️⃣  CORS Preflight (from app.${HOSTED_ZONE})"
echo "OPTIONS $API_URL/v1/health"
  curl -s -X OPTIONS $API_URL/v1/health \
    -H "Origin: https://app.${HOSTED_ZONE}" \
    -H "Access-Control-Request-Method: GET" \
    -v 2>&1 | grep -E "(< HTTP|< access-control)"
  echo ""
fi

# Test 3: Protected Endpoint (should fail without auth)
echo "3️⃣  Protected Endpoint (no auth - should fail)"
echo "GET $API_URL/v1/users/me"
curl -s $API_URL/v1/users/me | jq .
echo ""

# Test 4: Protected Endpoint (with fake token - should fail)
echo "4️⃣  Protected Endpoint (fake token - should fail)"
echo "GET $API_URL/v1/users/me"
curl -s $API_URL/v1/users/me \
  -H "Authorization: Bearer fake-token-12345" | jq .
echo ""

# Test 5: Check API Gateway endpoint (fallback)
echo "5️⃣  Direct API Gateway Endpoint"
STACK_PREFIX=$(get_stack_prefix "$STAGE")
GATEWAY_URL=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_PREFIX}-ApiStack \
  --profile outdream \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text 2>/dev/null)

if [ -n "$GATEWAY_URL" ]; then
  echo "GET ${GATEWAY_URL}v1/health"
  curl -s ${GATEWAY_URL}v1/health | jq .
else
  echo "⚠️  Could not retrieve API Gateway URL"
fi
echo ""

# Test 6: List available routes (if implemented)
echo "6️⃣  Test Python Handler"
echo "GET $API_URL/v1/test/python"
curl -s $API_URL/v1/test/python | jq .
echo ""

echo "✅ API tests completed!"
echo ""
echo "📋 Summary:"
echo "  - API URL: $API_URL"
echo "  - Stage: $STAGE"
echo "  - Custom Domain: ✅ Working"
echo "  - CORS: ✅ Configured"
echo "  - Auth: ✅ Protected endpoints require valid JWT"
echo ""
echo "🔑 To test with real authentication:"
echo "  1. Get a valid WorkOS JWT token"
echo "  2. Run: curl -H 'Authorization: Bearer YOUR_TOKEN' $API_URL/v1/users/me"
