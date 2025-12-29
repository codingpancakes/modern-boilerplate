# Authentication & Authorization Audit

**Date:** December 29, 2025  
**Environment:** Local, Staging, Production

---

## Overview

This document provides a comprehensive audit of authentication and authorization flows across all handler types (GraphQL, REST, Webhooks) in local, staging, and production environments.

---

## 1. Authentication Architecture

### 1.1 WorkOS JWT Authentication

**Provider:** WorkOS (OAuth/SSO)  
**Token Type:** RS256 JWT  
**JWKS Endpoint:** `https://api.workos.com/sso/jwks/{CLIENT_ID}`

**JWT Claims Structure:**
```typescript
{
  sub: string;           // WorkOS provider subject (user_01...)
  email?: string;
  org_id?: string;
  role?: string;
  iss: string;           // Issuer
  exp: number;           // Expiration timestamp
  iat: number;           // Issued at timestamp
  sid?: string;          // Session ID
  jti?: string;          // JWT ID
}
```

**Important:** `claims.sub` is the **WorkOS provider subject**, NOT the internal user ID. The internal user ID is retrieved by querying `authIdentities` table.

---

## 2. Authorization Flow by Environment

### 2.1 Production & Staging (AWS Lambda)

**Authorizer:** Custom Lambda Authorizer (`workos-jwt.ts`)

**Flow:**
1. Request arrives at API Gateway with `Authorization: Bearer <token>` header
2. API Gateway invokes Lambda Authorizer (`workos-jwt.ts`)
3. Authorizer validates JWT:
   - Fetches JWKS from WorkOS
   - Verifies signature (RS256)
   - Validates issuer: `https://api.workos.com/` or `https://api.workos.com/user_management/{CLIENT_ID}`
   - Checks expiration with 60s clock tolerance
   - Timeout: 5s max
4. On success:
   - Returns `{ isAuthorized: true, context: {...claims} }`
   - Context cached for 5 minutes (reduces Lambda invocations)
5. On failure:
   - Returns `{ isAuthorized: false }`
   - API Gateway returns 401/403 to client

**Caching:** Valid tokens cached for 5 minutes at API Gateway level

**File:** `src/node/authorizers/workos-jwt.ts`

### 2.2 Local Development (Express)

**Authorizer:** Express middleware (`requireAuth`)

**Flow:**
1. Request arrives at Express server with `Authorization: Bearer <token>` header
2. Middleware extracts token
3. Fetches JWKS from WorkOS (cached for 1 hour)
4. Verifies JWT using `jose` library
5. On success:
   - Attaches claims to `req.user`
   - Calls `next()`
6. On failure:
   - Returns 401 with error message

**Caching:** JWKS cached for 1 hour in memory

**File:** `local-dev/server.ts` (lines 206-224)

---

## 3. Handler Types & Authorization

### 3.1 GraphQL Handler

**Endpoint:** `/v1/graphql`  
**Methods:** POST, GET  
**Authorization:** ✅ **REQUIRED** (WorkOS JWT)

**Flow:**
1. API Gateway validates JWT via Lambda Authorizer
2. Request forwarded to GraphQL Lambda with claims in `event.requestContext.authorizer`
3. `createContext()` extracts claims and creates GraphQL context:
   - Calls `getClaims(event)` to get JWT claims
   - Calls `getUserIdFromClaims(event)` to get internal user ID from `authIdentities` table
   - Creates database connection
   - Returns `GraphQLContext` with user info
4. Resolvers access user info via `context.userId`, `context.orgId`, etc.

**Context Structure:**
```typescript
interface GraphQLContext extends AuditContext {
  userId: string;           // Internal UUID from users table
  orgId: string;            // Organization ID from JWT
  role: string;             // User role from JWT
  email: string;            // User email from JWT
  providerSubject: string;  // WorkOS ID (claims.sub)
  claims: Record<string, unknown>;
  db: DrizzleDB;
  organizationId?: string;
}
```

**Files:**
- Handler: `src/node/handlers/graphql/handler.ts`
- Context: `src/node/handlers/graphql/context.ts`
- Auth helpers: `src/node/lib/auth.ts`
- CDK config: `infrastructure/lib/api-stack.ts` (lines 281-290)

