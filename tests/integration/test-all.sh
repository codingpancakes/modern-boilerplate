#!/bin/bash

# Run All Integration Tests
# Usage: ./tests/integration/test-all.sh [JWT_TOKEN]

set -e

JWT_TOKEN=$1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$JWT_TOKEN" ]; then
  echo "❌ Error: JWT token required"
  echo "Usage: ./tests/integration/test-all.sh JWT_TOKEN"
  echo ""
  echo "Get a token by:"
  echo "1. Start dev server: pnpm dev"
  echo "2. Login through frontend"
  echo "3. Copy token from server logs"
  exit 1
fi

echo "🧪 Running All Integration Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

TOTAL_PASSED=0
TOTAL_FAILED=0

# Test REST handlers
echo "1️⃣  REST Handlers"
if bash "$SCRIPT_DIR/test-handlers.sh" "$JWT_TOKEN"; then
  TOTAL_PASSED=$((TOTAL_PASSED + 1))
else
  TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi
echo ""

# Test GraphQL
echo "2️⃣  GraphQL"
if bash "$SCRIPT_DIR/test-graphql.sh" "$JWT_TOKEN"; then
  TOTAL_PASSED=$((TOTAL_PASSED + 1))
else
  TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi
echo ""

# Test health checks
echo "3️⃣  Health Checks"
if bash "$SCRIPT_DIR/test-health-checks.sh"; then
  TOTAL_PASSED=$((TOTAL_PASSED + 1))
else
  TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi
echo ""

# Test middleware
echo "4️⃣  Middleware"
if bash "$SCRIPT_DIR/test-middleware.sh"; then
  TOTAL_PASSED=$((TOTAL_PASSED + 1))
else
  TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "FINAL RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Test Suites Passed: $TOTAL_PASSED"
echo "❌ Test Suites Failed: $TOTAL_FAILED"
echo ""

if [ $TOTAL_FAILED -eq 0 ]; then
  echo "🎉 All integration tests passed!"
  exit 0
else
  echo "💥 Some test suites failed"
  exit 1
fi
