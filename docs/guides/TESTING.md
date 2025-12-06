# Testing Guide

Complete guide for testing the backend locally, staging, and production.

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

## 📝 Test Checklist

### Before Deploying to Staging
- [ ] All local tests pass
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

## 🔗 Useful Links

- **Local API:** http://localhost:3000
- **Staging API:** https://api-staging.postway.services
- **Production API:** https://api.postway.services
- **API Docs:** Run `node docs/api/serve-docs.js`
- **CloudWatch Logs:** AWS Console → CloudWatch → Log Groups

---

## 💡 Tips

1. **Always test locally first** before deploying
2. **Test staging before production** - never skip staging
3. **Keep JWT tokens secure** - don't commit them
4. **Check CloudWatch logs** if tests fail in staging/prod
5. **Use `jq` for pretty JSON output** in terminal
6. **Test CORS from browser** to catch frontend issues

---

**Happy Testing!** 🎉