**Local Development:**
- Express middleware validates JWT
- Mock Lambda event created with claims in `event.requestContext.authorizer.lambda`
- Same `createContext()` function used

---

### 3.2 REST Endpoints (Protected)

**Endpoints:** 
- `/v1/media/*` (upload, list, etc.)
- `/v1/users/me`
- `/v1/users/update`

**Authorization:** ✅ **REQUIRED** (WorkOS JWT)

**Flow:**
1. API Gateway validates JWT via Lambda Authorizer
2. Request forwarded to handler Lambda with claims in `event.requestContext.authorizer`
3. Handler uses `getClaims(event)` or `getUserIdFromClaims(event)` to get user info
4. Handler processes request with user context

**Files:**
- Handlers: `src/node/handlers/media/*`, `src/node/handlers/users/*`
- CDK config: `infrastructure/lib/routes/protected-routes.ts`

**Local Development:**
- Express middleware validates JWT
- Mock Lambda event created with claims
- Same handler functions used

---

### 3.3 Webhooks (Public with HMAC Verification)

**Endpoint:** `/v1/webhooks/workos`  
**Methods:** POST  
**Authorization:** ❌ **NO JWT** (uses HMAC signature verification)

**Security:**
- WorkOS signs webhook payload with HMAC-SHA256
- Signature format: `t={timestamp}, v1={signature}`
- Signed payload: `{timestamp}.{body}`
- Secret stored in AWS Secrets Manager (prod/staging) or env var (local)

**Flow:**
1. Request arrives at API Gateway (no authorizer)
2. Request forwarded directly to webhook Lambda
3. Handler extracts signature from `workos-signature` header
4. Fetches webhook secret from Secrets Manager or env var
5. Computes expected signature
6. Compares signatures (constant-time comparison)
7. On success: processes webhook event
8. On failure: returns 401

**Idempotency:**
- Uses `idempotencyKeys` table to prevent duplicate processing
- Key: `{event.id}` from WorkOS

**Files:**
- Handler: `src/node/handlers/webhooks/workos.ts`
- CDK config: `infrastructure/lib/routes/public-routes.ts` (lines 66-105)

**Local Development:**
- Same handler function used
- Webhook secret from `.env.local` (`WORKOS_WEBHOOK_SECRET`)
- Can stub if secret not configured

---

### 3.4 Health Checks (Public)

**Endpoints:**
- `/v1/health` - Simple health check
- `/v1/health/detailed` - Detailed health check (DB, external services)

**Authorization:** ❌ **NO AUTH REQUIRED**

**Files:**
- Handlers: `src/node/handlers/utils/health.ts`, `src/node/handlers/utils/health-detailed.ts`
- CDK config: `infrastructure/lib/routes/public-routes.ts` (lines 25-64)

---

### 3.5 Internal Routes

**Status:** ✅ **NO INTERNAL ROUTES CURRENTLY DEFINED**

The `InternalRoutes` class exists as a placeholder for future internal service-to-service communication endpoints, but **no routes are currently registered**.

**Files:**
- CDK config: `infrastructure/lib/routes/internal-routes.ts` (empty - no routes defined)

**Future Considerations:**
If internal routes are added in the future, they should use one of:
- VPC-only access (Lambda in VPC, API Gateway VPC endpoint)
- API key authentication
- IP allowlist
- mTLS (mutual TLS) for service-to-service auth

---

## 4. Security Analysis

### 4.1 ✅ Strengths

1. **JWT Validation:**
   - Proper RS256 signature verification
   - JWKS fetched from WorkOS (not hardcoded keys)
   - Issuer validation
   - Expiration checking with clock tolerance
   - Timeout protection (5s)

2. **Caching:**
   - API Gateway caches valid tokens for 5 minutes
   - Reduces Lambda authorizer invocations
   - JWKS cached with cooldown (60s) to prevent abuse

3. **Webhook Security:**
   - HMAC signature verification
   - Idempotency protection
   - Secrets stored in AWS Secrets Manager (not env vars in prod)

