# Testing Guide

Complete guide for unit tests, integration tests, and testing the backend locally and deployed.

**Framework**: Vitest (unit + real-DB integration) + Bash scripts (live-API integration)
**Status**: Production hardening coverage — fast unit gate plus real-DB race and transaction tests

---

## 📁 Test Organization

```
tests/
├── unit/                               # Vitest unit tests (no DB, no network*)
│   ├── lib/
│   │   ├── auth.test.ts                ✅ Claims-object contract (normalization, sub required)
│   │   ├── errors.test.ts              ✅ Error factory + wire format
│   │   ├── validation-schemas.test.ts  ✅ Zod schemas
│   │   ├── db.test.ts                  ✅ Driver-wiring guard (neon-serverless)
│   │   ├── sanitize.test.ts            ✅ XSS escaping + recursion depth
│   │   ├── audit.test.ts               ✅ Redaction + write-failure metric format
│   │   └── pagination.test.ts          ✅ Lossless cursor round-trip
│   ├── authorizers/
│   │   └── verify-token.test.ts        ✅ WorkOS token verifier (real RS256 keys*)
│   ├── cron.test.ts                    ✅ Cron registry ↔ wrangler.toml trigger parity
│   └── graphql/
│       ├── yoga.test.ts                ✅ Yoga harness limits (depth/complexity/masking)
│       └── resolvers/users.test.ts     ✅ Resolvers (mocked db.transaction)
│
├── integration/
│   ├── db-transactions.test.ts         ✅ Real-DB commit/rollback (Vitest)
│   ├── helpers/test-db.ts              ✅ Real-DB harness (migrations + citext)
│   ├── test-all.sh                     ✅ Master runner (live API)
│   ├── test-api.sh                     ✅ Deployed staging/prod smoke
│   ├── test-handlers.sh                ✅ REST API
│   ├── test-graphql.sh                 ✅ GraphQL
│   ├── test-api-auth.sh                ✅ Authentication flow
│   ├── test-health-checks.sh           ✅ Health endpoints
│   ├── test-middleware.sh              ✅ Security/diagnostic endpoints (/v1/test/*)
│   └── test-throttling.sh              ✅ Rate-limit probe
└── manual/
    └── test-image-upload.sh            Manual R2 upload walkthrough
```

Current totals: **21 unit test files, 145 tests** (~0.8s) plus **6 real-DB
integration files, 39 tests**.

---

## 🧪 Unit Tests

### Commands

```bash
pnpm test          # watch mode (auto-rerun on change)
pnpm test:ui       # visual test UI in browser
pnpm test:run      # run once (CI)
pnpm check         # lint + typecheck + unit tests
```

**Debugging:**
```bash
pnpm test:run --reporter=verbose
pnpm test tests/unit/lib/auth.test.ts     # one file
```

### What the suite guards

- **Auth contract** (`lib/auth.test.ts`) — `getClaims` accepts only verified claims
  objects, requires `sub`, rejects garbage. (The API-Gateway-event shape is gone; code
  that resurrects it fails to compile.)
- **Token verification** (`authorizers/verify-token.test.ts`) — RS256 against real
  generated keys: algorithm pinning, audience/issuer, expiry.
- **DB driver guard** (`lib/db.test.ts`) — `lib/db.ts` must stay on the
  WebSocket-capable `neon-serverless` driver; `neon-http` would break `db.transaction()`.
- **Error wire format** (`lib/errors.test.ts`) — clients depend on
  `{ success:false, error, details:{ code, requestId, timestamp } }`.
- **Cron registry parity** (`cron.test.ts`) — every wrangler.toml `[triggers]`
  expression has a registered handler and vice versa.
- **Yoga limits** (`graphql/yoga.test.ts`) — depth/complexity/mutation limits and
  Apollo-parity error masking.
- **Validation, sanitization, pagination, audit redaction** — the security-relevant
  pure functions.

Unit tests mock DB/Sentry — they never hit real infrastructure. Config:
`vitest.config.ts` (path alias `@/*` → `src/node/*`).

