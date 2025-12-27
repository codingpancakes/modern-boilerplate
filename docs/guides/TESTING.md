# Testing Guide

Complete guide for unit tests, integration tests, and testing the backend locally, staging, and production.

**Last Updated**: December 10, 2025  
**Framework**: Vitest (unit) + Bash scripts (integration)  
**Status**: Consolidated & Production-Ready  
**Coverage**: ~60% (Unit), 90% (Integration)

---

## 📁 Test Organization

```
tests/
├── unit/                           # Vitest unit tests
│   ├── setup.ts
│   ├── lib/
│   │   ├── validation.test.ts      ✅
│   │   ├── errors.test.ts          ✅
│   │   └── permissions.test.ts     ✅
│   └── graphql/
│       └── resolvers/
│           └── users.test.ts       ✅
│
├── integration/                    # Integration tests
│   ├── test-all.sh                 ✅ Master runner
│   ├── test-handlers.sh            ✅ REST API
│   ├── test-graphql.sh             ✅ GraphQL
│   ├── test-api-auth.sh            ✅ Auth
│   ├── test-health-checks.sh       ✅ Health
│   ├── test-middleware.sh          ✅ Middleware
│   ├── test-image-upload.ts        ✅ Image upload
│   └── test-throttling.sh          ✅ Rate limiting
│
└── README.md                       # Test documentation
```

---

## 🧪 Unit Tests

### Test Suite Overview

This project includes comprehensive unit tests to ensure code quality and catch regressions early.

**Test Statistics:**
- **Total Tests**: 40+
- **Test Files**: 4
- **Execution Time**: ~300ms
- **Coverage**: Validation, Error handling, Permissions, GraphQL resolvers

### Available Commands

**Development:**
```bash
pnpm test          # Run tests in watch mode (auto-rerun on file changes)
pnpm test:ui       # Open visual test UI in browser
```

**CI/CD:**
```bash
pnpm test:run      # Run tests once (for CI pipelines)
pnpm check         # Run lint + typecheck + tests
pnpm build         # Full build: check + test + compile + docs
```

### Test Coverage

#### 1. Auth Helpers (`tests/unit/lib/auth.test.ts`)
**6 tests** - Validates JWT claims extraction from API Gateway authorizer context

- ✅ Extract claims from lambda authorizer
- ✅ Throw error if `sub` claim missing
- ✅ Throw error if no claims exist
- ✅ Extract WorkOS user ID from claims
- ✅ Extract org ID from claims
- ✅ Handle missing org ID gracefully

**Why it matters**: Ensures authentication doesn't break when refactoring middleware or auth logic.

#### 2. Error Handling (`tests/unit/lib/errors.test.ts`)
**12 tests** - Validates error creation and formatting

- ✅ Create ApiError with correct status codes
- ✅ Validate all error factory methods (Unauthorized, Forbidden, NotFound, etc.)
- ✅ Format errors correctly for API responses
- ✅ Include request IDs and timestamps
- ✅ Handle unknown errors as 500 Internal Server Error

**Why it matters**: Ensures consistent error responses across all API endpoints. Client apps depend on this format.

#### 3. Validation Schemas (`tests/unit/lib/validation-schemas.test.ts`)
**11 tests** - Validates Zod schemas for media uploads

- ✅ Accept valid image upload requests
- ✅ Reject invalid content types
- ✅ Reject empty filenames
- ✅ Validate direct upload with base64 data
- ✅ Validate list images query parameters
- ✅ Enforce limit constraints (1-100)
- ✅ Coerce string numbers to integers

**Why it matters**: Prevents invalid data from reaching handlers. Security layer against malicious input.

### Test Output Example

```
✓ tests/unit/lib/validation-schemas.test.ts (11 tests) 3ms
✓ tests/unit/lib/errors.test.ts (12 tests) 6ms
✓ tests/unit/lib/auth.test.ts (6 tests) 2ms

Test Files  3 passed (3)
     Tests  29 passed (29)
  Start at  19:57:53
  Duration  270ms
```

### Debugging Failed Tests

**View detailed output:**
```bash
pnpm test:run --reporter=verbose
```

