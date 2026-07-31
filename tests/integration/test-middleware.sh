#!/bin/bash

# Test script for middleware variants
# Usage: ./test-middleware.sh

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="http://localhost:8787"
TEST_HEADER_VALUE="test-api-key-12345"

echo -e "${YELLOW}🧪 Testing Middleware Variants${NC}"
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
  local headers="$4"
  local data="$5"
  local expected_status="$6"
  
  echo -n "Testing $name... "
  
  if [ "$method" = "GET" ]; then
    if [ -n "$headers" ]; then
      response=$(curl -s -w "\n%{http_code}" \
        -X GET \
        -H "$headers" \
        "$API_URL$endpoint")
    else
      response=$(curl -s -w "\n%{http_code}" \
        -X GET \
        "$API_URL$endpoint")
    fi
  else
    if [ -n "$headers" ]; then
      response=$(curl -s -w "\n%{http_code}" \
        -X "$method" \
        -H "$headers" \
        -H "Content-Type: application/json" \
        -d "$data" \
        "$API_URL$endpoint")
    else
      response=$(curl -s -w "\n%{http_code}" \
        -X "$method" \
        -H "Content-Type: application/json" \
        -d "$data" \
        "$API_URL$endpoint")
    fi
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

echo -e "${YELLOW}=== API Key Middleware (withApiKey) ===${NC}"
echo ""

# Test 1: API key - valid
test_endpoint \
  "GET /v1/test/api-key (valid key)" \
  "GET" \
  "/v1/test/api-key" \
  "X-API-Key: $TEST_HEADER_VALUE" \
  "" \
  "200"

# Test 2: API key - invalid
test_endpoint \
  "GET /v1/test/api-key (invalid key)" \
  "GET" \
  "/v1/test/api-key" \
  "X-API-Key: wrong-key" \
  "" \
  "400"

# Test 3: API key - missing
test_endpoint \
  "GET /v1/test/api-key (no key)" \
  "GET" \
  "/v1/test/api-key" \
  "" \
  "" \
  "400"

echo -e "${YELLOW}=== Webhook Signature Middleware (withWebhookSignature) ===${NC}"
echo ""

# Test 4: Webhook - with signature
test_endpoint \
  "POST /v1/test/webhook (with signature)" \
  "POST" \
  "/v1/test/webhook" \
  "X-Webhook-Signature: test-signature-123" \
  '{"event":"user.created","data":{"userId":"123"}}' \
  "200"

# Test 5: Webhook - missing signature
test_endpoint \
  "POST /v1/test/webhook (no signature)" \
  "POST" \
  "/v1/test/webhook" \
  "" \
  '{"event":"user.created","data":{"userId":"123"}}' \
  "400"

echo ""
echo -e "${YELLOW}=== Test Summary ===${NC}"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 All middleware tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
