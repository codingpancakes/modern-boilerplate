#!/bin/bash
set -e

# Smoke tests for post-deployment validation
# Usage: ./smoke-test.sh <API_URL> [AUTH_TOKEN]

API_URL="${API_URL:-$1}"
AUTH_TOKEN="${TEST_AUTH_TOKEN:-$2}"

if [ -z "$API_URL" ]; then
  echo "❌ Error: API_URL not provided"
  echo "Usage: ./smoke-test.sh <API_URL> [AUTH_TOKEN]"
  exit 1
fi

echo "🔍 Running smoke tests against: $API_URL"
echo ""

# Test 1: Health check
echo "Test 1: Health check..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/v1/health")
if [ "$HEALTH_RESPONSE" -eq 200 ]; then
  echo "✅ Health check passed (200)"
else
  echo "❌ Health check failed (got $HEALTH_RESPONSE, expected 200)"
  exit 1
fi

# Test 2: Authenticated endpoint (if token provided)
if [ -n "$AUTH_TOKEN" ]; then
  echo ""
  echo "Test 2: Authenticated endpoint (/v1/users/me)..."
  ME_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    "$API_URL/v1/users/me")
  
  if [ "$ME_RESPONSE" -eq 200 ]; then
    echo "✅ Authenticated endpoint passed (200)"
  else
    echo "❌ Authenticated endpoint failed (got $ME_RESPONSE, expected 200)"
    exit 1
  fi
else
  echo ""
  echo "⚠️  Skipping authenticated tests (no AUTH_TOKEN provided)"
fi

# Test 3: CORS headers
echo ""
echo "Test 3: CORS headers..."
CORS_RESPONSE=$(curl -s -I -X OPTIONS \
  -H "Origin: https://app.postway.ai" \
  -H "Access-Control-Request-Method: GET" \
  "$API_URL/v1/health" | grep -i "access-control-allow-origin" || true)

if [ -n "$CORS_RESPONSE" ]; then
  echo "✅ CORS headers present"
else
  echo "⚠️  CORS headers not found (may be expected for some endpoints)"
fi

# Test 4: 404 handling
echo ""
echo "Test 4: 404 handling..."
NOT_FOUND_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/v1/nonexistent")
if [ "$NOT_FOUND_RESPONSE" -eq 404 ]; then
  echo "✅ 404 handling works correctly"
else
  echo "⚠️  Unexpected response for 404 (got $NOT_FOUND_RESPONSE)"
fi

echo ""
echo "🎉 All smoke tests passed!"
