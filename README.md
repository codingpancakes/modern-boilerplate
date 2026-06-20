# Serverless Backend Boilerplate

Production-grade API running as **one Cloudflare Worker** — Hono + Neon Postgres +
WorkOS authentication. Built to be owned end-to-end by one person
(see [docs/direction/NORTH_STAR.md](./docs/direction/NORTH_STAR.md)).

All project naming flows from `PROJECT_NAME` — run `pnpm init-project` to spin off a
new project (see [docs/CLOUDFLARE_SETUP.md](./docs/CLOUDFLARE_SETUP.md)).

## Stack

- **Runtime:** Cloudflare Workers (`nodejs_compat`) / TypeScript 5 / pnpm
- **HTTP:** One Hono app serving REST + GraphQL (GraphQL Yoga)
- **Database:** PostgreSQL on Neon (`drizzle-orm` + `@neondatabase/serverless`)
- **Auth:** WorkOS JWT, verified in middleware (`jose`, RS256-pinned)
- **Media:** Cloudflare R2 (S3-compatible API via `aws4fetch` presigning)
- **Jobs:** Cloudflare Cron Triggers (`src/node/cron.ts`)
- **Edge:** Cloudflare WAF/DDoS/CDN (included — the Worker *is* the edge)
- **Validation:** Zod | **Linter:** Biome | **Tests:** Vitest

## Quick Start

```bash
pnpm install
cp .dev.vars.example .dev.vars       # fill in DATABASE_URL, WORKOS_CLIENT_ID, …
# migrate/drizzle-kit read DATABASE_URL from .dev.vars too (dotenv) — nothing else needed
pnpm migrate
pnpm dev                             # wrangler dev --local → http://localhost:8787
```

No Cloudflare account needed for local dev. Full guide: [docs/CLOUDFLARE_SETUP.md](./docs/CLOUDFLARE_SETUP.md).

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run the Worker locally (`wrangler dev --local`, port 8787) |
| `pnpm check` | Lint + typecheck + unit tests |
| `pnpm test:run` | Unit tests only |
| `pnpm test:integration:local` | Real-DB transaction tests (starts docker `postgres-test`) |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm typecheck` | TypeScript check |
| `pnpm migrate` | Run Drizzle migrations |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm sync-secrets <stage>` | Push secrets to Cloudflare (`wrangler secret put`) |
| `pnpm deploy:staging` | Health-gated canary + auto-rollback to staging (`scripts/deploy.ts`) |
| `pnpm deploy:production` | Health-gated canary + auto-rollback to production (`scripts/deploy.ts`) |
| `pnpm deploy:staging:simple` | Plain `wrangler deploy --env staging` (no canary) |
| `pnpm migrations:check` | Fail if the target DB has pending checked-in migrations |
| `pnpm load:smoke <stage>` | Light deployed load smoke for health/auth/webhook gates |
| `pnpm build` | TypeScript compile + generate OpenAPI docs |

## Project Structure

```
src/node/
  worker.ts              Worker entry: fetch → Hono app, scheduled → cron registry
  app.ts                 THE Hono app: request-id, rate limit, db scope, audit flush, CORS, errors
  cron.ts                Cron Trigger registry (keys = wrangler.toml [triggers] expressions)
  routes/                One Hono sub-app per domain, barrel in index.ts
    users.ts media.ts graphql.ts webhooks.ts utils.ts test.ts
  authorizers/           verify-token.ts — WorkOS JWT verifier (single source of auth trust)
  handlers/
    graphql/             Yoga context, plugins, resolvers/, schema/
    utils/               janitor.ts, audit-retention.ts (cron jobs)
  lib/                   Shared libraries
    hono/                auth (requireAuth), middleware, respond, types
    validation/          Zod schemas by domain
    services/            Business logic (user-provisioning.ts)
    cors.ts db.ts errors.ts audit.ts sanitize.ts idempotency.ts media.ts logger.ts …
  db/                    Drizzle schema (schema/) + SQL migrations (migrations/)

wrangler.toml            Worker config: vars, R2 bindings, cron triggers, staging/production envs
.dev.vars.example        Registry of every secret the Worker reads (copy to .dev.vars)
scripts/                 migrate, sync-secrets, init-project, generate-openapi
templates/               Hono route templates for new domains (see templates/README.md)
tests/                   Unit (vitest) + integration (vitest + shell scripts)
docs/                    Human docs (legacy AWS docs under docs/legacy-aws/)
```