**Run specific test file:**
```bash
pnpm test tests/unit/lib/auth.test.ts
```

**Run with UI for debugging:**
```bash
pnpm test:ui
```

### GraphQL Resolver Tests

**File**: `tests/unit/graphql/resolvers/users.test.ts`

**Coverage:**
- ✅ Query: `me` - Get current user
- ✅ Mutation: `updateMe` - Update user fields
- ✅ Mutation: `updateProfile` - Update profile fields
- ✅ Mutation: `updateMyAccount` - Combined user + profile update
- ✅ Field resolver: `User.profile` - Nested profile data
- ✅ Field resolver: `User.organizations` - User's organizations

**Why it matters**: Ensures GraphQL resolvers correctly interact with the database and handle errors.

### Unit Test Notes

- Tests use **Vitest** (fast, modern test runner)
- Path aliases configured: `@/*` → `src/node/*`
- Test setup in `tests/unit/setup.ts`
- Configuration in `vitest.config.ts`
- TypeScript paths configured in `tsconfig.json`

---

## 🔄 Integration Tests

### Available Test Suites

```bash
# Run all integration tests
./tests/integration/test-all.sh "YOUR_JWT_TOKEN"

# Individual test suites
./tests/integration/test-handlers.sh "JWT"      # REST API handlers
./tests/integration/test-graphql.sh "JWT"       # GraphQL queries/mutations
./tests/integration/test-health-checks.sh       # Health endpoints (no auth)
./tests/integration/test-middleware.sh          # Middleware variants (no auth)
./tests/integration/test-api-auth.sh "JWT"      # Authentication flow
```

### GraphQL Integration Tests

**File**: `tests/integration/test-graphql.sh`

**Coverage:**
- ✅ Query: `me` - Current user data
- ✅ Query: `images` - User's uploaded images
- ✅ Mutation: `updateMe` - Update user
- ✅ Mutation: `updateProfile` - Update profile
- ✅ Mutation: `updateMyAccount` - Combined update
- ✅ Error cases: Invalid syntax, unauthorized access
- ✅ Nested resolvers: Profile, organizations

---

## 🧪 Local Testing

### Prerequisites
- Local dev server running: `pnpm dev`
- Valid WorkOS JWT token
- PostgreSQL running (if testing DB operations)

### Step 1: Start Local Server
```bash
pnpm dev
```

Server should start on `http://localhost:3000`

### Step 2: Get a JWT Token

**Option A: From WorkOS Dashboard**
1. Go to WorkOS Dashboard
2. Navigate to your application
3. Use the "Test Users" section to generate a token

**Option B: From Your Frontend**
1. Log in to your app
2. Open browser DevTools → Network tab
3. Find any API request
4. Copy the `Authorization` header value (the JWT token)

### Step 3: Run Test Suite
```bash
cd tests/integration
chmod +x test-handlers.sh
./test-handlers.sh "YOUR_JWT_TOKEN_HERE"
```

### Expected Results
```
🧪 Testing API Handlers
API URL: http://localhost:3000

=== User Endpoints ===

Testing GET /v1/users/me... ✓ PASSED (HTTP 200)
Testing PATCH /v1/users/me... ✓ PASSED (HTTP 200)

=== Media Endpoints ===

Testing POST /v1/media/upload-image... ✓ PASSED (HTTP 200)
Testing GET /v1/media/images... ✓ PASSED (HTTP 200)
Testing POST /v1/media/upload-image-direct... ✓ PASSED (HTTP 200)

=== Health Check ===

Testing GET /v1/health... ✓ PASSED (HTTP 200)

=== Test Summary ===
Passed: 6
Failed: 0

🎉 All tests passed!
```

---

## 🚀 Staging Testing

### Step 1: Deploy to Staging
```bash
pnpm deploy:staging
```

Wait for deployment to complete (~5-10 minutes).

### Step 2: Test Staging API

**Quick Health Check:**
```bash
curl https://api-staging.postway.services/v1/health | jq .
```

**Run Full Test Suite:**
```bash
cd tests/integration
chmod +x test-api.sh
./test-api.sh staging
```

