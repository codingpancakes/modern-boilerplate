# Security Architecture

This document explains how the backend protects against common attacks.

The backend is one Cloudflare Worker — there is no API Gateway, no Lambda, and **no
origin to protect**: the Worker runs at the edge itself, so the whole "direct-to-origin
bypass" class of problems (the old `X-Origin-Verify` machinery) is gone by construction.

---

## Protection Layers

### 1. Cloudflare Edge (DDoS / WAF / CDN)

**Location:** Cloudflare platform (account-level config, not code)

**What it does:**
- Always-on, unmetered DDoS mitigation in front of every request — included, no budget toggle
- Cloudflare WAF (managed rulesets, rate-limiting rules) is configured in the Cloudflare
  dashboard/API per zone — review and enable rules before exposing real users
- TLS termination and CDN caching at the edge

**What changed from AWS:** replaces AWS WAF v2 (+$10/month, `ENABLE_WAF` toggle), API
Gateway throttling, and CloudFront. Edge protection is no longer defined in this repo —
there is no infrastructure code to read; treat zone configuration as part of the
deployment checklist.

**Note:** there is also an **application-level per-IP rate limiter** in the Worker
(see layer 11 below). It complements — does not replace — these zone-level rules and
the platform DDoS mitigation: it is per-colo and approximate, so zone rate-limiting
rules remain the place for global/per-path limits.

---

### 2. JWT Authentication (WorkOS)

**Location:** `src/node/lib/hono/auth.ts` (`requireAuth()` middleware) →
`src/node/authorizers/verify-token.ts` (the single source of auth trust)

**What it does:**
- Verifies the `Authorization: Bearer <JWT>` on every protected domain
  (`routes/index.ts` applies `requireAuth()` to `/v1/users/*`, `/v1/media/*`, `/v1/graphql/*`)
- RS256 algorithm pinning (rejects other algorithms)
- Verifies signature, expiration, issuer, and audience (`WORKOS_CLIENT_ID` binding)
- JWKS fetched from WorkOS and cached with TTL
- Verified claims land on `c.get("claims")` — route code never re-parses tokens
- **Fails closed in deployed environments:** an empty `WORKOS_CLIENT_ID` disables the
  `client_id` audience binding (intended only for local dev), which would accept any
  WorkOS-signed token. When `STAGE` is `staging` or `production`, verification refuses
  to run with an empty client id rather than verifying unbound

**Flow:**
```
1. User sends request with Authorization: Bearer <token>
2. requireAuth() middleware runs before the route handler
3. verify-token validates the JWT against the WorkOS JWKS
4. Valid   → claims set on context, handler runs
5. Invalid → 401 Unauthorized (legacy-compatible error shape)
```

**Protection against:**
- Unauthorized access — no token = no access
- Token tampering — invalid signature rejected
- Algorithm confusion — only RS256 accepted
- Expired tokens — old tokens rejected

---

### 3. Input Validation (Zod)

**Location:** `src/node/lib/validation/`

**What it does:**
- Validates all request bodies, query params, and path params
- Type-safe validation with TypeScript
- Rejects malformed or malicious input BEFORE it reaches business logic
- Object depth limiting (max 10 levels) prevents deeply nested payload DoS