## Architecture

```
Client → Cloudflare edge (WAF/DDoS/CDN) → Worker
           fetch     → Hono app → routes → Neon Postgres (Drizzle)
                                         → R2 (presigned URLs)
           scheduled → cron registry (janitor, audit retention)
```

- **Auth:** `requireAuth()` Hono middleware verifies the WorkOS JWT (RS256, JWKS,
  `client_id` audience binding) and puts claims on `c.get("claims")`. No gateway,
  no separate authorizer.
- **REST:** route modules under `src/node/routes/`; app-level middleware handles
  request IDs, per-IP rate limiting (`RATE_LIMITER` binding), per-request DB lifecycle,
  audit flushing, CORS + security headers, and error formatting.
- **GraphQL:** GraphQL Yoga at `/v1/graphql` with DataLoaders, depth limiting,
  complexity/mutation limits (`src/node/handlers/graphql/`).
- **Idempotency:** DB-backed hash dedup with TTL for webhooks and critical mutations.
- **Deploys:** `pnpm deploy:<stage>` runs a health-gated canary with automatic
  rollback (`scripts/deploy.ts`); `:simple` variants are a plain `wrangler deploy`,
  and `wrangler rollback` reverts manually.

## Auth Flow

1. Client sends `Authorization: Bearer <JWT>`
2. `requireAuth()` middleware verifies the RS256 signature against the WorkOS JWKS
3. Verified claims are set on the Hono context (`c.get("claims")`)
4. `getUserIdFromClaims(claims)` resolves `authIdentity → userId` (JIT-creates the user on first login)

## Adding an Endpoint

Copy the nearest sibling in `src/node/routes/` (e.g. `users.ts`), add your handler to
the domain's Hono sub-app, add a Zod schema in `lib/validation/`, and — only for a new
domain — mount it in `routes/index.ts` (with `requireAuth()` if protected). Then
`pnpm check`. Patterns and invariants: [AGENTS.md](./AGENTS.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [Cloudflare Setup](./docs/CLOUDFLARE_SETUP.md) | Zero-to-running: local dev, tests, secrets, deploy |
| [Environment Variables](./docs/ENVIRONMENT_VARIABLES.md) | wrangler vars, secrets, `.dev.vars` |
| [Security Model](./docs/SECURITY.md) | Auth, CORS, edge protection, error masking |
| [Audit Logging](./docs/AUDIT_LOGGING_GUIDE.md) | How the audit trail works, integration patterns |
| [Testing Guide](./docs/guides/TESTING.md) | Unit + integration testing |
| [Data Retention](./docs/DATA_RETENTION_POLICY.md) | Retention policies per data type |
| [SOC 2 Checklist](./docs/SOC2_READINESS_CHECKLIST.md) | Compliance readiness tracker |
| [North Star](./docs/direction/NORTH_STAR.md) | Why this stack; one-person maintainability principles |
| [Migration Plan](./docs/direction/MIGRATION_PLAN.md) | AWS → Cloudflare migration record + remaining work |
| [Legacy AWS docs](./docs/legacy-aws/) | Pre-migration stack (kept for decommissioning/reference) |

## AI Coding Rules

[AGENTS.md](./AGENTS.md) is the canonical guide (invariants, Definition of Done).
`.cursor/rules/` holds per-domain pattern files; note `infrastructure.mdc` and parts
of `handlers.mdc`/`backend-core.mdc` still describe the Lambda-era layout.
