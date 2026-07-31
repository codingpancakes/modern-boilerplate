# Security Architecture

This document explains how the backend protects against common attacks.

The backend is one Cloudflare Worker running at the Cloudflare edge. There is no
separate application origin behind the Worker.

---

## Protection Layers

### 1. Cloudflare Edge (DDoS / WAF / TLS)

**Location:** Cloudflare platform (account-level config, not code)

**What it does:**
- Always-on, unmetered DDoS mitigation in front of every request — included, no budget toggle
- Cloudflare WAF (managed rulesets, rate-limiting rules) is configured in the Cloudflare
  dashboard/API per zone — review and enable rules before exposing real users
- TLS termination at the edge

This repository does not configure application-response caching. Add explicit
Cache API/cache-rule behavior only for responses whose authorization and
invalidation model makes caching safe.

Edge protection is account-level configuration rather than repository code.
Treat zone configuration and evidence as part of the deployment checklist.

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
- Verifies signature, expiration, issuer, and the token's `client_id`
  (`WORKOS_CLIENT_ID` application binding; WorkOS tokens here have no `aud`)
- JWKS fetched from WorkOS and cached with a controlled refetch cooldown and
  network timeout
- Verified claims land on `c.get("claims")` — route code never re-parses tokens
- **Fails closed unless explicitly local:** an empty `WORKOS_CLIENT_ID` disables the
  `client_id` application binding (intended only for local dev), which would accept any
  WorkOS-signed token. Verification refuses to run with an empty client id unless
  `STAGE` is exactly `local` or `development`, so an unset/typoed stage cannot
  silently verify unbound

**Flow:**
```
1. User sends request with Authorization: Bearer <token>
2. requireAuth() middleware runs before the route handler
3. verify-token validates the JWT against the WorkOS JWKS
4. Valid   → claims set on context, handler runs
5. Invalid → 401 Unauthorized using the standard error shape
```

**Protection against:**
- Unauthorized access — no token = no access
- Token tampering — invalid signature rejected
- Algorithm confusion — only RS256 accepted
- Expired tokens — old tokens rejected

**Session revocation (a deliberate trade-off — read this):**

Validation is *stateless*: the backend confirms the token is authentic and
unexpired, but does **not** check whether the underlying WorkOS session is still
active. Revoking a session in WorkOS (dashboard, `revokeSession`, or logout)
invalidates the **refresh** token immediately — but any **access token already
issued stays valid until it expires**. Therefore:

> **Revocation latency == the access-token duration.** A revoked session keeps
> working until its current access token expires; the next refresh then fails and
> the user is out.

- **Set the access-token duration short** in the WorkOS dashboard (Applications
  → your application → Sessions). That value is your worst-case revocation
  delay; choose and document it according to the product's risk and usability
  requirements.
- This is standard OAuth/OIDC behaviour, **not a defect**. Every stateless-JWT
  system works this way. Checking the IdP on every request would trade it for
  per-request latency, rate-limit exposure, and an availability dependency on
  WorkOS — a worse deal at any real traffic.
- **If you need enforced sub-duration revocation** (kill a compromised session
  within seconds): subscribe to the WorkOS `session.revoked` webhook, record the
  revoked `sid` in a small denylist (rows expiring after the access-token duration —
  past that the token is rejected by `exp` anyway), and reject any token whose `sid`
  is listed. The `sid` is already on `c.get("claims").sid`; the daily janitor cron
  prunes expired rows. Enforcement stays local (one indexed lookup), with zero
  per-request calls to WorkOS.

---

### 3. Input Validation (Zod)

**Location:** `src/node/lib/validation/`

**What it does:**
- Validates every untrusted body/query/path value that a current endpoint accepts
- Type-safe validation with TypeScript
- Rejects malformed or out-of-bounds input before it reaches business logic
- Arbitrary JSON fields use `jsonObject` (10-level and 10 KB caps);
  `sanitizeObject()` has a separate depth backstop

