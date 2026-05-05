# Security Architecture

This document explains how the backend protects against common attacks.

---

## Protection Layers

### 1. API Gateway Throttling

**Location:** `infrastructure/lib/api-stack.ts`

**What it does:**
- Rate limiting and burst limits at the API Gateway level
- Production: 1000 requests/sec, 2000 burst
- Non-production: 500 requests/sec, 1000 burst
- Prevents API abuse and DDoS attacks

**Protection against:**
- DDoS attacks (rate limiting)
- API abuse (prevents overwhelming Lambdas)
- Cost control (limits excessive usage)

---

### 2. AWS WAF v2 (Production Only)

**Location:** `infrastructure/lib/api-stack.ts`

**Enabled by:** `ENABLE_WAF=true` in your env file. Off by default — flip it on when you're ready. Saves ~$10/month when disabled. Staging relies on API Gateway throttling, Lambda-level validation, JWT auth, and CloudFront origin verification without it.

**What it does:**
- WAFv2 WebACL attached to the API CloudFront distribution (scope: CLOUDFRONT)
- Inspects every request before it reaches Lambda

**Rules (5 total):**

| # | Rule | Action | What It Catches |
|---|------|--------|-----------------|
| 0 | Body size limit | Block >8KB bodies (exempts GraphQL, media, webhooks) | Oversized payloads on non-upload paths |
| 1 | AWS Common Rules | AWS-managed: XSS, LFI, path traversal, etc. | OWASP Top 10 attack patterns |
| 2 | Known Bad Inputs | AWS-managed: Log4j, Java deser, etc. | Known exploit payloads |
| 3 | SQL Injection | AWS-managed: SQLi patterns in body/query/headers | SQL injection attempts |
| 4 | Rate limit per IP | Block IPs exceeding 2000 requests/5min | DDoS and credential stuffing |

**Cost:** ~$10-11/month fixed ($5 web ACL + $1/rule + $0.60/million requests)

**Protection against:**
- Oversized request payloads
- Request flooding beyond API Gateway throttle
- Known malicious patterns (OWASP Top 10)
- SQL injection at the edge (before Lambda executes)
- DDoS and brute-force attacks

---

### 3. CloudFront Origin Verification

**Location:** `src/node/lib/origin-verify.ts`, `infrastructure/lib/api-stack.ts`

**Problem:** HTTP API v2 does not support resource policies, so the raw `execute-api` URL is publicly accessible and bypasses CloudFront (and therefore WAF).

**Solution:** CloudFront adds a shared secret header (`X-Origin-Verify`) to every origin request. The Lambda authorizer and public-route middleware reject requests missing or mismatching this header using timing-safe comparison.

**Flow:**
```
CloudFront → adds X-Origin-Verify header → API Gateway → Lambda checks header → proceeds
Direct hit → no header → Lambda rejects with 403
```

**Configuration:**
- Set `ORIGIN_VERIFY_SECRET` in `.env.staging` and `.env.production`
- Generate with: `openssl rand -hex 32`
- The check is skipped in local development and when the secret is not configured (gradual rollout)

**Protection against:**
- Direct API Gateway access bypassing WAF
- Direct API Gateway access bypassing CloudFront rate limiting

---

### 4. Input Validation (Zod)

**Location:** `src/node/lib/validation/`

**What it does:**
- Validates all request bodies, query params, and path params
- Type-safe validation with TypeScript
- Rejects malformed or malicious input BEFORE it reaches business logic
- Object depth limiting (max 10 levels) prevents deeply nested payload DoS

**Example:**
```typescript
const input = parseBody(event, uploadImageRequest);
```

**Protection against:**
- SQL Injection — invalid input rejected before DB query
- XSS — malicious scripts rejected at validation
- Path Traversal — invalid file paths rejected
- Type Confusion — wrong data types rejected
- Nested payload DoS — object depth capped at 10

**Validation schemas:**
- `validation/media.ts` — file uploads, content types, magic byte checks
- `validation/users.ts` — user profile updates
- `validation/webhooks.ts` — webhook payloads
- `validation/organizations.ts` — organization updates
- `validation/common.ts` — pagination, IDs

---

### 5. Drizzle ORM (Parameterized Queries)

**Location:** `src/node/db/schema/` (multiple files + barrel export)

**What it does:**
- All database queries use parameterized statements
- SQL injection is impossible by design
- No raw SQL strings

