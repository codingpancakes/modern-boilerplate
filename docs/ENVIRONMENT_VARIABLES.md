# Environment Variables Reference

How configuration and secrets reach the Worker, and which files hold what.

Worker runtime string settings have two categories:

1. **Non-secret config** → `wrangler.toml [vars]` (committed; per-environment blocks)
2. **Secrets** → `.dev.vars` locally / `wrangler secret put` deployed (never committed)

With `nodejs_compat` and the 2025+ `compatibility_date`, the Workers runtime
populates `process.env` from both. Non-string platform bindings such as R2,
Queues, and Rate Limiting are a separate category: they arrive on `c.env`
(typed by `WorkerBindings` in `src/node/worker.ts`). Deploy-tool credentials
and overrides exist only in the shell/CI process and are never Worker runtime
configuration.

---

## Files

| File | Committed | Used by | Purpose |
|---|---|---|---|
| `wrangler.toml` | ✅ | `wrangler dev` / `wrangler deploy` | Non-secret config (`[vars]`), R2 bindings, cron triggers, per-env blocks |
| `.dev.vars.example` | ✅ | humans + `scripts/sync-secrets.ts` | **The registry of every secret name the Worker reads** |
| `.dev.vars` | ❌ gitignored | `wrangler dev --local`, `pnpm migrate`, `pnpm db:generate`, `pnpm db:introspect` | Local secret values (copy from `.dev.vars.example`); also the `DATABASE_URL` source for local DB tooling (read via dotenv, not wrangler) |
| `.env.staging` / `.env.production` | ❌ gitignored | `pnpm sync-secrets <stage>` | Secret values to push per stage |

> `pnpm init-project <name> <domain>` generates the `.env.*` files.
> Local DB tooling (`pnpm migrate`, `db:generate`, `db:introspect`) reads
> `DATABASE_URL` straight from `.dev.vars` — no separate `.env.local` is used.

---

## Non-secret config — `wrangler.toml [vars]`

Defined once at top level (used by `wrangler dev --local`) and **repeated in full**
under `[env.staging.vars]` / `[env.production.vars]` (named environments do not
inherit `[vars]` or R2 bindings).

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Runtime mode hint (`development` / `staging` / `production`). Core deploy-sensitive behavior is keyed on `STAGE`, not this value |
| `STAGE` | Deployment stage (`local` / `staging` / `production`). Gates error masking, dev CORS/GraphiQL/diagnostics, auth binding requirements, and missing-binding fail-closed behavior |
| `PROJECT_NAME` | Runtime project label kept aligned by `init-project`; resource names are rewritten by that script rather than derived dynamically at runtime |
| `API_VERSION` | Version label returned by health responses. Route mounts are currently explicit `/v1` paths and do not read this variable |
| `SENTRY_ENVIRONMENT` | Sentry environment tag (staging/production blocks only) |
| `CORS_DOMAIN_PATTERNS` | Legacy comma-separated wildcard/parent domains such as `*.example.com`; implementation uses hostname suffix matching, **not regex** |
| `CORS_EXACT_ORIGINS` | Exact allowed origins (comma-separated) |
| `CORS_PARENT_DOMAINS` | Parent domains whose subdomains are allowed |
| `IMAGES_BUCKET` | R2 bucket name — must match the `[[r2_buckets]]` binding's `bucket_name` |
| `IMAGES_CDN_URL` | Public/custom-domain URL of the R2 bucket |

## Bindings — `wrangler.toml`

| Binding | Declared as | Purpose |
|---|---|---|
| `IMAGES` | `[[r2_buckets]]` | R2 images bucket, available as `c.env.IMAGES`. Simulated on disk under `.wrangler/state` in local dev |
| `RATE_LIMITER` | `[[ratelimits]]` (+ per-env) | Cloudflare Workers Rate Limiting binding for the per-IP limiter (`lib/hono/rate-limit.ts`), available as `c.env.RATE_LIMITER`. **No dashboard resource** — configured entirely in `wrangler.toml` (`simple = { limit = 100, period = 60 }`). Wrangler simulates it locally. A direct test harness may omit it; staging/production fail closed with 503 |
| `WEBHOOK_QUEUE` | `[[queues.producers]]` (+ per-env `[[queues.consumers]]`) | Cloudflare Queues producer for verified WorkOS webhook events (`routes/webhooks.ts` enqueues; `src/node/queue.ts` consumes; `*-dlq-*` receives exhausted retries). Wrangler simulates it locally. An unbound direct test harness processes inline; staging/production fail closed with 503. Queues must exist before first deploy — see `docs/runbooks/WEBHOOK_DLQ.md` |

Add a property to `WorkerBindings` in `src/node/worker.ts` whenever you add a binding.

---

## Secrets — registry in `.dev.vars.example`

Every uncommented `KEY` in `.dev.vars.example` is a secret the Worker may read, and is
exactly what `pnpm sync-secrets <stage>` pushes. Current registry:

