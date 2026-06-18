#!/bin/bash

# Test script for all API handlers
# Usage: ./test-handlers.sh [local|staging|production] <JWT_TOKEN>
# Examples:
#   ./test-handlers.sh "TOKEN"                    # Local (default)
#   ./test-handlers.sh staging "TOKEN"            # Staging
#   ./test-handlers.sh production "TOKEN"         # Production

# Don't exit on error - we want to see all test results
set +e

# Load environment helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../scripts/lib/env-helper.sh"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
if [ $# -eq 1 ]; then
  # Single argument: assume it's the token, use local
  STAGE="local"
  TOKEN="$1"
elif [ $# -eq 2 ]; then
  # Two arguments: stage and token
  STAGE="$1"
  TOKEN="$2"
else
  echo -e "${RED}Error: Invalid arguments${NC}"
  echo "Usage: ./test-handlers.sh [local|staging|production] <JWT_TOKEN>"
  echo ""
  echo "Examples:"
  echo "  ./test-handlers.sh \"TOKEN\"                    # Local (default)"
  echo "  ./test-handlers.sh staging \"TOKEN\"            # Staging"
  echo "  ./test-handlers.sh production \"TOKEN\"         # Production"
  exit 1
fi

# Set API URL based on stage
case "$STAGE" in
  local)
    API_URL="http://localhost:8787"
    ;;
  staging|production)
    API_URL=$(get_api_url "$STAGE")
    ;;
  *)
    echo -e "${RED}Error: Invalid stage '$STAGE'${NC}"
    echo "Valid stages: local, staging, production"
    exit 1
    ;;
esac

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: JWT token required${NC}"
  echo "Usage: ./test-handlers.sh [local|staging|production] <JWT_TOKEN>"
  exit 1
fi

echo -e "${YELLOW}🧪 Testing API Handlers${NC}"
echo -e "${BLUE}Stage:${NC} $STAGE"
echo -e "${BLUE}API URL:${NC} $API_URL"
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
      echo "  Response: $(echo $body | jq -c '.' 2>/dev/null || echo $body)"
    fi
  else
    echo -e "${RED}✗ FAILED${NC} (Expected $expected_status, got $status_code)"
    FAILED=$((FAILED + 1))
    if [ -n "$body" ]; then
      echo "  Response: $(echo $body | jq -c '.' 2>/dev/null || echo $body)"
    fi
  fi
  echo ""
}

echo -e "${YELLOW}=== User Endpoints ===${NC}"
echo ""

# Test 1: Get current user (returns 200 if user exists, 401 if not provisioned)
test_endpoint \
  "GET /v1/users/me" \
  "GET" \
  "/v1/users/me" \
  "" \
  "200"

# Test 2: Update user (returns 200 if user exists, 401 if not provisioned)
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

# Test 4: List images (may return 503 if R2 storage not configured)
test_endpoint \
  "GET /v1/media/images" \
  "GET" \
  "/v1/media/images?limit=10" \
  "" \
  "200"

# Test 5: Upload image direct (may return 503 if R2 storage not configured)
test_endpoint \
  "POST /v1/media/upload-image-direct" \
  "POST" \
  "/v1/media/upload-image-direct" \
  '{"filename":"test.jpg","contentType":"image/jpeg","imageData":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}' \
  "200"

echo -e "${YELLOW}=== Health Check ===${NC}"
echo ""

# Test 6: Health check
test_endpoint \
  "GET /v1/health" \
  "GET" \
  "/v1/health" \
  "" \
  "200"

echo ""
echo -e "${YELLOW}=== Test Summary ===${NC}"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