**Example:**
```typescript
await db.select().from(users).where(eq(users.id, userId));
```

**Protection against:**
- SQL Injection — completely prevented by ORM
- Database attacks — no raw SQL execution

---

### 6. JWT Authentication (WorkOS)

**Location:** `src/node/authorizers/workos-jwt.ts`

**What it does:**
- Validates JWT tokens via API Gateway Lambda authorizer
- RS256 algorithm pinning (rejects other algorithms)
- Verifies signature, expiration, issuer, and audience
- JWKS caching with TTL for performance
- CLIENT_ID validated at startup (fail-fast)

**Flow:**
```
1. User sends request with Authorization: Bearer <token>
2. API Gateway calls Lambda authorizer
3. Authorizer validates JWT with WorkOS JWKS
4. If valid, claims forwarded to handler
5. If invalid, returns 401 Unauthorized
```

**Protection against:**
- Unauthorized access — no token = no access
- Token tampering — invalid signature rejected
- Algorithm confusion — only RS256 accepted
- Expired tokens — old tokens rejected

---

### 7. CORS (Dynamic Origin Validation)

**Location:** `src/node/lib/cors.ts`

**What it does:**
- Validates request origin against environment-driven configuration
- Three layers: exact origins (`CORS_EXACT_ORIGINS`), parent domains (`CORS_PARENT_DOMAINS`), and regex patterns (`CORS_DOMAIN_PATTERNS`)
- HTTPS enforcement in production (no http origins accepted)
- Subdomain matching with parent domain min-segment validation
- No header name leakage in rejection responses
- Dev/local origins only accepted when `DEV` scope is active

**Protection against:**
- CSRF attacks — only allowed origins can make requests
- XSS attacks — malicious sites can't call API
- Data theft — unauthorized domains blocked

---

### 8. Security Headers

**Location:** `src/node/lib/cors.ts` (`securityHeaders()` function)

**What it does:**
- Adds security headers to all responses
- Prevents common browser-based attacks

**Headers:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

**Protection against:**
- Clickjacking — X-Frame-Options: DENY
- MIME sniffing — X-Content-Type-Options: nosniff
- Man-in-the-middle — HSTS forces HTTPS
- Content injection — CSP restricts resources

---

### 9. Secrets Management

**Location:** `infrastructure/lib/security-stack.ts`

**What it does:**
- Stores sensitive data in AWS Secrets Manager as JSON
- Secret paths: `/{PROJECT_NAME}/{STAGE}/workos` and `/{PROJECT_NAME}/{STAGE}/database`
- JSON shape validated at fetch time (rejects malformed secrets)
- WorkOS webhook secret shape validated and cached
- DB password URL-encoded automatically
- Encrypted at rest with AWS KMS

**Protection against:**
- Credential exposure — secrets encrypted
- Code leaks — no secrets in git
- Unauthorized access — IAM controls access
- Malformed secrets — shape validation at runtime

---

### 10. Error Handling (No Information Leakage)

**Location:** `src/node/lib/errors.ts` (REST), `src/node/handlers/graphql/handler.ts` (GraphQL)