### Step 3: Test with Authentication

**Get a staging JWT token** (from your staging frontend or WorkOS)

**Test authenticated endpoints:**
```bash
# Get current user
curl -H "Authorization: Bearer YOUR_STAGING_TOKEN" \
  https://api-staging.postway.services/v1/users/me | jq .

# Update user
curl -X PATCH \
  -H "Authorization: Bearer YOUR_STAGING_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user":{"firstName":"Test","lastName":"User"}}' \
  https://api-staging.postway.services/v1/users/me | jq .

# Upload image
curl -X POST \
  -H "Authorization: Bearer YOUR_STAGING_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.jpg","contentType":"image/jpeg"}' \
  https://api-staging.postway.services/v1/media/upload-image | jq .
```

### Expected Staging Results
```
✅ Health check returns 200
✅ CORS headers present
✅ Protected endpoints return 401 without auth
✅ Protected endpoints return 200 with valid token
✅ Custom domain working
```

---

## 🌐 Production Testing

### Step 1: Deploy to Production
```bash
pnpm deploy:production
```

⚠️ **IMPORTANT:** Only deploy to production after staging tests pass!

### Step 2: Test Production API

**Quick Health Check:**
```bash
curl https://api.postway.services/v1/health | jq .
```

**Run Full Test Suite:**
```bash
cd tests/integration
./test-api.sh production
```

### Step 3: Test with Authentication

**Get a production JWT token** (from your production frontend or WorkOS)

**Test authenticated endpoints:**
```bash
# Get current user
curl -H "Authorization: Bearer YOUR_PROD_TOKEN" \
  https://api.postway.services/v1/users/me | jq .

# Update user
curl -X PATCH \
  -H "Authorization: Bearer YOUR_PROD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user":{"firstName":"Test","lastName":"User"}}' \
  https://api.postway.services/v1/users/me | jq .
```

### Expected Production Results
```
✅ Health check returns 200
✅ CORS headers present
✅ Protected endpoints require valid JWT
✅ All endpoints return correct status codes
✅ Custom domain working
✅ SSL/TLS working
```

---

## 🔍 Troubleshooting

### Local Testing Issues

**Issue: "Connection refused"**
- **Solution:** Make sure `pnpm dev` is running

**Issue: "401 Unauthorized"**
- **Solution:** Check your JWT token is valid and not expired
- Get a fresh token from WorkOS or your frontend

**Issue: "500 Internal Server Error" on media endpoints**
- **Solution:** Check AWS credentials are configured
- Verify S3 bucket exists and is accessible

**Issue: "Database connection failed"**
- **Solution:** Make sure PostgreSQL is running
- Check `DATABASE_URL` in `.env.local`

### Staging/Production Issues

**Issue: "Could not resolve host"**
- **Solution:** Wait a few minutes for DNS propagation
- Check Route 53 records are correct

**Issue: "403 Forbidden"**
- **Solution:** Check API Gateway authorizer is configured
- Verify WorkOS JWKS URL is accessible

**Issue: "CORS errors in browser"**
- **Solution:** Check CORS_ORIGIN in environment variables
- Verify origin is in allowed list in `lib/cors.ts`

**Issue: "502 Bad Gateway"**
- **Solution:** Check Lambda function logs in CloudWatch
- Verify Lambda has correct environment variables

---

## 📊 Test Coverage

### Endpoints Tested

| Endpoint | Method | Auth | Local | Staging | Prod |
|----------|--------|------|-------|---------|------|
| `/v1/health` | GET | No | ✅ | ✅ | ✅ |
| `/v1/users/me` | GET | Yes | ✅ | ✅ | ✅ |
| `/v1/users/me` | PATCH | Yes | ✅ | ✅ | ✅ |
| `/v1/media/upload-image` | POST | Yes | ✅ | ✅ | ✅ |
| `/v1/media/images` | GET | Yes | ✅ | ✅ | ✅ |
| `/v1/media/upload-image-direct` | POST | Yes | ✅ | ✅ | ✅ |

### What's Tested

