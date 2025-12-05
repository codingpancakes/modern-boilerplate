# Testing

This directory contains all test scripts for the project.

## Test Scripts

### Integration Tests (`integration/`)

#### `test-handlers.sh`
Tests all API handlers locally.

**Usage:**
```bash
# Start local dev server first
pnpm dev

# In another terminal, run tests
./tests/integration/test-handlers.sh "YOUR_JWT_TOKEN"
```

**What it tests:**
- ✅ User endpoints (`/v1/users/me`)
- ✅ Media endpoints (`/v1/media/*`)
- ✅ Health check (`/v1/health`)

**Expected output:**
```
🧪 Testing API Handlers
API URL: http://localhost:3000

=== User Endpoints ===
Testing GET /v1/users/me... ✓ PASSED (HTTP 200)
Testing PATCH /v1/users/me... ✓ PASSED (HTTP 200)

=== Media Endpoints ===
Testing POST /v1/media/upload-image... ✓ PASSED (HTTP 200)
...

🎉 All tests passed!
```

---

#### `test-middleware.sh`
Tests middleware variants (API key, webhook signature).

**Usage:**
```bash
./tests/integration/test-middleware.sh
```

**What it tests:**
- ✅ API key authentication
- ✅ Webhook signature validation
- ✅ Custom header validation

---

#### `test-api.sh`
Tests deployed API (staging or production).

**Usage:**
```bash
# Test staging
./tests/integration/test-api.sh staging

# Test production
./tests/integration/test-api.sh production
```

**What it tests:**
- ✅ Health check
- ✅ CORS configuration
- ✅ API availability

---

## Getting a JWT Token

### Option 1: From Local Dev Server
```bash
# Start server
pnpm dev

# Login through your frontend app
# Server will log: 🔑 INTERCEPTED TOKEN: eyJ...

# Copy the token from logs
```

### Option 2: From WorkOS Dashboard
1. Go to WorkOS Dashboard
2. Navigate to User Management
3. Create a test session
4. Copy the access token

---

## Writing New Tests

### Adding a Test to `test-handlers.sh`

```bash
echo "Testing POST /v1/resource..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "value"
  }' \
  $API_URL/v1/resource)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ PASSED (HTTP 200)"
  echo "  Response: $BODY"
  PASSED=$((PASSED + 1))
else
  echo "✗ FAILED (Expected 200, got $HTTP_CODE)"
  echo "  Response: $BODY"
  FAILED=$((FAILED + 1))
fi
echo ""
```

---

## Test Checklist

When adding a new handler, ensure:
- [ ] Handler has corresponding test in `test-handlers.sh`
- [ ] Test covers success case (200)
- [ ] Test covers error cases (400, 401, 404)
- [ ] Test validates response structure
- [ ] All tests pass locally
- [ ] Tests pass against staging

---

## Continuous Integration

### Local Testing Workflow
```bash
# 1. Start dev server
pnpm dev

# 2. Run handler tests
./tests/integration/test-handlers.sh "JWT_TOKEN"

# 3. Run middleware tests
./tests/integration/test-middleware.sh

# 4. Check for TypeScript errors
pnpm build

# 5. Check for lint errors
pnpm lint
```

### Pre-Deployment Testing
```bash
# 1. Deploy to staging
pnpm deploy:staging

# 2. Test staging API
./tests/integration/test-api.sh staging

# 3. Run full integration tests against staging
# (Get fresh JWT from staging environment)
./tests/integration/test-handlers.sh "STAGING_JWT_TOKEN"
```

---

## Troubleshooting

### "Invalid access token" Error
**Cause:** JWT token expired (tokens expire after 5 minutes)

**Solution:** Get a fresh token:
```bash
# Restart dev server and login again
pnpm dev
```

---

### "Connection refused" Error
**Cause:** Local dev server not running

**Solution:**
```bash
# Start the server
pnpm dev
```

---

### "AWS credentials not found" Error
**Cause:** Missing AWS credentials for S3 operations

**Solution:**
```bash
# Add to .env.local
AWS_PROFILE=your-profile-name
```

---

### Test Fails But Handler Works in Browser
**Cause:** Possible CORS or header issue

**Debug:**
```bash
# Add -v flag to curl for verbose output
curl -v -X GET \
  -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:3000/v1/users/me
```

---

## Best Practices

### ✅ DO
- Run tests before committing
- Test both success and error cases
- Use descriptive test names
- Validate response structure
- Test against staging before production
- Keep tests fast and focused

### ❌ DON'T
- Commit without running tests
- Test only happy paths
- Hardcode tokens in scripts
- Skip error case testing
- Deploy without testing staging
- Create slow, flaky tests

---

## Future Improvements

- [ ] Add unit tests for individual functions
- [ ] Add E2E tests with Playwright
- [ ] Add load testing scripts
- [ ] Add automated CI/CD pipeline
- [ ] Add test coverage reporting
- [ ] Add performance benchmarks

---

## Need Help?

- **Writing Tests:** See existing tests in `integration/`
- **Handler Patterns:** See `.ai/PATTERNS.md`
- **Contributing:** See `CONTRIBUTING.md`
