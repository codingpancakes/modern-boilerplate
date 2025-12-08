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
  
  # Check overall status
  STATUS=$(echo "$BODY" | jq -r '.data.status')
  echo ""
  echo "📊 Overall Status: $STATUS"
  
  # Check individual components
  DB_STATUS=$(echo "$BODY" | jq -r '.data.checks.database.status')
  WORKOS_STATUS=$(echo "$BODY" | jq -r '.data.checks.workos.status')
  S3_STATUS=$(echo "$BODY" | jq -r '.data.checks.s3.status')
  
  echo "   Database: $DB_STATUS"
  echo "   WorkOS: $WORKOS_STATUS"
  echo "   S3: $S3_STATUS"
  
  if [ "$DB_STATUS" = "ok" ]; then
    DB_TIME=$(echo "$BODY" | jq -r '.data.checks.database.responseTime')
    echo "   Database response time: ${DB_TIME}ms"
  fi
  
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
