# Cloudflare Setup — Zero to Running

The entire backend is **one Cloudflare Worker** (`src/node/worker.ts` → the single Hono
app in `src/node/app.ts`). Local development runs the same Worker under
`wrangler dev --local` — no Cloudflare account needed until you deploy.

---

## 1. Prerequisites

- **Node.js 24** and **pnpm**
- **Docker** — only for the real-Postgres integration tests (`postgres-test` service)
- **A Neon Postgres database** (or any Postgres reachable by URL) for `DATABASE_URL`
- **A WorkOS application** for `WORKOS_CLIENT_ID` (JWT auth)
- **A Cloudflare account** — only for `wrangler deploy` / remote secrets; never for local dev

## 2. Install

```bash
pnpm install
```

## 3. Configure local secrets — `.dev.vars`

```bash
cp .dev.vars.example .dev.vars
# fill in real values (file is gitignored — never commit it)
```

`.dev.vars.example` is the **single checked-in registry of every secret the Worker
reads** — `scripts/sync-secrets.ts` also uses it as the list of names to push to
deployed environments. Required to boot meaningfully: `DATABASE_URL`,
`WORKOS_CLIENT_ID`. Everything else is feature-dependent (see comments in the file).

Non-secret config (STAGE, CORS lists, `IMAGES_BUCKET`, …) lives in `wrangler.toml`
`[vars]` — edit the `PLACEHOLDER` values there for your project.

`pnpm migrate`, `pnpm db:generate`, and `pnpm db:introspect` read `DATABASE_URL`
from **`.dev.vars`** via dotenv (`scripts/migrate.ts` and `drizzle.config.ts` both
load `.dev.vars`; the package scripts use `dotenv -e .dev.vars`). No separate file
is needed for local DB tooling.

## 4. Migrate the database

```bash
pnpm migrate        # tsx scripts/migrate.ts — applies src/node/db/migrations/ via drizzle
```

Schema change workflow: edit `src/node/db/schema/`, then `pnpm db:generate` (creates a
new SQL migration), then `pnpm migrate`. Migrations must stay expand/contract-safe
(see AGENTS.md invariant).

## 5. Run locally

```bash
pnpm dev            # wrangler dev --local → http://localhost:8787
```

- No Cloudflare account or login required: `--local` runs everything in workerd on
  your machine; the R2 binding is simulated on disk under `.wrangler/state`.
- Smoke check: `curl http://localhost:8787/v1/health` (and `/v1/health/detailed`
  for a real DB round-trip).
- GraphQL (GraphQL Yoga) is at `POST http://localhost:8787/v1/graphql` (auth required).
- Cron triggers: run `npx wrangler dev --local --test-scheduled`, then
  `curl "http://localhost:8787/__scheduled?cron=0+4+*+*+*"` (janitor) or
  `cron=0+5+*+*+*` (audit retention).

## 6. Test

```bash
pnpm check                    # lint + typecheck + unit tests (no DB needed)
pnpm test                     # unit tests, watch mode
pnpm test:integration:local   # starts docker postgres-test, runs real-DB transaction tests
pnpm load:smoke staging       # light deployed-environment load smoke
```

Shell-based API tests run against a live server (local `pnpm dev` by default,
port 8787): see `tests/integration/*.sh` and [guides/TESTING.md](./guides/TESTING.md).

## 7. Deploy (Cloudflare account required from here on)

```bash
npx wrangler login            # once per machine
```

### Branch model

GitHub Actions maps branches to environments:

| Branch / trigger | Action |
|---|---|
| Pull request into `staging` or `main` | CI gate only |
| Push/merge to `staging` | CI gate, then `pnpm deploy:staging` |
| Push/merge to `main` | CI gate, then `pnpm deploy:production` |
| Manual workflow dispatch | Choose `staging` or `production` |

Configure GitHub Environments named `staging` and `production`. Production should
require manual approval in GitHub settings before deployment proceeds.

### 7a. Push secrets

Create `.env.staging` / `.env.production` (gitignored) with values for the secret
names listed in `.dev.vars.example`, then:

```bash
pnpm sync-secrets staging     # pipes each value to `wrangler secret put <NAME> --env staging`
pnpm sync-secrets production
npx wrangler secret list --env staging    # verify
```

Values travel over stdin only — never argv or logs.

### 7b. Deploy the Worker

```bash
pnpm deploy:staging           # health-gated canary + auto-rollback (scripts/deploy.ts)
pnpm deploy:production        # same, against production
npx wrangler deploy --dry-run --env staging   # build-only sanity check, no account writes
```

**Automated canary + auto-rollback** is wired into `pnpm deploy:<stage>`
(`scripts/deploy.ts`), replacing the old AWS CodeDeploy blue-green machinery. Each
deploy:

1. records the currently-active Worker version (the rollback target),
2. uploads the new version at 0% traffic (`wrangler versions upload`),
3. routes `CANARY_PERCENT` (default 10%) of traffic to it, soaks `SOAK_SECONDS`
   (default 20s), and probes `/v1/health/detailed`,
4. promotes to 100% and probes health again,
5. runs post-deploy smoke checks: missing-bearer auth rejection, GraphQL auth
   rejection, missing-signature webhook rejection, and optional CORS preflight,
6. on **any** health or smoke failure, redeploys the recorded version at 100% and exits 1.

First deploy (no prior version) skips the canary and goes straight to 100%. Tunable
via `HEALTH_URL`, `SMOKE_CORS_ORIGIN_STAGING` / `SMOKE_CORS_ORIGIN_PRODUCTION`
(`SMOKE_CORS_ORIGIN` fallback), `CHECK_PENDING_MIGRATIONS`, `CANARY_PERCENT`,
`SOAK_SECONDS`, `HEALTH_ATTEMPTS`.

