# 🔒 Security Architecture

This document explains how the backend protects against common attacks.

---

## 🛡️ Protection Layers

### 1. **API Gateway Throttling** ⚡

**Location:** `infrastructure/lib/api-stack.ts`

**What it does:**
- Rate limiting: 2000 requests per second per route
- Burst limit: 1000 concurrent requests
- Prevents API abuse and DDoS attacks

**Configuration:**
```typescript
throttle: {
  rateLimit: 2000,  // requests per second
  burstLimit: 1000, // concurrent requests
}
```

**Protection against:**
- ✅ DDoS attacks (rate limiting)
- ✅ API abuse (prevents overwhelming Lambdas)
- ✅ Cost control (limits excessive usage)

---

### 2. **Input Validation (Zod)** 🔍

**Location:** `src/node/lib/validation/`

**What it does:**
- Validates all request bodies, query params, and path params
- Type-safe validation with TypeScript
- Rejects malformed or malicious input BEFORE it reaches business logic

**Example:**
```typescript
// src/node/handlers/media/upload-image.ts
const input = parseBody(event, uploadImageRequest);
// If validation fails, throws BadRequest error
// Malicious input never reaches S3 or database
```

**Protection against:**
- ✅ **SQL Injection** - Invalid input rejected before DB query
- ✅ **XSS** - Malicious scripts rejected at validation
- ✅ **Path Traversal** - Invalid file paths rejected
- ✅ **Type Confusion** - Wrong data types rejected

**Validation schemas:**
- `validation/media.ts` - File uploads, content types
- `validation/users.ts` - User profile updates
- `validation/webhooks.ts` - Webhook payloads
- `validation/common.ts` - Pagination, IDs

---

### 3. **Drizzle ORM (Parameterized Queries)** 💉

**Location:** `src/node/db/schema.ts`

**What it does:**
- All database queries use parameterized statements
- SQL injection is IMPOSSIBLE by design
- No raw SQL strings

**Example:**
```typescript
// SAFE - Parameterized query
await db.select().from(users).where(eq(users.id, userId));

// NEVER do this (we don't):
// await db.execute(`SELECT * FROM users WHERE id = '${userId}'`); // ❌ SQL injection!
```

**Protection against:**
- ✅ **SQL Injection** - Completely prevented by ORM
- ✅ **Database attacks** - No raw SQL execution

---

### 4. **JWT Authentication (WorkOS)** 🔐

**Location:** `src/node/authorizers/workos-jwt.ts`

**What it does:**
- Validates JWT tokens via API Gateway authorizer
- Verifies signature, expiration, issuer
- Extracts user claims (user ID, org ID, email)

**Flow:**
```
1. User sends request with Authorization: Bearer <token>
2. API Gateway calls Lambda authorizer
3. Authorizer validates JWT with WorkOS JWKS
4. If valid, request proceeds to handler
5. If invalid, returns 401 Unauthorized
```

**Protection against:**
- ✅ **Unauthorized access** - No token = no access
- ✅ **Token tampering** - Invalid signature rejected
- ✅ **Expired tokens** - Old tokens rejected
- ✅ **Token replay** - Expiration prevents reuse

---

### 5. **CORS (Strict Origin Validation)** 🌐

**Location:** `src/node/lib/cors.ts`

**What it does:**
- Validates request origin against allowlist
- Only allows requests from approved domains
- Prevents cross-origin attacks

**Allowed origins:**
```typescript
const ALLOWED_ORIGINS = [
  'https://app.postway.ai',
  'https://postway.ai',
  'http://localhost:3000', // Development only
];
```

**Protection against:**
- ✅ **CSRF attacks** - Only allowed origins can make requests
- ✅ **XSS attacks** - Malicious sites can't call API
- ✅ **Data theft** - Unauthorized domains blocked

---

### 6. **Security Headers** 🛡️

**Location:** `src/node/lib/middleware.ts`

**What it does:**
- Adds security headers to all responses
- Prevents common browser-based attacks

**Headers:**
```typescript
{
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
}
```

**Protection against:**
- ✅ **Clickjacking** - X-Frame-Options: DENY
- ✅ **MIME sniffing** - X-Content-Type-Options: nosniff
- ✅ **Man-in-the-middle** - HSTS forces HTTPS
- ✅ **Content injection** - CSP restricts resources

---

### 7. **Secrets Management** 🔑

**Location:** `infrastructure/lib/security-stack.ts`

**What it does:**
- Stores sensitive data in AWS Secrets Manager
- Encrypted at rest with AWS KMS
- Automatic rotation support

**Secrets:**
- `WORKOS_CLIENT_ID` - WorkOS API credentials
- `DATABASE_URL` - Database connection string
- Never hardcoded in code

**Protection against:**
- ✅ **Credential exposure** - Secrets encrypted
- ✅ **Code leaks** - No secrets in git
- ✅ **Unauthorized access** - IAM controls access

---

