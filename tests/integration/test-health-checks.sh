#!/bin/bash

# Test Health Check Endpoints
# Usage: ./scripts/test-health-checks.sh [staging|production]

set -e

# Load environment helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/env-helper.sh"

STAGE=${1:-staging}

# Get API URL from environment
BASE_URL=$(get_api_url "$STAGE")

echo "🏥 Testing Health Check Endpoints on $STAGE"
echo "Base URL: $BASE_URL"
echo ""

# Test simple health check
echo "1️⃣  Testing simple health check..."
echo "GET $BASE_URL/v1/health"
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/v1/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Simple health check passed"
  echo "$BODY" | jq '.'
else
  echo "❌ Simple health check failed with status $HTTP_CODE"
  echo "$BODY"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test detailed health check
echo "2️⃣  Testing detailed health check..."
echo "GET $BASE_URL/v1/health/detailed"
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/v1/health/detailed")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Detailed health check passed"
  echo "$BODY" | jq '.'
  
  # The detailed endpoint is UNAUTHENTICATED and intentionally returns only an
  # overall status (no per-component checks) so it can't leak component health to
  # the public — see src/node/routes/utils.ts. Assert only what it actually returns:
  # { success, data: { status, timestamp, version } }.
  STATUS=$(echo "$BODY" | jq -r '.data.status')
  TIMESTAMP=$(echo "$BODY" | jq -r '.data.timestamp')
  VERSION=$(echo "$BODY" | jq -r '.data.version')
  echo ""
  echo "📊 Overall Status: $STATUS"
  echo "   Timestamp: $TIMESTAMP"
  echo "   Version: $VERSION"
  echo ""

  if [ "$STATUS" = "healthy" ]; then
    echo "🎉 All systems healthy!"
  elif [ "$STATUS" = "degraded" ]; then
    echo "⚠️  System is degraded (some services have issues)"
  else
    echo "🔴 System is unhealthy!"
    exit 1
  fi
else
  echo "❌ Detailed health check failed with status $HTTP_CODE"
  echo "$BODY"
  exit 1
fi

echo ""
echo "✅ All health checks passed!"