**Example:**
```typescript
const input = parseBody(rawBody, uploadImageRequest);
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

### 4. Drizzle ORM (Parameterized Queries)

**Location:** `src/node/db/schema/` (multiple files + barrel export)

**What it does:**
- All database queries use parameterized statements
- SQL injection is impossible by design
- No raw SQL strings (migrations are the only SQL)

**Example:**
```typescript
await db.select().from(users).where(eq(users.id, userId));
```

---

### 5. CORS (Dynamic Origin Validation)

**Location:** `src/node/lib/cors.ts`, applied app-wide by the
`corsAndSecurityHeaders()` middleware in `src/node/app.ts`

**What it does:**
- Validates request origin against environment-driven configuration
- Three layers: exact origins (`CORS_EXACT_ORIGINS`), parent domains
  (`CORS_PARENT_DOMAINS`), and regex patterns (`CORS_DOMAIN_PATTERNS`) —
  all set in `wrangler.toml [vars]`
- HTTPS enforcement in production (no http origins accepted)
- Subdomain matching with parent domain min-segment validation
- No header name leakage in rejection responses
- Dev/local origins only accepted when `NODE_ENV` is neither production nor staging
- Answers `OPTIONS` preflight with 204 + the allow headers

**Protection against:**
- CSRF — only allowed origins can make browser requests
- Data theft — unauthorized domains blocked

---

### 6. Security Headers

**Location:** `src/node/lib/cors.ts` (`securityHeaders()`), applied to every response —
including error responses via `app.ts` `onError`

**Headers:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

---

### 7. Secrets Management

**Location:** `.dev.vars` (local, gitignored) / `wrangler secret` (deployed);
registry of names in `.dev.vars.example`; push script `scripts/sync-secrets.ts`

**What it does:**
- Secrets are stored encrypted by Cloudflare and injected into the Worker at runtime
  (mirrored onto `process.env` via `nodejs_compat`)
- `pnpm sync-secrets <stage>` pipes values to `wrangler secret put` over stdin —
  values never appear in argv, `ps`, or logs
- No secrets in `wrangler.toml`, code, or git
- All secret/key comparisons in app code use constant-time comparison
  (`src/node/lib/constant-time.ts`)

**What changed from AWS:** replaces Secrets Manager + rotation-TTL caching in `db.ts`.
Rotation is now: push a new value (`wrangler secret put`), which redeploys the Worker.

---

### 8. Error Handling (No Information Leakage)

**Location:** `src/node/lib/errors.ts` + `app.ts` `onError` (REST),
`src/node/handlers/graphql/plugins.ts` `errorFormattingPlugin` (GraphQL)

**What it does:**
- No try-catch in route handlers — the app-level `onError` catches and formats everything
- REST: generic error messages to clients (5xx masked when `NODE_ENV` is
  production/staging), details to Sentry
- GraphQL: errors serialize as `{ message, extensions: { code } }`; outside dev,
  messages for non-safe codes are masked — only whitelisted codes (`BAD_USER_INPUT`,
  `GRAPHQL_VALIDATION_FAILED`, `GRAPHQL_PARSE_FAILED`, `FORBIDDEN`, `UNAUTHENTICATED`,
  `NOT_FOUND`, `CONFLICT`) pass through with their message
- Same code runs locally and deployed — there is no separate dev server to drift

---

### 9. Input Sanitization

**Location:** `src/node/lib/sanitize.ts`

**What it does:**
- `sanitizeObject()` applies HTML escaping via character whitelist
- Blocks dangerous URL schemes (javascript:, data:, vbscript:)
- Blocks protocol-relative URLs (`//host/path`)
- Sanitizes filenames (strips path separators, null bytes)
- Category and string field character validation
- Applied after Zod validation, before every DB write

---

### 10. Webhook & Diagnostic Endpoint Hardening

**Location:** `src/node/routes/webhooks.ts`, `src/node/routes/test.ts`

- WorkOS webhooks verify the HMAC signature (`WORKOS_WEBHOOK_SECRET`) with
  constant-time comparison and a replay window; processing is idempotent
  (DB-backed `lib/idempotency.ts`)
- `/v1/test/*` diagnostics return the standard 404 when `STAGE=production`
  (checked per request) — production is indistinguishable from an unknown route

---

### 11. Application Rate Limiting (per-IP)

**Location:** `src/node/lib/hono/rate-limit.ts`, mounted early in `src/node/app.ts`
(after `requestId`, before `dbScope`) so a flood is rejected before a DB pool opens or
a token is verified

**What it does:**
- Per-IP limiter (keyed by `CF-Connecting-IP`) backed by the Cloudflare Workers Rate
  Limiting binding (`RATE_LIMITER`) — configured entirely in `wrangler.toml`
  (`simple = { limit = 100, period = 60 }`), no dashboard resource
- Returns `429` once the limit is exceeded
- Skips gracefully when the binding is absent (local dev / tests)