`CHECK_PENDING_MIGRATIONS=true` runs `pnpm migrations:check` before any Worker
version is uploaded. It intentionally fails deploys when the target DB has pending
migrations instead of auto-running migrations inside deploy; schema changes remain a
manual expand/contract step so Worker rollback stays meaningful. This preflight needs
`DATABASE_URL` available in the GitHub environment or local shell. The check requires
every migration in the current repo journal to be present in the target DB; older
applied migration rows from a reused database do not fail it.

The health-check URL is derived from the Worker `name` + `WORKERS_SUBDOMAIN` (your
`*.workers.dev` subdomain) as `https://<name>-<stage>.<WORKERS_SUBDOMAIN>.workers.dev`,
unless `HEALTH_URL` overrides it (use that for custom domains). Set `WORKERS_SUBDOMAIN`
in your shell for local deploys; in CI it's a GitHub repo variable
(`vars.WORKERS_SUBDOMAIN`). See `docs/ENVIRONMENT_VARIABLES.md`.

Plain, non-gated deploys: `pnpm deploy:staging:simple` / `:production:simple`
(`wrangler deploy --env <stage>`) — also the one-time path for registering new Queue
consumers. Manual rollback: `npx wrangler rollback --env <stage>` (Workers keeps prior
versions).

### 7c. R2 (media storage) — setup placeholder

Media routes need both the R2 bucket binding **and** S3-API credentials
(`lib/media.ts` presigns via `aws4fetch` against R2's S3-compatible endpoint).
Until configured, media endpoints return a clear 503 `MEDIA_STORAGE_NOT_CONFIGURED`.

1. `npx wrangler r2 bucket create <name>` per environment; make the name match
   `[[env.<stage>.r2_buckets]].bucket_name` and `IMAGES_BUCKET` in `wrangler.toml`.
2. Create an R2 API token (Cloudflare dashboard → R2 → Manage API Tokens) and push
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` as secrets
   (they are in `.dev.vars.example`, so `pnpm sync-secrets` covers them).
3. Set `IMAGES_CDN_URL` in `wrangler.toml` to the bucket's public/custom-domain URL.

### 7d. Hyperdrive (DB pooling) — setup placeholder

Not configured yet. The Worker currently talks to Neon directly via
`@neondatabase/serverless` (per-request connections, as Workers requires). When
connection latency or pooling becomes a measured problem, add a `[[hyperdrive]]`
binding in `wrangler.toml` and point `lib/db.ts` at it — see the North Star's
target stack table.

### 7e. Rate limiting — no setup needed

The per-IP rate limiter (`lib/hono/rate-limit.ts`) uses the Cloudflare Workers Rate
Limiting binding `RATE_LIMITER`, declared as `[[ratelimits]]` (and per-env
`[[env.staging.ratelimits]]` / `[[env.production.ratelimits]]`) in `wrangler.toml`
with `simple = { limit = 100, period = 60 }`. It needs **no dashboard resource** —
it's configured entirely in `wrangler.toml`. The binding is absent under `wrangler dev`,
so the limiter no-ops locally.

## 8. API docs (optional)

```bash
pnpm docs:generate   # swagger-jsdoc over src/node/routes/**/*.ts → docs/api/openapi.json
pnpm docs:serve      # serves docs/api on a local Express server
```

`docs:generate` (`scripts/generate-openapi.js`) scans the Hono route JSDoc and
stamps server URLs into the spec. Optional env overrides: `PROJECT_NAME` (spec
title) and `API_BASE_URL_LOCAL` / `API_BASE_URL_STAGING` / `API_BASE_URL_PRODUCTION`
(server URLs). Without `PROJECT_NAME`, the spec title falls back to `package.json`
so cloned boilerplates do not keep the source project's name.

## 9. New project from this boilerplate

```bash
pnpm init-project <project-name> <domain> [--force]
```

Generates the `.env.*` files, sets the package name, and rewrites `wrangler.toml`
resource names: Worker name, `PROJECT_NAME`, CORS exact origins, R2 bucket names,
image CDN placeholders, and webhook queue/DLQ names. Then create the named R2
buckets/queues and replace `IMAGES_CDN_URL` with the real R2 public or custom-domain
URL for each environment.

---

## Where things live

| Concern | Location |
|---|---|
| Worker entry (`fetch` + `scheduled`) | `src/node/worker.ts` |
| The Hono app (middleware + error shape) | `src/node/app.ts` |
| Routes (one module per domain) | `src/node/routes/*.ts`, barrel in `routes/index.ts` |
| Auth middleware (WorkOS JWT) | `src/node/lib/hono/auth.ts` → `authorizers/verify-token.ts` |
| Cron jobs (janitor, audit retention) | `src/node/cron.ts` + `wrangler.toml [triggers]` |
| Config (non-secret) | `wrangler.toml [vars]` per environment |
| Secrets | `.dev.vars` locally; `wrangler secret` deployed |
| DB schema + migrations | `src/node/db/` |

## Troubleshooting

- **`Missing entry-point` / wrong routes** — you're not at the repo root; wrangler
  reads `wrangler.toml` from cwd.
- **401 on every protected route** — `WORKOS_CLIENT_ID` missing/wrong in `.dev.vars`,
  or the JWT is for a different WorkOS client.
- **`/v1/health/detailed` fails** — `DATABASE_URL` in `.dev.vars` is wrong or the
  database is unreachable.
- **Media routes return 503** — R2 credentials not set; see 7c.
- **`/v1/test/*` returns 404** — by design when `STAGE=production`; these are
  dev/staging-only diagnostics (`src/node/routes/test.ts`).
- **Port already in use** — a stale `workerd` process from a previous `wrangler dev`;
  kill it or pass `--port`.
