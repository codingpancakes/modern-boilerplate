#!/bin/bash

# Test GraphQL Endpoint
# Usage: ./tests/integration/test-graphql.sh [JWT_TOKEN]

set -e

JWT_TOKEN=$1
API_URL=${API_URL:-http://localhost:8787}

if [ -z "$JWT_TOKEN" ]; then
  echo "❌ Error: JWT token required"
  echo "Usage: ./tests/integration/test-graphql.sh JWT_TOKEN"
  echo ""
  echo "Get a token by:"
  echo "1. Start dev server: pnpm dev"
  echo "2. Login through frontend"
  echo "3. Copy token from server logs"
  exit 1
fi

echo "🧪 Testing GraphQL Endpoint"
echo "API URL: $API_URL/v1/graphql"
echo ""

PASSED=0
FAILED=0

# Helper function to test GraphQL query
test_graphql() {
  local NAME=$1
  local QUERY=$2
  local EXPECTED_HTTP=${3:-200}
  
  echo "Testing $NAME..."
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$QUERY" \
    $API_URL/v1/graphql)
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | head -n-1)
  
  if [ "$HTTP_CODE" = "$EXPECTED_HTTP" ]; then
    echo "✅ $NAME - PASSED (HTTP $HTTP_CODE)"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    PASSED=$((PASSED + 1))
  else
    echo "❌ $NAME - FAILED (Expected $EXPECTED_HTTP, got $HTTP_CODE)"
    echo "$BODY"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "QUERIES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test Query: me
test_graphql "Query: me" '{
  "query": "{ me { id email firstName lastName type profile { preferredName photoUrl onboardingCompleted } } }"
}'

# Test Query: me with organizations
test_graphql "Query: me (with organizations)" '{
  "query": "{ me { id email organizations { role organization { id name slug } } } }"
}'

# Test Query: images
test_graphql "Query: images" '{
  "query": "{ images(limit: 5) { key url size lastModified } }"
}'

# Test Query: myOrganizations
test_graphql "Query: myOrganizations" '{
  "query": "{ myOrganizations { role organization { id name slug } } }"
}'

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MUTATIONS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test Mutation: updateMe
test_graphql "Mutation: updateMe" '{
  "query": "mutation($input: UpdateUserInput!) { updateMe(input: $input) { id firstName } }",
  "variables": {
    "input": { "firstName": "TestUpdated" }
  }
}'

# Test Mutation: updateProfile
test_graphql "Mutation: updateProfile" '{
  "query": "mutation($input: UpdateProfileInput!) { updateProfile(input: $input) { userId preferredName } }",
  "variables": {
    "input": { "preferredName": "TestNickname" }
  }
}'

# Test Mutation: updateMyAccount (combined)
test_graphql "Mutation: updateMyAccount" '{
  "query": "mutation($user: UpdateUserInput, $profile: UpdateProfileInput) { updateMyAccount(user: $user, profile: $profile) { user { id firstName } profile { preferredName } } }",
  "variables": {
    "user": { "firstName": "Combined" },
    "profile": { "preferredName": "CombinedNick" }
  }
}'

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "ERROR CASES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test invalid query (should return 400)
test_graphql "Invalid query syntax" '{
  "query": "{ invalid syntax }"
}' 400

# Test missing authorization (should return 401)
echo "Testing unauthorized access..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "{ me { id } }"}' \
  $API_URL/v1/graphql)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "401" ]; then
  echo "✅ Unauthorized access - PASSED (HTTP 401)"
  PASSED=$((PASSED + 1))
else
  echo "❌ Unauthorized access - FAILED (Expected 401, got $HTTP_CODE)"
  FAILED=$((FAILED + 1))
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Passed: $PASSED"
echo "❌ Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "🎉 All GraphQL tests passed!"
  exit 0
else
  echo "💥 Some tests failed"
  exit 1
fi
