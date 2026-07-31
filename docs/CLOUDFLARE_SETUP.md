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
deployed environments. Required for ordinary local auth/database work:
`DATABASE_URL` and `WORKOS_CLIENT_ID`. Deployed detailed health additionally
requires `WORKOS_WEBHOOK_SECRET`; other entries are feature-dependent.

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
- Cron trigger: run `npx wrangler dev --local --test-scheduled`, then
  `curl "http://localhost:8787/__scheduled?cron=0+4+*+*+*"` — the one daily
  trigger runs both maintenance jobs (janitor + audit-retention).

## 6. Test

```bash
pnpm check                    # lint + typecheck + unit tests (no DB needed)
pnpm test                     # unit tests, watch mode
pnpm test:integration:local   # starts docker postgres-test, runs the full real-DB suite
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
(`scripts/deploy.ts`). Each deploy:

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

The health-check URL priority is: `HEALTH_URL`, then the stage custom-domain
route in `wrangler.toml`, then Worker `name` + `WORKERS_SUBDOMAIN` as
`https://<name>-<stage>.<WORKERS_SUBDOMAIN>.workers.dev`. Set
`WORKERS_SUBDOMAIN` only when neither of the first two is available. In CI it
is a GitHub repo variable (`vars.WORKERS_SUBDOMAIN`). See
`docs/ENVIRONMENT_VARIABLES.md`.

Plain, non-gated deploys: `pnpm deploy:staging:simple` / `:production:simple`
(`wrangler deploy --env <stage>`) — also the one-time path for registering new Queue
consumers. Manual rollback: `npx wrangler rollback --env <stage>` (Workers keeps prior
versions).

### 7c. Provision resources — `pnpm bootstrap <stage>`

One command creates the Cloudflare resources a stage needs before its first
deploy, reading the exact names from `wrangler.toml`:

```bash
pnpm bootstrap staging --dry-run   # preview every command, run nothing
pnpm bootstrap staging             # create queues + DLQ + R2 bucket (idempotent)
pnpm bootstrap staging --neon <project-id>   # also create a Neon branch → writes DATABASE_URL
pnpm bootstrap staging --deploy    # then chain sync-secrets → migrate → deploy
```

With `--deploy`, migration runs only when `.env.<stage>` contains
`DATABASE_URL`; otherwise the script warns, skips migration, and continues to
deploy. Prefer supplying the stage URL (or `--neon`) so this one-shot path does
not leave schema state implicit.

It creates the webhook queue + its dead-letter queue (**deploy fails without
them**) and the R2 images bucket; re-runs are safe (an "already exists" is
treated as success). Prereqs: `npx wrangler login` (or
`CLOUDFLARE_API_TOKEN`), and
for `--neon`, `neonctl` installed + authenticated.

Two things `bootstrap` deliberately leaves manual (it prints them at the end):

1. **R2 S3 API token** — mint it in the Cloudflare dashboard (R2 → Manage API
   Tokens; credential-minting is left manual on purpose), then put
   `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in `.env.<stage>`
   (registered in `.dev.vars.example`, so `pnpm sync-secrets` pushes them). Set
   `IMAGES_CDN_URL` in `wrangler.toml` to the bucket's public/custom-domain URL.
2. **WorkOS** app + webhook endpoint/secret, and **DNS** (§7e).

Presigning/listing and the direct-upload fallback return a clear 503
`MEDIA_STORAGE_NOT_CONFIGURED` until the R2 S3 API credentials are set. Direct
upload still works through the `IMAGES_BUCKET` binding. Queue operations (DLQ
drain, retries): `docs/runbooks/WEBHOOK_DLQ.md`.

### 7d. Rate limiting — no setup needed

The per-IP rate limiter (`lib/hono/rate-limit.ts`) uses the Cloudflare Workers Rate
Limiting binding `RATE_LIMITER`, declared as `[[ratelimits]]` (and per-env
`[[env.staging.ratelimits]]` / `[[env.production.ratelimits]]`) in `wrangler.toml`
with `simple = { limit = 100, period = 60 }`. It needs **no dashboard resource** —
it's configured entirely in `wrangler.toml`. Wrangler simulates the binding
locally. Direct unit/app harnesses may omit it and no-op only under an explicit
local/development stage. A missing binding in staging or production fails
closed with `503 RATE_LIMITER_UNAVAILABLE`.

### 7e. Custom domain (serve the API on your own hostname)

By default the Worker answers on `*.workers.dev`. To serve the API on a real
hostname, wire the Cloudflare Workers **Custom Domain** routes into
`wrangler.toml` for both deployed envs:

```bash
pnpm set-domain acme.dev            # → api.acme.dev / api-staging.acme.dev
pnpm set-domain acme.dev gateway    # → gateway.acme.dev / gateway-staging.acme.dev
```

This is idempotent — re-run it to change the domain. It writes a
`[[env.<stage>.routes]]` block (`custom_domain = true`) that binds on the next
`pnpm deploy:<stage>`. `scripts/deploy.ts` then probes the custom domain for its
health check automatically (override with `HEALTH_URL`).

**Manual step (not automated — usually a different DNS provider):** Custom
Domains require the zone to be **on Cloudflare**. Add `acme.dev` as a zone in
Cloudflare and point your registrar's nameservers (or use Cloudflare's
partial/CNAME setup) at it. Once the zone is on Cloudflare, wrangler manages the
in-zone DNS record for the hostnames above. Run `set-domain` when you're ready to
wire the domain — once these routes exist, `wrangler deploy` expects the zone to
be reachable on Cloudflare.

Convention: the API lives on `api.<domain>` (prod) / `api-staging.<domain>`
(staging), distinct from the frontend origin (`<domain>` / `staging.<domain>`)
in `CORS_EXACT_ORIGINS`. A BFF/frontend proxies to the API host.

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

For the full walkthrough (scaffold → local → staging → production → domain),
see **[guides/LAUNCH_NEW_PROJECT.md](./guides/LAUNCH_NEW_PROJECT.md)**. In short:

```bash
pnpm init-project <project-name> <domain> [--force]   # scaffold names/envs/domains
pnpm bootstrap <stage>                                # create queues + R2 bucket
pnpm sync-secrets <stage> && pnpm deploy:<stage>      # push secrets + canary deploy
```

`init-project` sets the package name and rewrites `wrangler.toml` (Worker name,
`PROJECT_NAME`, CORS origins, R2 bucket + webhook queue/DLQ names, image CDN URLs,
and the API custom-domain routes), and writes the `.env.*` secret templates.
`bootstrap` then creates the named queues/buckets; replace `IMAGES_CDN_URL` with
the real R2 public/custom-domain URL per environment.

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
- **Media presign/list routes return 503** — R2 S3 API credentials are not set;
  direct upload can still use the `IMAGES_BUCKET` binding. See 7c.
- **`/v1/test/*` returns 404** — by design when `STAGE=production`; these are
  dev/staging-only diagnostics (`src/node/routes/test.ts`).
- **Port already in use** — a stale `workerd` process from a previous `wrangler dev`;
  kill it or pass `--port`.
