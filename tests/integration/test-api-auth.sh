#!/bin/bash

# Authenticated API Testing Script
# Usage: ./test-api-auth.sh [staging|production] <JWT_TOKEN>

# Don't exit on error - we want to see all test results
set +e

# Load environment helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../scripts/lib/env-helper.sh"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

STAGE=${1:-staging}
TOKEN=${2:-}

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: JWT token required${NC}"
  echo "Usage: ./test-api-auth.sh [staging|production] <JWT_TOKEN>"
  exit 1
fi

# Get API URL from environment
API_URL=$(get_api_url "$STAGE")

echo -e "${YELLOW}🧪 Testing $STAGE API with Authentication${NC}"
echo "API URL: $API_URL"
echo ""

# Test counter
PASSED=0
FAILED=0

# Test function
test_endpoint() {
  local name="$1"
  local method="$2"
  local endpoint="$3"
  local data="$4"
  local expected_status="$5"
  
  echo -e "${BLUE}Testing:${NC} $method $API_URL$endpoint"
  
  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" \
      --max-time 30 \
      --connect-timeout 10 \
      -X GET \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      "$API_URL$endpoint" 2>&1)
  else
    response=$(curl -s -w "\n%{http_code}" \
      --max-time 30 \
      --connect-timeout 10 \
      -X "$method" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "$API_URL$endpoint" 2>&1)
  fi
  
  status_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$status_code" = "$expected_status" ]; then
    echo -e "${GREEN}✓ PASSED${NC} (HTTP $status_code)"
    PASSED=$((PASSED + 1))
    if [ -n "$body" ]; then
      echo "$body" | jq -C '.' 2>/dev/null || echo "$body"
    fi
  else
    echo -e "${RED}✗ FAILED${NC} (Expected $expected_status, got $status_code)"
    FAILED=$((FAILED + 1))
    if [ -n "$body" ]; then
      echo "$body" | jq -C '.' 2>/dev/null || echo "$body"
    fi
  fi
  echo ""
}

echo -e "${YELLOW}=== User Endpoints ===${NC}"
echo ""

# Test 1: Get current user
test_endpoint \
  "GET /v1/users/me" \
  "GET" \
  "/v1/users/me" \
  "" \
  "200"

# Test 2: Update user
test_endpoint \
  "PATCH /v1/users/me" \
  "PATCH" \
  "/v1/users/me" \
  '{"user":{"firstName":"Test","lastName":"User"}}' \
  "200"

echo -e "${YELLOW}=== Media Endpoints ===${NC}"
echo ""

# Test 3: Upload image (presigned URL)
test_endpoint \
  "POST /v1/media/upload-image" \
  "POST" \
  "/v1/media/upload-image" \
  '{"filename":"test.jpg","contentType":"image/jpeg"}' \
  "200"

# Test 4: List images
test_endpoint \
  "GET /v1/media/images" \
  "GET" \
  "/v1/media/images?limit=10" \
  "" \
  "200"

# Test 5: Upload image direct
test_endpoint \
  "POST /v1/media/upload-image-direct" \
  "POST" \
  "/v1/media/upload-image-direct" \
  '{"filename":"test.jpg","contentType":"image/jpeg","imageData":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}' \
  "200"

echo -e "${YELLOW}=== Health Check ===${NC}"
echo ""

# Test 6: Health check (no auth needed)
test_endpoint \
  "GET /v1/health" \
  "GET" \
  "/v1/health" \
  "" \
  "200"

echo -e "${YELLOW}=== Python Handler ===${NC}"
echo ""

# Test 7: Python test handler (no auth needed)
test_endpoint \
  "GET /v1/test/python" \
  "GET" \
  "/v1/test/python" \
  "" \
  "200"

echo ""
echo -e "${YELLOW}=== Test Summary ===${NC}"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 All authenticated tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