**Example:**
```typescript
const input = parseBody(rawBody, uploadImageRequest);
```

**Protection against:**
- SQL Injection — invalid input rejected before DB query
- XSS/persisted markup — handled by the separate sanitization step before writes
- Path Traversal — invalid file paths rejected
- Type Confusion — wrong data types rejected
- Nested payload DoS — object depth capped at 10

**Validation schemas:**
- `validation/media.ts` — file-upload names, sizes, content types, and list queries
- `validation/users.ts` — user profile updates
- `validation/webhooks.ts` — webhook payloads
- `validation/organizations.ts` — organization updates
- `validation/common.ts` — pagination, IDs

---

### 4. Drizzle ORM (Parameterized Queries)

**Location:** `src/node/db/schema/` (multiple files + barrel export)

**What it does:**
- All database queries use parameterized statements
- SQL injection is prevented by parameterized Drizzle queries
- Raw/unparameterized SQL strings are prohibited. Narrow, parameterized Drizzle
  `sql` fragments require a documented ORM gap and a real-Postgres test

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
- Three inputs: exact origins (`CORS_EXACT_ORIGINS`), parent domains
  (`CORS_PARENT_DOMAINS`), and legacy wildcard/parent-domain entries
  (`CORS_DOMAIN_PATTERNS`, for example `*.example.com`). The implementation
  performs hostname suffix matching; these are **not regular expressions**
- HTTPS enforcement in production (no http origins accepted)
- Subdomain matching with parent domain min-segment validation
- No header name leakage in rejection responses
- Dev/local origins only accepted when `STAGE` is explicitly `local`/`development`
  (`isDevLikeStage()` in `lib/stage.ts`); unknown or missing stages fail closed
- Answers valid `OPTIONS` preflight with 204 + allow headers; rejects
  unsupported methods/headers with 405/400

**Protection against:**
- Cross-origin data reading — disallowed browser origins cannot read API responses
- Accidental browser integration from unapproved origins

CORS is not, by itself, CSRF protection: browsers may still send some
cross-origin requests even when they cannot read the response. Protected routes
require an explicit bearer token rather than ambient cookie authentication, and
mutations must continue to enforce authentication, authorization, and
idempotency independently of CORS.

---

### 6. Security Headers

**Location:** `src/node/lib/cors.ts` (`securityHeaders()`), applied to every
non-preflight response, including error responses via `app.ts` `onError`.
`OPTIONS` responses intentionally contain only the CORS/preflight headers.

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

Rotation is performed by pushing a new value with `wrangler secret put`, which
redeploys the Worker.

---

### 8. Error Handling (No Information Leakage)

**Location:** `src/node/lib/errors.ts` + `app.ts` `onError` (REST),
`src/node/handlers/graphql/plugins.ts` `errorFormattingPlugin` (GraphQL)

**What it does:**
- No try-catch in route handlers — the app-level `onError` catches and formats everything
- REST: generic error messages to clients (5xx masked when `STAGE` is
  production/staging — `isDeployedStage()` in `lib/stage.ts`), details to Sentry
- GraphQL: errors serialize as `{ message, extensions: { code } }`; outside dev,
  messages for non-safe codes are masked — only whitelisted codes (`BAD_USER_INPUT`,
  `GRAPHQL_VALIDATION_FAILED`, `GRAPHQL_PARSE_FAILED`, `FORBIDDEN`, `UNAUTHENTICATED`,
  `NOT_FOUND`, `CONFLICT`) pass through with their message
- Same code runs locally and deployed — there is no separate dev server to drift

---

### 9. Input Sanitization

**Location:** `src/node/lib/sanitize.ts`

**What it does:**
- `sanitizeObject()` strips HTML tags (script/style blocks lose their contents)
  and control characters; stored data stays plain text exactly as the user wrote
  it — escaping is a render-time concern (`escapeHtml()` is exported for that)
- For recognized URL-like keys, blocks dangerous schemes
  (`javascript:`, `data:`, `vbscript:`, `blob:`), protocol-relative URLs, and
  non-HTTPS absolute URLs
