#!/bin/bash

# Test API Gateway Throttling
# Usage: ./scripts/test-throttling.sh [staging|production]

set -e

# Load environment helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/env-helper.sh"

STAGE=${1:-staging}

# Get API URL from environment
BASE_URL=$(get_api_url "$STAGE")

if [ "$STAGE" = "production" ]; then
  echo "⚠️  WARNING: Testing throttling on PRODUCTION"
  echo "This will send 2000 requests to production."
  read -p "Are you sure? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "🚀 Testing API Gateway Throttling on $STAGE"
echo "Base URL: $BASE_URL"
echo ""
echo "📊 Throttling Limits:"
if [ "$STAGE" = "production" ]; then
  echo "   Rate Limit: 1000 requests/second"
  echo "   Burst Limit: 2000 requests"
else
  echo "   Rate Limit: 500 requests/second"
  echo "   Burst Limit: 1000 requests"
fi
echo ""
echo "Sending 2000 requests..."
echo ""

# Create temp file for results
TEMP_FILE=$(mktemp)

# Send burst of requests
for i in {1..2000}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    "$BASE_URL/v1/health" >> "$TEMP_FILE" &
done

# Wait for all requests to complete
wait

echo "✅ All requests completed"
echo ""
echo "📊 Results:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Count and display results
sort "$TEMP_FILE" | uniq -c | while read count code; do
  case $code in
    200)
      echo "   ✅ $count requests succeeded (HTTP 200)"
      ;;
    429)
      echo "   ⚠️  $count requests throttled (HTTP 429)"
      ;;
    502)
      echo "   ❌ $count requests failed (HTTP 502 - Bad Gateway)"
      ;;
    503)
      echo "   ❌ $count requests failed (HTTP 503 - Service Unavailable)"
      ;;
    *)
      echo "   ❓ $count requests returned HTTP $code"
      ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Calculate statistics
TOTAL=$(wc -l < "$TEMP_FILE" | tr -d ' ')
SUCCESS=$(grep -c "200" "$TEMP_FILE" || echo "0")
THROTTLED=$(grep -c "429" "$TEMP_FILE" || echo "0")
ERRORS=$(grep -v "200\|429" "$TEMP_FILE" | wc -l | tr -d ' ')

if [ "$TOTAL" -gt 0 ]; then
  SUCCESS_RATE=$(echo "scale=1; ($SUCCESS * 100) / $TOTAL" | bc)
  THROTTLE_RATE=$(echo "scale=1; ($THROTTLED * 100) / $TOTAL" | bc)
else
  SUCCESS_RATE="0.0"
  THROTTLE_RATE="0.0"
fi

echo "📈 Statistics:"
echo "   Total Requests: $TOTAL"
echo "   Successful: $SUCCESS ($SUCCESS_RATE%)"
echo "   Throttled: $THROTTLED ($THROTTLE_RATE%)"
echo "   Errors: $ERRORS"
echo ""

# Evaluate results
if [ "$STAGE" = "production" ]; then
  EXPECTED_SUCCESS=1000
  EXPECTED_THROTTLE=1000
else
  EXPECTED_SUCCESS=500
  EXPECTED_THROTTLE=1500
fi

echo "🎯 Expected vs Actual:"
echo "   Expected Success: ~$EXPECTED_SUCCESS"
echo "   Actual Success: $SUCCESS"
echo ""
echo "   Expected Throttled: ~$EXPECTED_THROTTLE"
echo "   Actual Throttled: $THROTTLED"
echo ""

# Determine if test passed
if [ "$SUCCESS" -gt 0 ] && [ "$THROTTLED" -gt 0 ]; then
  echo "✅ Throttling is working correctly!"
  echo ""
  echo "💡 Note: Exact numbers may vary due to:"
  echo "   - Network latency"
  echo "   - Request timing"
  echo "   - Lambda cold starts"
  echo "   - API Gateway processing time"
else
  if [ "$THROTTLED" -eq 0 ]; then
    echo "⚠️  WARNING: No requests were throttled!"
    echo "   This might indicate throttling is not configured correctly."
  fi
  if [ "$SUCCESS" -eq 0 ]; then
    echo "❌ ERROR: No requests succeeded!"
    echo "   This indicates a problem with the API."
  fi
fi

# Cleanup
rm "$TEMP_FILE"

echo ""
echo "✅ Throttling test complete!"