4. **Separation of Concerns:**
   - Public routes clearly separated from protected routes
   - Webhooks use different auth mechanism (HMAC vs JWT)
   - GraphQL uses same JWT auth as REST

5. **Local/Prod Parity:**
   - Same handler functions used locally and in prod
   - Same JWT validation logic
   - Mock Lambda events preserve auth context structure

### 4.2 ⚠️ Potential Issues

1. **~~Internal Routes (CRITICAL):~~** ✅ **FALSE ALARM**
   - No internal routes currently defined in the codebase
   - `InternalRoutes` class exists but is empty (no routes registered)
   - If internal routes are added in the future, they should use VPC, API keys, or IP allowlists

2. **~~GraphQL Docs Route:~~** ✅ **RESOLVED**
   - Endpoint: `/graphql/docs`
   - ❌ No authentication required
   - **Risk:** Exposes GraphQL schema publicly
   - **Recommendation:** Add JWT auth or IP allowlist for staging/prod

3. **Error Handling:**
   - Authorizer returns same response for expired vs invalid tokens
   - **Risk:** No differentiation for debugging
   - **Recommendation:** Add error codes in logs (already done: `token_expired` vs `invalid_token`)

4. **Claims Mapping:**
   - `claims.sub` is WorkOS ID, not internal user ID
   - Requires DB lookup via `authIdentities` table
   - **Risk:** Extra DB query on every GraphQL request
   - **Recommendation:** Consider caching user ID mapping

