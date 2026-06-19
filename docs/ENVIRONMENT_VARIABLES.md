# Environment Variables Reference

How configuration and secrets reach the Worker, and which files hold what.

There are exactly **two kinds of values**:

1. **Non-secret config** → `wrangler.toml [vars]` (committed; per-environment blocks)
2. **Secrets** → `.dev.vars` locally / `wrangler secret put` deployed (never committed)

With `nodejs_compat` and the 2025+ `compatibility_date`, the Workers runtime populates
`process.env` from both, so application code reads `process.env.X` everywhere.
Workers **bindings** (R2 buckets) are not strings — they arrive on `c.env`
(typed by `WorkerBindings` in `src/node/worker.ts`).

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
| `NODE_ENV` | `development` / `staging` / `production`. Gates 5xx error masking (`lib/errors.ts`) and dev CORS origins (`lib/cors.ts`) |
| `STAGE` | Deployment stage (`local` / `staging` / `production`). `production` disables the dev-only `/v1/test/*` routes |
| `PROJECT_NAME` | Project identifier (drives naming, docs) |
| `API_VERSION` | URL version prefix (`v1`) |
| `SENTRY_ENVIRONMENT` | Sentry environment tag (staging/production blocks only) |
| `CORS_DOMAIN_PATTERNS` | Regex patterns for allowed origins (comma-separated) |
| `CORS_EXACT_ORIGINS` | Exact allowed origins (comma-separated) |
| `CORS_PARENT_DOMAINS` | Parent domains whose subdomains are allowed |
| `IMAGES_BUCKET` | R2 bucket name — must match the `[[r2_buckets]]` binding's `bucket_name` |
| `IMAGES_CDN_URL` | Public/custom-domain URL of the R2 bucket (was CloudFront) |

## Bindings — `wrangler.toml`

| Binding | Declared as | Purpose |
|---|---|---|
| `IMAGES` | `[[r2_buckets]]` | R2 images bucket, available as `c.env.IMAGES`. Simulated on disk under `.wrangler/state` in local dev |
| `RATE_LIMITER` | `[[ratelimits]]` (+ per-env) | Cloudflare Workers Rate Limiting binding for the per-IP limiter (`lib/hono/rate-limit.ts`), available as `c.env.RATE_LIMITER`. **No dashboard resource** — configured entirely in `wrangler.toml` (`simple = { limit = 100, period = 60 }`). Absent under `wrangler dev` → the limiter no-ops |

Add a property to `WorkerBindings` in `src/node/worker.ts` whenever you add a binding.

---

## Secrets — registry in `.dev.vars.example`

Every uncommented `KEY` in `.dev.vars.example` is a secret the Worker may read, and is
exactly what `pnpm sync-secrets <stage>` pushes. Current registry:

### Required
| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `WORKOS_CLIENT_ID` | WorkOS client id — JWT audience binding (`authorizers/verify-token.ts`). An empty value disables the `client_id` audience check (local-dev only); auth **fails closed** when it's empty and `STAGE` is `staging`/`production` (`lib/hono/auth.ts` refuses to verify unbound) |

### Feature-dependent
| Secret | Purpose |
|---|---|
| `WORKOS_WEBHOOK_SECRET` | Signature verification for `POST /v1/webhooks/workos` |
| `SENTRY_DSN` | Sentry error reporting (empty = disabled) |
| `TEST_API_KEY` | Constant-time-compared key for `GET /v1/test/api-key` (dev/staging only) |
| `WEBHOOK_SECRET` | HMAC secret for `POST /v1/test/webhook` (dev/staging only) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 S3-API credentials for presigning/listing (`lib/media.ts`). Unset → media endpoints return 503 `MEDIA_STORAGE_NOT_CONFIGURED` |

### Optional overrides (commented out in the registry — not synced)
| Variable | Purpose |
|---|---|
| `AUTH_ISSUER` | JWT issuer override; defaults to `https://api.workos.com/` |
| `LOG_LEVEL` | `DEBUG` / `INFO` / `WARN` / `ERROR` for `lib/logger.ts` (default `INFO`; `POWERTOOLS_LOG_LEVEL` honored first for parity) |
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
| `WORKERS_SUBDOMAIN` | Your `*.workers.dev` subdomain. The deploy script derives the health-check URL as `https://<worker-name>-<stage>.<WORKERS_SUBDOMAIN>.workers.dev`. In CI it's a GitHub repo variable (`vars.WORKERS_SUBDOMAIN`) |
| `HEALTH_URL` | Explicit health-check URL override (use for custom domains); takes precedence over the `WORKERS_SUBDOMAIN`-derived URL |
| `CANARY_PERCENT` | Canary traffic share before promotion (default 10) |
| `SOAK_SECONDS` | Canary soak duration before probing health (default 20) |
| `HEALTH_ATTEMPTS` | Health-probe retry count |

---

## Adding a new variable

- **Secret?** Add it (uncommented, with a comment) to `.dev.vars.example`, set the real
  value in `.dev.vars` and `.env.<stage>`, run `pnpm sync-secrets <stage>`.
- **Non-secret config?** Add it to `wrangler.toml` under top-level `[vars]` **and** both
  `[env.*.vars]` blocks (no inheritance).
- **Binding (R2 etc.)?** Add to `wrangler.toml` (all three scopes) and type it in
  `WorkerBindings` (`src/node/worker.ts`).

---

## Gone since the AWS era (do not re-add)

| Variable | Why it's gone |
|---|---|
| `ORIGIN_VERIFY_SECRET` | The Worker **is** the edge — there is no origin URL to protect |
| `WORKOS_SECRET_ARN`, `DB_SECRET_ARN`, `AWS_REGION` | Secrets Manager is gone; secrets are wrangler secrets |
| `ENABLE_WAF`, `ALERT_EMAIL`, SSM parameters | Cloudflare WAF/DDoS is account-level platform config, not deploy-time toggles |
| `HOSTED_ZONE_ID`, `HOSTED_ZONE_NAME`, `GITHUB_*` (as deploy inputs) | No CDK/CodePipeline/Route53. (`pnpm docs:generate` takes optional `PROJECT_NAME` and `API_BASE_URL_*` overrides via the environment; without `PROJECT_NAME`, the spec title uses `package.json`) |

The AWS-era version of this document is preserved in git history and the surrounding
setup in [legacy-aws/BOILERPLATE_SETUP.md](./legacy-aws/BOILERPLATE_SETUP.md).