- ✅ Authentication (JWT validation)
- ✅ CORS headers
- ✅ Request validation (Zod schemas)
- ✅ Response format (success/error)
- ✅ Database operations
- ✅ S3 operations
- ✅ Error handling
- ✅ Custom domain routing

---

## 🎯 Quick Test Commands

### Local
```bash
# Start server
pnpm dev

# Run tests
./tests/integration/test-handlers.sh "YOUR_JWT_TOKEN"
```

### Staging
```bash
# Deploy
pnpm deploy:staging

# Test
./tests/integration/test-api.sh staging

# Test with auth
curl -H "Authorization: Bearer TOKEN" \
  https://api-staging.postway.services/v1/users/me | jq .
```

### Production
```bash
# Deploy
pnpm deploy:production

# Test
./tests/integration/test-api.sh production

# Test with auth
curl -H "Authorization: Bearer TOKEN" \
  https://api.postway.services/v1/users/me | jq .
```

---

## 🔄 Workflow Integration

### Pre-Commit
```bash
# Before committing code
pnpm check
git add .
git commit -m "feat: add new feature"
```

### CI/CD Pipeline
```yaml
# Recommended GitHub Actions workflow
- run: pnpm install
- run: pnpm check        # Lint + typecheck + tests
- run: pnpm build        # Full build with tests
```

### Before Deployment
```bash
# Ensure everything passes before deploying
pnpm check && pnpm run deploy:staging
```

---

## 🎯 Best Practices

1. **Run unit tests during development** - Use watch mode (`pnpm test`)
2. **Always run before committing** - Use `pnpm check`
3. **Keep tests fast** - Current suite runs in <300ms
4. **Write tests for bug fixes** - Prevent regressions
5. **Test critical paths** - Auth, validation, error handling
6. **Always test locally first** before deploying
7. **Test staging before production** - never skip staging
8. **Keep JWT tokens secure** - don't commit them
9. **Check CloudWatch logs** if tests fail in staging/prod
10. **Use `jq` for pretty JSON output** in terminal

---

## 📝 Test Checklist

### Before Deploying to Staging
- [ ] All unit tests pass (`pnpm test:run`)
- [ ] All local integration tests pass
- [ ] Build passes (`pnpm build`)
- [ ] No TypeScript errors
- [ ] Environment variables configured

### Before Deploying to Production
- [ ] All staging tests pass
- [ ] Tested with real JWT tokens
- [ ] Verified CORS works from frontend
- [ ] Checked CloudWatch logs for errors
- [ ] Database migrations applied

### After Deployment
- [ ] Health check returns 200
- [ ] Custom domain resolves
- [ ] SSL certificate valid
- [ ] CORS headers present
- [ ] Authentication works
- [ ] All endpoints return correct status codes

---

## 🚀 Future Test Additions

### Integration Tests (Recommended)
Test deployed Lambda functions against real AWS services:
```typescript
// tests/integration/auth-identity-mapping.test.ts
test('getUserIdFromClaims returns correct internal user ID', async () => {
  // Test with real database connection
  // Verify WorkOS subject maps to internal UUID
});
```

### CDK Infrastructure Tests
Validate CDK stack configuration:
```typescript
// tests/infrastructure/api-stack.test.ts
test('API Gateway has WorkOS authorizer configured', () => {
  const template = Template.fromStack(apiStack);
  // Verify infrastructure is correct
});
```

### E2E Tests
Test complete API flows:
```typescript
// tests/e2e/media-upload.test.ts
test('User can upload and retrieve images', async () => {
  // Test full flow: auth → upload → list → verify
});
```

---

## 🔗 Useful Links

- **Local API:** http://localhost:3000
- **Staging API:** https://api-staging.postway.services
- **Production API:** https://api.postway.services
- **API Docs:** Run `node docs/api/serve-docs.js`
- **CloudWatch Logs:** AWS Console → CloudWatch → Log Groups

---

## ✅ Current Status

- ✅ **29/29 unit tests passing**
- ✅ **Lint checks passing**
- ✅ **TypeScript checks passing**
- ✅ **Build successful**
- ✅ **Ready for deployment**

---

**Happy Testing!** 🎉