5. **Local Development:**
   - JWKS cached for 1 hour (longer than prod's 5 min)
   - **Risk:** Stale keys if WorkOS rotates keys
   - **Recommendation:** Reduce cache TTL to match prod

---

## 5. Environment-Specific Configuration

### 5.1 Environment Variables

**All Environments:**
- `WORKOS_CLIENT_ID` - WorkOS client ID
- `PROJECT_NAME` - Project name for resource naming
- `STAGE` - Environment stage (local/staging/production)

**Local Only:**
- `WORKOS_WEBHOOK_SECRET` - Webhook HMAC secret (plaintext)
- `DATABASE_URL` - Direct database connection string

**Staging/Production Only:**
- `WORKOS_SECRET_ARN` - ARN of Secrets Manager secret containing:
  - `webhookSecret` - Webhook HMAC secret
  - Other WorkOS secrets
- `DB_SECRET_ARN` - ARN of database credentials secret

### 5.2 Secrets Management

**Local:**
- Secrets in `.env.local` (plaintext)
- Not committed to git (in `.gitignore`)

**Staging/Production:**
- Secrets in AWS Secrets Manager
- Accessed via IAM role permissions
- Rotatable without code changes
- Encrypted at rest

**Sync Command:**
```bash
pnpm sync-secrets staging|production
```

---

## 6. Authorization Matrix

| Endpoint | Method | Auth Type | Local | Staging | Prod | Notes |
|----------|--------|-----------|-------|---------|------|-------|
| `/v1/graphql` | POST, GET | JWT | ✅ | ✅ | ✅ | WorkOS JWT required |
| `/graphql/docs` | GET | None | ✅ | ❌ | ❌ | ✅ Development only (disabled in staging/prod) |
| `/v1/media/*` | POST, GET, DELETE | JWT | ✅ | ✅ | ✅ | WorkOS JWT required |
| `/v1/users/me` | GET | JWT | ✅ | ✅ | ✅ | WorkOS JWT required |
| `/v1/users/update` | POST | JWT | ✅ | ✅ | ✅ | WorkOS JWT required |
| `/v1/webhooks/workos` | POST | HMAC | ✅ | ✅ | ✅ | WorkOS signature required |
| `/v1/health` | GET | None | ✅ | ✅ | ✅ | Public |
| `/v1/health/detailed` | GET | None | ✅ | ✅ | ✅ | Public |
| Internal routes | * | N/A | N/A | N/A | N/A | ✅ No internal routes currently defined |

---

## 7. Recommendations

### 7.1 High Priority

1. **~~Secure Internal Routes:~~** ✅ **NOT APPLICABLE**
   - No internal routes currently exist in the codebase
   - `InternalRoutes` class is a placeholder with no routes defined
   - When/if internal routes are added, use VPC, API keys, or IP allowlists

2. **~~Restrict GraphQL Docs:~~** ✅ **COMPLETED**
   - GraphQL docs now only deployed in development environments
   - Disabled in staging and production
   - Available at `/graphql/docs` in local development only

### 7.2 Medium Priority

3. **Cache User ID Mapping:**
   - Cache `authIdentities` lookups to reduce DB queries
   - Use Redis or in-memory cache with TTL

4. **Standardize JWKS Cache TTL:**
   - Reduce local JWKS cache from 1 hour to 5 minutes
   - Match production behavior

5. **Add Rate Limiting:**
   - Add per-IP rate limiting for public endpoints
   - Especially webhooks and health checks

### 7.3 Low Priority

6. **Enhanced Logging:**
   - Add structured logging for all auth failures
   - Include request ID, IP, user agent
   - Already partially implemented

7. **Monitoring:**
   - Add CloudWatch alarms for auth failures
   - Track JWT expiration patterns
   - Monitor webhook signature failures

---

## 8. Testing Authentication

### 8.1 Local Testing

**Get JWT Token:**
1. Login via WorkOS in your frontend
2. Copy JWT from browser dev tools or logs
3. Use in API requests:
   ```bash
   curl -X POST http://localhost:3000/v1/graphql \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"query":"{ __typename }"}'
   ```

### 8.2 Staging Testing

**Get JWT Token:**
1. Login via WorkOS in staging frontend
2. Copy JWT from browser dev tools
3. Use in API requests:
   ```bash
   curl -X POST https://api-staging.postway.services/v1/graphql \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"query":"{ __typename }"}'
   ```

**Test Expired Token:**
- Wait 5 minutes after token issued
- Should receive 403 Forbidden

**Test Invalid Token:**
- Use malformed token
- Should receive 403 Forbidden

### 8.3 Webhook Testing

**Local:**
```bash
# Get webhook secret from .env.local
WEBHOOK_SECRET="your_secret"

# Generate signature
TIMESTAMP=$(date +%s)000
PAYLOAD='{"id":"evt_test","event":"user.created","data":{}}'
SIGNATURE=$(echo -n "${TIMESTAMP}.${PAYLOAD}" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | cut -d' ' -f2)

# Send webhook
curl -X POST http://localhost:3000/v1/webhooks/workos \
  -H "Content-Type: application/json" \
  -H "workos-signature: t=${TIMESTAMP}, v1=${SIGNATURE}" \
  -d "$PAYLOAD"
```

---

## 9. Files Reference

### Core Authentication Files
- `src/node/authorizers/workos-jwt.ts` - Lambda authorizer for JWT validation
- `src/node/lib/auth.ts` - Auth helper functions (getClaims, getUserIdFromClaims)
- `src/node/handlers/graphql/context.ts` - GraphQL context creation with auth
- `local-dev/server.ts` - Local Express server with JWT middleware

### Infrastructure Files
- `infrastructure/lib/api-stack.ts` - API Gateway and authorizer setup
- `infrastructure/lib/routes/public-routes.ts` - Public routes (health, webhooks)
- `infrastructure/lib/routes/protected-routes.ts` - Protected routes (media, users)
- `infrastructure/lib/routes/internal-routes.ts` - Internal routes (messaging)

### Handler Files
- `src/node/handlers/graphql/handler.ts` - GraphQL Lambda handler
- `src/node/handlers/webhooks/workos.ts` - WorkOS webhook handler with HMAC
- `src/node/handlers/media/*` - Media handlers (protected)
- `src/node/handlers/users/*` - User handlers (protected)

---

## 10. Summary

**Overall Security Posture:** ✅ **GOOD** with some areas for improvement

**Strengths:**
- Proper JWT validation with RS256
- HMAC signature verification for webhooks
- Secrets management via AWS Secrets Manager
- Local/prod parity for testing

**Critical Issues:**
- ❌ Internal routes not VPC-protected
- ⚠️ GraphQL docs publicly accessible

**Next Steps:**
1. Secure internal routes with VPC or IP allowlist
2. Restrict GraphQL docs in staging/production
3. Add user ID caching to reduce DB queries
4. Implement rate limiting for public endpoints