---

## 🗄️ Database Transaction Tests (Vitest + real Postgres)

These run our actual service code against a **real Postgres engine** to prove that
multi-step writes COMMIT atomically and ROLL BACK fully on error — behaviour the unit
suite cannot verify because it mocks `db.transaction` as a pass-through.

**File**: `tests/integration/db-transactions.test.ts`
**Config**: `vitest.integration.config.ts` (separate from the unit suite, so
`pnpm check` stays DB-free).

### Run it

```bash
pnpm test:integration:local      # starts docker `postgres-test` (--wait) + runs the suite

# …or manually:
pnpm test:integration:up
pnpm test:integration

# …or point at any Postgres
TEST_DATABASE_URL="postgres://user:pass@host:5432/db" pnpm test:integration
```

The harness (`tests/integration/helpers/test-db.ts`) connects, ensures the `citext`
extension exists, and applies the project migrations before the tests run.

### What it proves

- ✅ `createUserWithIdentity` commits user + profile + identity together
- ✅ A throw mid-transaction rolls back **all** rows (no partial writes)
- ✅ A unique-constraint violation late in the transaction rolls back the earlier
  inserts (no orphaned user/profile)

> **Driver note:** these tests use the `node-postgres` driver for a hermetic local DB.
> Production uses `neon-serverless`; that wiring is guarded separately by
> `tests/unit/lib/db.test.ts`. Drizzle's transaction API and the underlying SQL are
> identical across both drivers, so the atomicity proven here matches production.

---

## 🔄 Live-API Tests (Bash)

The shell suites hit a running server — your local Worker by default
(`http://localhost:8787`), or a deployed environment.

```bash
# Run all (needs a JWT)
./tests/integration/test-all.sh "YOUR_JWT_TOKEN"

# Individual suites
./tests/integration/test-handlers.sh "JWT"       # REST endpoints
./tests/integration/test-graphql.sh "JWT"        # GraphQL queries/mutations
./tests/integration/test-health-checks.sh        # health (no auth)
./tests/integration/test-middleware.sh           # /v1/test/* diagnostics (no auth)
./tests/integration/test-api-auth.sh "JWT"       # auth flow
```

Deployed targets resolve their URL via `scripts/lib/env-helper.sh`: set
`API_BASE_URL_<STAGE>` (full URL) — or `PROJECT_NAME` + `CF_ACCOUNT_SUBDOMAIN`, which
build the default `https://<project>-<stage>.<subdomain>.workers.dev` — in
`.env.<stage>`:

```bash
./tests/integration/test-api.sh staging          # uses API_BASE_URL_STAGING / workers.dev default
./tests/integration/test-api.sh production       # uses API_BASE_URL_PRODUCTION / workers.dev default
```

Set `CORS_TEST_ORIGIN` to an origin allowed by the target Worker when you want
`test-api.sh` to exercise the CORS preflight path:

```bash
CORS_TEST_ORIGIN=https://app.example.com ./tests/integration/test-api.sh staging
```

For a low-cost deployed load smoke, use the built-in rate-limited TypeScript
runner:

```bash
pnpm load:smoke staging
LOAD_RPS=25 LOAD_DURATION_SECONDS=60 pnpm load:smoke production
```

It exercises `/v1/health`, `/v1/health/detailed`, missing-bearer REST auth,
missing-bearer GraphQL, and missing-signature WorkOS webhook rejection. It fails
when the error rate exceeds `LOAD_MAX_ERROR_RATE` (default 1%) or p95 exceeds
`LOAD_MAX_P95_MS` (default 3000ms).

> `test-middleware.sh` exercises `/v1/test/api-key` and `/v1/test/webhook`
> (`src/node/routes/test.ts`) — they require `TEST_API_KEY` / `WEBHOOK_SECRET` in
> `.dev.vars` and intentionally 404 when `STAGE=production`.

---

## 🧪 Local Testing