### Required
| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `WORKOS_CLIENT_ID` | WorkOS client id — binds accepted tokens by their `client_id` claim (`authorizers/verify-token.ts`; these tokens do not use `aud`). An empty value disables that application binding for local development only; auth **fails closed** unless `STAGE` is exactly `local` or `development` (`lib/hono/auth.ts` refuses to verify unbound) |
| `WORKOS_WEBHOOK_SECRET` | WorkOS signature verification. It may be empty for local work that never calls the webhook, but deployed detailed health treats it as required |

### Feature-dependent
| Secret | Purpose |
|---|---|
| `SENTRY_DSN` | Sentry error reporting (empty = disabled) |
| `TEST_API_KEY` | Constant-time-compared key for `GET /v1/test/api-key` (dev/staging only) |
| `WEBHOOK_SECRET` | HMAC secret for `POST /v1/test/webhook` (dev/staging only) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 S3-API credentials for presigning/listing (`lib/media.ts`). Unset → those operations and the direct-upload fallback return 503 `MEDIA_STORAGE_NOT_CONFIGURED`; direct upload still works when the `IMAGES_BUCKET` binding is available |

### Optional overrides (commented out in the registry — not synced)
| Variable | Purpose |
|---|---|
| `AUTH_ISSUER` | JWT issuer override; defaults to `https://api.workos.com/` |
| `LOG_LEVEL` | `DEBUG` / `INFO` / `WARN` / `ERROR` for `lib/logger.ts` (default `INFO`) |
| `R2_BUCKET` | Override; falls back to `IMAGES_BUCKET` |

---

## Syncing secrets to Cloudflare

```bash
# 1. Put values in .env.staging / .env.production (gitignored)
# 2. Push (names from .dev.vars.example, values from .env.<stage>):
pnpm sync-secrets staging
pnpm sync-secrets production

# 3. Verify
npx wrangler secret list --env staging
```

Values are piped to `wrangler secret put` over **stdin** — they never appear in argv,
`ps` output, or logs. Keys with no value in `.env.<stage>` are skipped (reported).

---

## Deploy-script environment (`scripts/deploy.ts`)

These are read from the **process environment at deploy time** — not Worker `[vars]`,
not secrets. In CI they are GitHub repo variables/secrets; locally you `export` them.

| Variable | Purpose |
|---|---|
| `WORKERS_SUBDOMAIN` | Your `*.workers.dev` subdomain. Used to derive `https://<worker-name>-<stage>.<WORKERS_SUBDOMAIN>.workers.dev` only when neither `HEALTH_URL` nor a stage custom-domain route is available. In CI it is a GitHub repo variable (`vars.WORKERS_SUBDOMAIN`) |
| `HEALTH_URL` | Explicit base-URL override. It takes precedence over a custom-domain route detected in `wrangler.toml` and the `WORKERS_SUBDOMAIN` fallback |
| `SMOKE_CORS_ORIGIN_STAGING` / `SMOKE_CORS_ORIGIN_PRODUCTION` | Stage-specific origins to verify during the deploy smoke-test CORS preflight. Use an origin present in that stage's `CORS_EXACT_ORIGINS` / parent-domain / pattern config |
| `SMOKE_CORS_ORIGIN` | Generic CORS smoke origin fallback when the stage-specific variable is unset |
| `CHECK_PENDING_MIGRATIONS` | Set to `true` to run `pnpm migrations:check` as a blocking deploy preflight. Requires `DATABASE_URL` in the deploy environment |
| `CANARY_PERCENT` | Canary traffic share before promotion (default 10) |
| `SOAK_SECONDS` | Canary soak duration before probing health (default 20) |
| `HEALTH_ATTEMPTS` | Health-probe retry count |

## Test/load tooling environment

These variables are consumed by scripts, not injected into the Worker:

| Variable | Purpose |
|---|---|
| `API_BASE_URL_STAGING` / `API_BASE_URL_PRODUCTION` | Explicit deployed base URL for live shell tests and load smoke |
| `API_URL` | Generic live shell-test URL fallback |
| `CORS_TEST_ORIGIN` | Origin used by live CORS checks; also a deploy-smoke fallback |
| `LOAD_TEST_URL` | Explicit `load:smoke` target |
| `LOAD_DURATION_SECONDS`, `LOAD_RPS`, `LOAD_CONCURRENCY`, `LOAD_TIMEOUT_MS` | Load-smoke shape and timeout |
| `LOAD_MAX_ERROR_RATE`, `LOAD_MAX_P95_MS` | Load-smoke pass/fail thresholds |

When no explicit live-test URL is set, `scripts/lib/env-helper.sh` reads the
Worker `name` from `wrangler.toml` and combines it with
`WORKERS_SUBDOMAIN`.

---

## Adding a new variable

- **Secret?** Add it (uncommented, with a comment) to `.dev.vars.example`, set the real
  value in `.dev.vars` and `.env.<stage>`, run `pnpm sync-secrets <stage>`.
- **Non-secret config?** Add it to `wrangler.toml` under top-level `[vars]` **and** both
  `[env.*.vars]` blocks (no inheritance).
- **Binding (R2 etc.)?** Add to `wrangler.toml` (all three scopes) and type it in
  `WorkerBindings` (`src/node/worker.ts`).