- Sanitizes filenames (strips path separators, null bytes)
- Category and string field character validation
- Applied after Zod validation before persisting user/provider-controlled
  domain values. Internal control rows such as idempotency state and audit
  records use typed constructed values and dedicated redaction/validation.

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
- Skips when the binding is absent only in explicit local development/tests;
  staging and production return `503 RATE_LIMITER_UNAVAILABLE`

**Scope / caveats:**
- Per-colo and approximate (the binding's documented behavior), not a single global
  counter — it bounds cost on the unauthenticated surfaces (webhook HMAC compute, the
  auth/JWKS path) as a first line, and **pairs with** zone-level rate-limiting rules
  and platform DDoS for the global view rather than replacing them

---

### 12. Org-Membership Consent (invite flow)

**Location:** `src/node/lib/services/organizations.ts` (resolvers in
`src/node/handlers/graphql/resolvers/organizations.ts` delegate to it; SDL in
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
1. Zod enforces the field's type and length; this particular punctuation may
   remain valid user text
2. `sanitizeObject` removes unsafe persisted markup/control characters
3. Drizzle binds the value as a query parameter rather than SQL syntax

**Result:** The text may be stored as literal data, but it cannot alter the SQL
statement.

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
3. `sanitizeObject` strips HTML tags before the value is persisted
4. Frontend must escape at render time (`escapeHtml()` in `lib/sanitize.ts` for
   any server-rendered HTML)

**Result:** Attack ineffective (API doesn't render HTML)

---

### DDoS Attack

**Defense:**
1. Cloudflare's always-on DDoS mitigation absorbs volumetric attacks at the edge
2. Optional zone-level WAF / rate-limiting rules block abusive clients
3. Workers scale horizontally within Cloudflare platform limits

**Result:** Volumetric exposure is reduced substantially, but application-layer
abuse, downstream capacity, and request cost still require monitoring and
zone-level controls.

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
1. Protected routes require an explicit `Authorization: Bearer` token rather
   than ambient cookie authentication
2. Every mutation independently enforces authentication and resource-level
   authorization
3. CORS prevents unapproved browser origins from reading API responses
4. Retryable mutations use idempotency controls

**Result:** A cross-origin page has no ambient credential with which to perform
an authenticated mutation. CORS is defense in depth, not the primary CSRF
control.

---

## Security Checklist

- **Authentication** — WorkOS JWT via `requireAuth()` (RS256 pinning, JWKS
  caching, `client_id` application binding)
- **Authorization** — Role-based access control, org membership checks (`ACTIVE` filter); invites require invitee consent (see below)
- **Input Validation** — bounded Zod schemas for accepted domain inputs;
  protocol-specific verification for auth/signature headers
- **SQL Injection** — Drizzle ORM (parameterized queries)
- **XSS** — sanitizeObject + JSON API
- **CSRF** — Explicit bearer authentication; CORS as defense in depth
- **DDoS** — Cloudflare always-on mitigation (edge)
- **Rate limiting** — app-level per-IP limiter (`lib/hono/rate-limit.ts`, `RATE_LIMITER` binding, 429 past 100 req/60s); per-colo, pairs with zone rate-limiting rules + DDoS
- **WAF** — Cloudflare zone configuration (verify before launch; not in code)
- **Secrets** — wrangler secrets; stdin-only sync; constant-time comparisons
- **HTTPS** — Cloudflare TLS + HSTS header
- **Error Handling** — No information leakage (both REST and GraphQL)
- **Audit Logging** — Domain mutations use request, transactional, or strict
  background audit helpers as appropriate; stored rows are DB-immutable
- **Monitoring** — Workers Logs (`[observability]` in wrangler.toml) + Sentry error tracking

---

## Deployments

`pnpm deploy:<stage>` (`scripts/deploy.ts`) runs a **health-gated canary with
automatic rollback**. The flow: record the active version, upload the new one
at 0%, shift `CANARY_PERCENT`
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