### Prerequisites
- Local Worker running: `pnpm dev` → `http://localhost:8787`
- Valid WorkOS JWT token (for authenticated endpoints)
- `DATABASE_URL` set in `.dev.vars` (for DB-touching endpoints)

### Get a JWT Token

**Option A: From WorkOS Dashboard** — your application → Test Users → generate a token.

**Option B: From Your Frontend** — log in, open DevTools → Network, copy the
`Authorization` header value from any API request.

### Smoke sequence

```bash
pnpm dev
curl http://localhost:8787/v1/health | jq .             # 200, security headers
curl http://localhost:8787/v1/health/detailed | jq .    # real DB round-trip
./tests/integration/test-handlers.sh "YOUR_JWT"
```

### Cron jobs

```bash
npx wrangler dev --local --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+4+*+*+*"   # janitor
curl "http://localhost:8787/__scheduled?cron=0+5+*+*+*"   # audit retention
```

---

## 🚀 Testing a Deployment

```bash
pnpm deploy:staging                          # seconds, not minutes
curl https://api-staging.yourdomain.com/v1/health | jq .
./tests/integration/test-api.sh staging

# authenticated spot-checks
curl -H "Authorization: Bearer YOUR_STAGING_TOKEN" \
  https://api-staging.yourdomain.com/v1/users/me | jq .
```

Same for production (`pnpm deploy:production`, `./tests/integration/test-api.sh production`)
— **only after staging passes.** Roll back with `npx wrangler rollback --env <stage>`.

### Expected results
```
✅ Health check returns 200
✅ CORS + security headers present
✅ Protected endpoints return 401 without auth, 200 with a valid token
✅ Unknown paths return the formatted 404
✅ /v1/test/* returns 404 in production
```

---

## 🔍 Troubleshooting

**"Connection refused" locally** — `pnpm dev` isn't running (or a stale `workerd`
holds the port; kill it or pass `--port`).

**401 Unauthorized** — JWT expired/invalid, or `WORKOS_CLIENT_ID` in `.dev.vars`
doesn't match the token's audience.

**503 on media endpoints** — R2 S3-API credentials not configured
(`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`); see
[CLOUDFLARE_SETUP.md](../CLOUDFLARE_SETUP.md) §7c.

**"Database connection failed"** — check `DATABASE_URL` in `.dev.vars` (read by both
the Worker and migrate/drizzle-kit); for integration tests, is `postgres-test` up?

**CORS errors in browser** — origin not in `CORS_*` vars (`wrangler.toml [vars]`);
logic in `src/node/lib/cors.ts`.

**Deployed 500s** — `npx wrangler tail --env <stage>` streams live Worker logs;
Workers Logs are also in the Cloudflare dashboard. Check Sentry if `SENTRY_DSN` is set.

---

## 🔄 Workflow Integration

```bash
# Before committing
pnpm check

# Full local gate (matches what CI should run — no CI pipeline exists yet, see
# Migration Plan Phase 2)
pnpm check && pnpm test:integration:local

# Before deploying
pnpm check && pnpm deploy:staging
```

---

## 🎯 Best Practices

1. **Run unit tests during development** — watch mode (`pnpm test`)
2. **Always run before committing** — `pnpm check`
3. **Keep tests fast** — the unit suite runs in well under a second
4. **Write tests for bug fixes** — prevent regressions
5. **Test critical paths** — auth, validation, error handling, transactions
6. **Always test locally first** — the local Worker IS the production code path
7. **Test staging before production** — never skip staging
8. **Keep JWT tokens secure** — don't commit them
9. **Use `wrangler tail`** when deployed tests fail
10. **Use `jq` for pretty JSON output** in terminal

---

## 🚀 Future Test Additions

- **Workers-runtime tests** — run the suites under `@cloudflare/vitest-pool-workers` /
  miniflare to catch `nodejs_compat` edge cases in CI
- **E2E media flow** — auth → presign → upload to R2 → list → verify
- **Auth identity mapping** — `getUserIdFromClaims` JIT provisioning against a real DB