**Scope / caveats:**
- Per-colo and approximate (the binding's documented behavior), not a single global
  counter — it bounds cost on the unauthenticated surfaces (webhook HMAC compute, the
  auth/JWKS path) as a first line, and **pairs with** zone-level rate-limiting rules
  and platform DDoS for the global view rather than replacing them

---

### 12. Org-Membership Consent (invite flow)

**Location:** `src/node/handlers/graphql/resolvers/organizations.ts` (SDL in
`src/node/handlers/graphql/schema/index.ts`); `assignment_status` enum in
`src/node/db/schema/enums.ts`

**What it does:**
- `inviteMember` first verifies the **target user exists** (rejects `NOT_FOUND`) —
  it does not mint memberships for arbitrary IDs
- The invite is created as `PENDING`, not `ACTIVE`. Because every membership/user query
  filters on `status = "ACTIVE"`, a PENDING invitee is **invisible** to org member
  listings until they consent
- The invited user becomes a real member only by calling `acceptInvitation` themselves
  (`PENDING → ACTIVE`); `declineInvitation` sets it `INACTIVE`. Both act only on the
  caller's own PENDING row

**Protection against:**
- IDOR / unsolicited-membership PII exposure — an admin cannot pull another user into an
  org (and thereby surface that user in member listings) without the user's own consent

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
1. Cloudflare's always-on DDoS mitigation absorbs volumetric attacks at the edge
2. Optional zone-level WAF / rate-limiting rules block abusive clients
3. Workers scale horizontally with no concurrency ceiling — no Lambda pool to exhaust

**Result:** Mitigated at the edge; the cost exposure is per-request billing, not outage

---

### Unauthorized Access
```bash
# Attacker tries without token:
GET /v1/users/me
```

**Defense:**
1. `requireAuth()` middleware runs before the handler
2. No token = 401 Unauthorized
3. Invalid token = 401 Unauthorized

**Result:** Request rejected before any handler code runs

---

### CSRF Attack

**Defense:**
1. CORS validation checks origin against environment-configured allowlist
2. Malicious origin not in allowlist
3. Request blocked by browser

**Result:** Browser blocks cross-origin request

---

## Security Checklist

- **Authentication** — WorkOS JWT via `requireAuth()` (RS256 pinning, JWKS caching, audience binding)
- **Authorization** — Role-based access control, org membership checks (`ACTIVE` filter); invites require invitee consent (see below)
- **Input Validation** — Zod schemas + sanitization on all endpoints
- **SQL Injection** — Drizzle ORM (parameterized queries)
- **XSS** — sanitizeObject + JSON API
- **CSRF** — Dynamic CORS validation
- **DDoS** — Cloudflare always-on mitigation (edge)
- **Rate limiting** — app-level per-IP limiter (`lib/hono/rate-limit.ts`, `RATE_LIMITER` binding, 429 past 100 req/60s); per-colo, pairs with zone rate-limiting rules + DDoS
- **WAF** — Cloudflare zone configuration (verify before launch; not in code)
- **Secrets** — wrangler secrets; stdin-only sync; constant-time comparisons
- **HTTPS** — Cloudflare TLS + HSTS header
- **Error Handling** — No information leakage (both REST and GraphQL)
- **Audit Logging** — All mutations logged with `logAudit` / resolver-level audit; DB-immutable
- **Monitoring** — Workers Logs (`[observability]` in wrangler.toml) + Sentry error tracking

---

## Deployments

`pnpm deploy:<stage>` (`scripts/deploy.ts`) runs a **health-gated canary with
automatic rollback** — it replaces the AWS-era CodeDeploy blue-green machinery. The
flow: record the active version, upload the new one at 0%, shift `CANARY_PERCENT`
(default 10%) of traffic and soak, probe `/v1/health/detailed`, promote to 100% and
re-probe; **any** health failure redeploys the recorded version at 100% and exits
non-zero. First deploy (no prior version) skips the canary and goes straight to 100%.

`pnpm deploy:<stage>:simple` is a plain `wrangler deploy` (no canary; also the one-time
path for registering new Queue consumers). `npx wrangler rollback --env <stage>` reverts
to a previous version manually. Each `wrangler` publish is an atomic versioned deploy.

---

## Future Enhancements

1. **Per-user rate limiting** — the app limiter is per-IP (`RATE_LIMITER` binding) and
   zone rules cover per-path; add per-user (per-subject) limits in app code if abuse
   patterns warrant finer granularity
2. **Logpush retention sink** — for compliance evidence, pairing with the app audit trail

---

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)
- [Zod Documentation](https://zod.dev/)
- [Drizzle ORM Security](https://orm.drizzle.team/docs/sql)