### 8. **Error Handling (No Information Leakage)** 🚫

**Location:** `src/node/lib/errors.ts`

**What it does:**
- Catches all errors in middleware
- Returns generic error messages to clients
- Logs detailed errors to Sentry (internal only)

**Example:**
```typescript
// Internal error (logged to Sentry):
Error: Database connection failed: invalid password

// Client sees:
{
  "error": "Internal server error",
  "code": "INTERNAL_ERROR",
  "requestId": "abc123"
}
```

**Protection against:**
- ✅ **Information disclosure** - No stack traces to clients
- ✅ **Attack reconnaissance** - Attackers can't learn system details
- ✅ **Database schema leaks** - No SQL errors exposed

---

## 🌐 Cloudflare Integration

We use Cloudflare instead of AWS WAF for several reasons:

**Why Cloudflare:**
- ✅ Works with HTTP API v2 (AWS WAF doesn't)
- ✅ Free tier includes DDoS protection, bot detection, and WAF
- ✅ Simpler setup (10 minutes vs 2-3 hours)
- ✅ Lower cost ($0-20/month vs $50-100/month)
- ✅ Better DDoS protection than AWS WAF
- ✅ No need for CloudFront complexity

**What Cloudflare provides:**
- Unlimited DDoS protection
- Bot detection and blocking
- Rate limiting
- WAF rules (OWASP protection)
- CDN caching
- SSL/TLS

---

## 🎯 Attack Scenarios & Defenses

### SQL Injection Attack
```bash
# Attacker tries:
POST /v1/users/update
{"name": "'; DROP TABLE users; --"}
```

**Defense:**
1. ✅ Zod validation rejects invalid characters
2. ✅ Drizzle ORM uses parameterized queries
3. ✅ Even if validation bypassed, ORM prevents injection

**Result:** Attack fails at validation layer

---

### XSS Attack
```bash
# Attacker tries:
POST /v1/posts
{"content": "<script>alert('hacked')</script>"}
```

**Defense:**
1. ✅ API returns JSON, not HTML (XSS doesn't work)
2. ✅ Zod validation can reject script tags if needed
3. ✅ Frontend should sanitize before rendering

**Result:** Attack ineffective (API doesn't render HTML)

---

### DDoS Attack
```bash
# Attacker sends 10,000 requests per second
```

**Defense:**
1. ✅ API Gateway throttling: 2000 req/sec limit
2. ✅ Burst limit: 1000 concurrent requests
3. ✅ Excess requests return 429 Too Many Requests

**Result:** Attack limited to 2000 req/sec, Lambda protected

---

### Unauthorized Access
```bash
# Attacker tries without token:
GET /v1/users/me
```

**Defense:**
1. ✅ API Gateway authorizer validates JWT
2. ✅ No token = 401 Unauthorized
3. ✅ Invalid token = 401 Unauthorized

**Result:** Request rejected at API Gateway

---

### CSRF Attack
```bash
# Malicious site tries to call API:
fetch('https://api.postway.services/v1/users/delete', {
  method: 'DELETE',
  credentials: 'include'
})
```

**Defense:**
1. ✅ CORS validation checks origin
2. ✅ Malicious origin not in allowlist
3. ✅ Request blocked by browser

**Result:** Browser blocks cross-origin request

---

## 📊 Security Checklist

- ✅ **Authentication** - JWT with WorkOS
- ✅ **Authorization** - Role-based access control
- ✅ **Input Validation** - Zod schemas on all endpoints
- ✅ **SQL Injection** - Drizzle ORM (parameterized queries)
- ✅ **XSS** - API returns JSON, not HTML
- ✅ **CSRF** - CORS validation
- ✅ **Rate Limiting** - API Gateway throttling
- ✅ **Secrets** - AWS Secrets Manager
- ✅ **HTTPS** - Enforced via HSTS header
- ✅ **Error Handling** - No information leakage
- ✅ **Logging** - Sentry for error tracking
- ✅ **Monitoring** - CloudWatch alarms

---

## 🚀 Future Enhancements

### Consider Adding:
1. **Cloudflare** (Free)
   - Advanced DDoS protection
   - Bot detection
   - Geographic blocking
   - CDN caching

2. **Rate Limiting Per User** (Medium Priority)
   - Currently: Per IP via API Gateway
   - Future: Per user ID in application code

3. **Audit Logging** (Compliance)
   - Track who did what when
   - Required for SOC2/GDPR

4. **Secrets Rotation** (Operational)
   - Automatic rotation every 90 days
   - Already supported by Secrets Manager

---

## 📞 Security Contacts

**Report vulnerabilities:**
- Email: security@postway.services
- Response time: 24 hours

**Security incidents:**
- On-call: [PagerDuty/OpsGenie]
- Escalation: [CTO contact]

---

## 🎓 Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [AWS Security Best Practices](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [Zod Documentation](https://zod.dev/)
- [Drizzle ORM Security](https://orm.drizzle.team/docs/sql)