**What it does:**
- Catches all errors in middleware
- REST: generic error messages to clients, detailed errors logged to Sentry
- GraphQL: `formatError` masks internal errors; only whitelisted codes (`BAD_USER_INPUT`, `GRAPHQL_VALIDATION_FAILED`, `GRAPHQL_PARSE_FAILED`, `FORBIDDEN`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT`) pass through
- Local dev server mirrors the same masking behavior

**Protection against:**
- Information disclosure — no stack traces to clients
- Attack reconnaissance — attackers can't learn system details
- Database schema leaks — no SQL errors exposed

---

### 11. Input Sanitization

**Location:** `src/node/lib/sanitize.ts`

**What it does:**
- `sanitizeObject()` applies HTML escaping via character whitelist
- Blocks dangerous URL schemes (javascript:, data:, vbscript:)
- Blocks protocol-relative URLs (`//host/path`)
- Sanitizes filenames (strips path separators, null bytes)
- Category and string field character validation
- Applied after Zod validation, before DB write

---

## Attack Scenarios & Defenses

### SQL Injection Attack
```bash
# Attacker tries:
PATCH /v1/users/me
{"user":{"firstName": "'; DROP TABLE users; --"}}
```

**Defense:**
1. Zod validation rejects invalid characters
2. `sanitizeObject` strips dangerous content
3. Drizzle ORM uses parameterized queries

**Result:** Attack fails at validation layer

---

### XSS Attack
```bash
# Attacker tries:
POST /v1/media/upload-image
{"filename": "<script>alert('hacked')</script>.jpg"}
```

**Defense:**
1. API returns JSON, not HTML (XSS doesn't work)
2. Zod validation rejects invalid filenames
3. `sanitizeObject` escapes HTML entities
4. Frontend should sanitize before rendering

**Result:** Attack ineffective (API doesn't render HTML)

---

### DDoS Attack

**Defense:**
1. CloudFront + WAF: edge-level protection
2. API Gateway throttling: request rate limits
3. Excess requests return 429 Too Many Requests

**Result:** Attack mitigated at multiple layers

---

### Unauthorized Access
```bash
# Attacker tries without token:
GET /v1/users/me
```

**Defense:**
1. API Gateway authorizer validates JWT
2. No token = 401 Unauthorized
3. Invalid token = 401 Unauthorized

**Result:** Request rejected at API Gateway

---

### CSRF Attack

**Defense:**
1. CORS validation checks origin against environment-configured allowlist
2. Malicious origin not in allowlist
3. Request blocked by browser

**Result:** Browser blocks cross-origin request

---

## Security Checklist

- **Authentication** — JWT with WorkOS (RS256, algorithm pinning, JWKS caching)
- **Authorization** — Role-based access control, org membership checks
- **Input Validation** — Zod schemas + sanitization on all endpoints
- **SQL Injection** — Drizzle ORM (parameterized queries)
- **XSS** — sanitizeObject + JSON API
- **CSRF** — Dynamic CORS validation
- **Rate Limiting** — API Gateway throttling + WAF rate rules (production)
- **WAF** — AWS Managed Rules for XSS, SQLi, bad inputs, body size (production only)
- **Origin Verification** — CloudFront shared secret header blocks direct execute-api access
- **Secrets** — AWS Secrets Manager with shape validation
- **HTTPS** — Enforced via HSTS header
- **Error Handling** — No information leakage (both REST and GraphQL)
- **Audit Logging** — All mutations logged with `logAudit` / `auditResolver`
- **Monitoring** — CloudWatch alarms + X-Ray tracing + Sentry error tracking
- **Deployments** — Blue-green canary (10%/5min) in production with automatic rollback

---

## Blue-Green Deployments (Canary)

**Location:** `infrastructure/lib/routes/route-builder.ts`, `infrastructure/lib/api-stack.ts`

Every Lambda handler is deployed via CodeDeploy blue-green with automatic rollback.

### How It Works

1. CDK publishes a new Lambda version on each deploy
2. CodeDeploy intercepts the alias update (all handlers use a `"live"` alias)
3. Traffic is shifted according to the deployment config
4. If the error alarm fires during the shift, CodeDeploy reverts the alias immediately

### Deployment Strategies by Stage

| Stage | Strategy | Behavior |
|---|---|---|
| **Production** | `CANARY_10PERCENT_5MINUTES` | 10% of traffic goes to the new version for 5 minutes. If the error alarm stays green, the remaining 90% shifts over. If it fires, instant rollback. |
| **Staging** | `ALL_AT_ONCE` | 100% cutover immediately. Faster iteration, still has alarm-based rollback. |

### Rollback Trigger

Each handler gets a CloudWatch alarm: **> 3 Lambda errors in any 1-minute window**. If this fires during the deployment window, CodeDeploy automatically reverts the alias to the previous version. The alarm also notifies the SNS alarm topic (email).

### What Gets Blue-Green Wrapped

- All Node.js REST handlers (created via `RouteBuilder.createHandler()`)
- GraphQL handler
- WorkOS authorizer
- Python handlers
- Scheduled handlers (janitor)

All API Gateway integrations point at the `"live"` alias, not the raw function — this is what enables CodeDeploy to control traffic shifting.

---

## Future Enhancements

### Consider Adding:
1. **Rate Limiting Per User** (Medium Priority)
   - Currently: Per IP via API Gateway
   - Future: Per user ID in application code

2. **Secrets Rotation** (Operational)
   - Automatic rotation every 90 days
   - Already supported by Secrets Manager

---

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [AWS Security Best Practices](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [Zod Documentation](https://zod.dev/)
- [Drizzle ORM Security](https://orm.drizzle.team/docs/sql)
