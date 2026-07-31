# AGENTS.md — Guide for AI Agents Building on This Backend

> **Prime directive:** This is a production-grade serverless boilerplate, not a scrappy MVP.
> The foundation is built to platform-team quality (race-safe idempotency, DataLoader batching,
> RS256-pinned JWT verification, DB-enforced audit immutability, real-Postgres transaction tests).
> **When you add code, keep it at that bar.** Match the existing patterns exactly — consistency
> is more valuable than your personal preference. When in doubt, copy the nearest sibling file.

---

## What this is

TypeScript 5 / pnpm · **One Cloudflare Worker** (Hono) · Neon Postgres (drizzle-orm)
· WorkOS JWT auth · Zod validation · Biome · Vitest · wrangler deploys.

Two surfaces, one app:
- **REST routes** (`src/node/routes/{domain}.ts`) — Hono sub-apps mounted by `routes/index.ts`.
- **GraphQL** (`src/node/routes/graphql.ts` + `src/node/handlers/graphql/`) — GraphQL Yoga,
  DataLoaders, resolver-level audit.

---

## Architecture map

```
src/node/
  worker.ts          Worker entry. fetch → app.ts; scheduled → cron.ts registry.
  app.ts             THE Hono app: request-id → rateLimit (per-IP) → dbScope → auditFlush → CORS/security → routes.
                     notFound/onError own the wire format. Do not add routes here.
  routes/            One Hono sub-app per domain. Barrel (index.ts) mounts them and
                     applies requireAuth() per protected domain. test.ts is dev-only.
  cron.ts            Cron Trigger registry — keys MUST equal wrangler.toml [triggers] exprs.
  authorizers/       verify-token.ts — WorkOS JWT verifier (the single source of auth trust).
  handlers/graphql/  Yoga context, plugins, resolvers/, schema/.
  handlers/utils/    janitor.ts, audit-retention.ts (cron job bodies).
  lib/               Shared cross-cutting libs (db, errors, audit, sanitize, idempotency, cors).
  lib/hono/          auth (requireAuth), middleware, respond, types (AppEnv).
  lib/validation/    Zod schemas by domain. Export {domain}Schemas, re-export from index.ts.
  lib/services/      Shared/mutation business logic (organizations, user-account,
                     user-provisioning, webhook-processor, media-upload).
  db/schema/         Drizzle schema. db/migrations/ holds SQL + journal (drizzle-kit generated).
wrangler.toml        Worker config: [vars], R2 bindings, [triggers], env.staging/env.production.
docs/                Human docs. .cursor/rules/ holds per-domain agent patterns.
```

Dependency direction is inward: routes/resolvers may orchestrate shared libraries
and perform small, scoped reads; reusable rules, authorization, and mutation
workflows live in `lib/services`; persistence uses Drizzle/schema modules. Do not
put branching business workflows in routes or duplicate service rules there.

Cloudflare Workers is the only runtime. Local dev is `pnpm dev`
(`wrangler dev --local`) running the exact production app—one routing layer,
zero dev/prod drift.

---

## Task-specific agent handbook

This file is the repository-wide contract. Before changing code, also read every
task-specific playbook that applies:

| Change touches | Required playbook |
| --- | --- |
| Scoping a new schema, domain, or API from product requirements | [`docs/agents/FEATURE_REQUEST_TEMPLATE.md`](docs/agents/FEATURE_REQUEST_TEMPLATE.md) |
| Any endpoint, resolver, service, or domain | [`docs/agents/FEATURE_WORKFLOW.md`](docs/agents/FEATURE_WORKFLOW.md) |
| Copying an implementation shape, including WorkOS auth | [`docs/agents/CANONICAL_CODE_PATTERNS.md`](docs/agents/CANONICAL_CODE_PATTERNS.md) |
| Auth, roles, organizations, memberships, invitations, or PII | [`docs/agents/AUTHORIZATION_AND_DATA_BOUNDARIES.md`](docs/agents/AUTHORIZATION_AND_DATA_BOUNDARIES.md) |
| Schema, migrations, transactions, idempotency, or concurrency | [`docs/agents/DATABASE_AND_CONCURRENCY.md`](docs/agents/DATABASE_AND_CONCURRENCY.md) |
| Tests, review, CI, or completion claims | [`docs/agents/TESTING_AND_VERIFICATION.md`](docs/agents/TESTING_AND_VERIFICATION.md) |
| Bindings, secrets, queues, cron, health, or deploys | [`docs/agents/OPERATIONS_AND_BINDINGS.md`](docs/agents/OPERATIONS_AND_BINDINGS.md) |

The routing index and instruction precedence are in
[`docs/agents/README.md`](docs/agents/README.md). When a canonical pattern
changes, update its playbook in the same patch so agent guidance cannot drift
from the implementation.

---

## Non-negotiable invariants

These are enforced across the codebase. Breaking one is a regression, even if it "works":

1. **No try-catch in route handlers.** `app.ts` `onError` catches and formats all errors
   (Sentry capture + the standard `{ success:false, error, details }` wire shape).
2. **Validate every untrusted input at its boundary.** Use bounded Zod schemas for
   REST body/query/path data and GraphQL arguments. Protocol headers (bearer tokens,
   webhook signatures, idempotency keys) use their dedicated parsers/verifiers.
3. **`sanitizeObject()` before persisting user/provider-controlled domain values.**
   Internal control rows (idempotency state, audit rows, fixed foreign-key-only
   records) use typed, constructed values and their own validation/redaction helpers.
4. **Audit every user-visible/domain mutation.** Request-path audit writes use
   fire-and-forget `void logAudit(...)`; the app-level `auditFlush()` drains them
   before the request ends. Writes that must commit with a transaction use
   `writeAuditLog(tx, ...)`; terminal background paths use `logAuditStrict()`.
5. **Drizzle ORM only.** Never construct or execute raw SQL strings in app code.
   A parameterized Drizzle `sql` fragment is allowed only when the ORM has no typed
   primitive (for example an advisory transaction lock or partial-index predicate);
   keep it local, explain the invariant, and prove it against real Postgres.
   Migrations remain the normal home for DDL.
6. **`ACTIVE` filter on every ordinary membership authorization/listing query:**
   `eq(organizationMembers.status, "ACTIVE")`.
   This is also the **invite-consent boundary**: `inviteMember` verifies the target user
   exists and creates a `PENDING` membership (not `ACTIVE`), so the invitee stays invisible
   to member/user listings until they call `acceptInvitation` (→ `ACTIVE`) or
   `declineInvitation` (→ `INACTIVE`) themselves. Never surface `PENDING` rows through the
   ACTIVE-filtered queries — that would reintroduce the IDOR/PII-exposure hole this closes.
7. **Response/error factories only.** REST: `sendSuccess(c, data)` / `createSuccessResponse(data)`
   / `throw Errors.NotFound("X")`. GraphQL: `throw new GraphQLError(msg, { extensions: { code } })`.
   Never hand-roll response bodies.
8. **Transactions for multi-step writes:** `db.transaction(async (tx) => { ... })`. This relies on
   the WebSocket-capable `neon-serverless` driver wired in `lib/db.ts` — the `neon-http` driver
   throws `"No transactions support"` at runtime, so never switch the driver back (guarded by
   `tests/unit/lib/db.test.ts`; atomicity proven against real Postgres in
   `tests/integration/db-transactions.test.ts`).
9. **DB lifecycle is per-request.** Always `await getDb()`; never cache pools/clients at module
   scope — Workers forbids reusing I/O objects across requests (it throws). The `dbScope()`
   middleware gives every request its own pool and drains it on exit; cron handlers and scripts
   outside a scope get a fresh, disposable instance.
10. **Auth comes only from `requireAuth()`** (which runs `authorizers/verify-token.ts`).
    Routes read `c.get("claims")` — never re-parse JWTs or invent fallbacks. New protected
    domains get `routes.use("/v1/<domain>/*", requireAuth())` in the barrel.
11. **Secrets via wrangler** (`.dev.vars` locally, `wrangler secret put` deployed — pushed by
    `pnpm sync-secrets <stage>` from the registry in `.dev.vars.example`). Non-secret config via
    `wrangler.toml [vars]`. Never plaintext credentials in code or committed files. Every new
    secret name gets added to `.dev.vars.example`.
12. **Migrations must be expand/contract** (backward-compatible one release in each direction).
    Code deploys and migrations are separate steps, so old code runs against the new schema during
    a deploy and a rollback (`wrangler rollback`) runs old code against it indefinitely. Additive
    changes only per release: new columns nullable or defaulted, no renames (add new + backfill +
    drop old across separate releases), no dropping/tightening anything deployed code still touches.
13. **Cron jobs must throw on failure.** `worker.ts` `scheduled` dispatches by exact cron
    expression; a handler that swallows errors records a successful invocation — a silent async
    failure is a bug. New job = wrangler.toml `[triggers]` entry + same-key `cronRegistry` entry
    in `cron.ts` (mismatch throws, by design).

---

## Definition of Done (apply to EVERY new feature)

Before you consider a change complete, verify all of these:

- [ ] Untrusted body/query/path input validated with a bounded Zod schema
      (`jsonObject` for arbitrary JSON); protocol headers use their canonical verifier.
- [ ] User/provider-controlled domain values sanitized before persistence.
- [ ] Auth enforced (`requireAuth()` on the domain) and **org-scoped** where data is org-owned.
- [ ] Null-guard every DB result before use (`if (!row) throw ...`).
- [ ] Domain mutation audited with the correct durability helper and request
      context (`c.get("requestId")`, `cf-connecting-ip`, `user-agent`).
- [ ] Multi-step writes wrapped in a transaction.
- [ ] Errors thrown via the factory; no internal details leak (5xx masked in deployed envs).
- [ ] **Recursive utilities are depth-bounded** (mirror `redactSensitive`'s depth guard).
- [ ] Schema changes are expand/contract-safe (deployable and rollback-able against the previous release).
- [ ] Endpoint added in the domain's `src/node/routes/{domain}.ts`; new domains mounted in
      `routes/index.ts` (auth applied there). Scheduled work registered in `cron.ts` + `wrangler.toml`.
- [ ] New secrets registered in `.dev.vars.example`; new bindings typed in `worker.ts`
      `WorkerBindings` and `wrangler.toml`.
- [ ] `pnpm check` passes (Biome lint + `tsc --noEmit` + Vitest) before commit.

If a checkbox doesn't apply, that should be obvious — not assumed.

---

## Scaling patterns (replicate these — they're the quality bar)

- **Idempotency:** wrap non-idempotent REST mutations in `withTransactionalIdempotentJson(...)`
  (`lib/hono/idempotent-response.ts` — see `routes/users.ts` PATCH /me): the mutation and the stored
  response commit in ONE transaction, so a crash can't leave a "processing" key a retry
  double-executes. Run the write on the `tx` the wrapper passes in. Use the atomic-upsert pattern in
  `lib/idempotency.ts`; never SELECT-then-INSERT.
- **N+1 prevention:** in GraphQL field resolvers, use `context.loaders.*` (DataLoader) — never
  query per-row.
- **Sensitive data:** secrets are redacted by key name from `changes` AND `metadata` before audit
  write. Never log tokens/passwords. PII (email/name) is retained for forensics by design.
- **Audit trail is immutable:** the DB rejects `UPDATE` and in-window `DELETE`. Never try to mutate
  rows; never put a secret in `metadata` (it persists for 7 years, un-deletable).
- **Constant-time comparison** (`lib/constant-time.ts`) for every secret/key check — see
  `routes/test.ts` and the webhook signature verification.
- **Workers limits:** 128MB isolate memory, CPU-time caps. Heavy media/batch work does not belong
  in the request path — push it to a cron job or the Cloudflare Queue (`src/node/queue.ts`).

---

## How to add a feature (the happy path)

1. **Schema** → `db/schema/{domain}.ts`, export from `index.ts`. `pnpm db:generate` for the migration.
2. **Validation** → `lib/validation/{domain}.ts`, export `{domain}Schemas`, re-export from `index.ts`.
3. **Logic** → `lib/services/{domain}.ts` if non-trivial; keep route handlers thin.
4. **Route** → add the handler to `src/node/routes/{domain}.ts` (copy the nearest sibling).
   New domain: mount in `routes/index.ts` with `requireAuth()` if protected.
5. **Test** → `tests/unit/{domain}/`. Mock DB/Sentry; never hit real infra in unit tests.
6. `pnpm check`, then commit.

---

## Deploy & environments

- **Local:** `pnpm dev` (`wrangler dev --local`, port 8787) — no Cloudflare account needed;
  R2/cron are simulated on disk. Secrets from `.dev.vars`.
- **Deploy:** `pnpm deploy:staging` / `pnpm deploy:production` run `scripts/deploy.ts` — a
  health-gated gradual rollout: upload new version → canary (`CANARY_PERCENT`, default 10%)
  → soak → probe `/v1/health/detailed` → promote to 100% and re-probe → **auto-rollback to
  the previous version and exit 1 on any health failure**. `deploy:*:simple` is the plain
  all-at-once `wrangler deploy` escape hatch. Run `pnpm migrate` against the stage's database
  as a separate step — invariant 12 (expand/contract) exists because code and schema are
  never updated atomically.
- **CI/CD:** `.github/workflows/ci.yml` runs the gate (runtime dependency audit, lint,
  typecheck, OpenAPI drift check, unit tests, integration tests vs a Postgres service) on
  pull requests into `staging` or `main`. A merge/push to `staging` deploys staging.
  A merge/push to `main` starts production deployment and waits on the GitHub
  `production` environment approval. Manual `workflow_dispatch` can target either
  environment. Repo secrets/vars needed by deploy jobs: `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `WORKERS_SUBDOMAIN`, and optional `SMOKE_CORS_ORIGIN`.
- **Manual rollback:** `npx wrangler rollback --env <stage>` (the deploy script also rolls
  back automatically on a failed health gate).
- **Queue consumers:** gradual deploys (`wrangler versions`) do NOT register Queue
  *consumers*. After ADDING or CHANGING a `[[queues.consumers]]`, run
  `pnpm deploy:<stage>:simple` ONCE (full `wrangler deploy`) to register it; it then
  persists across later gradual deploys. (Cron Triggers/routes ARE synced by the deploy
  script via `wrangler triggers deploy`.)
- **Secrets:** `pnpm sync-secrets <stage>` pushes every name in `.dev.vars.example` from
  `.env.<stage>`. Never commit `.env*` / `.dev.vars` (gitignored).
- **Edge security:** Cloudflare WAF/DDoS is account-level platform config, not code.

---

## Reference

- Agent handbook: `docs/agents/README.md`.
- Setup from zero: `docs/CLOUDFLARE_SETUP.md`.
- Deep docs: `docs/` (`AUDIT_LOGGING_GUIDE`, `SECURITY`, `DATA_RETENTION_POLICY`,
  `SOC2_READINESS_CHECKLIST`, `ENVIRONMENT_VARIABLES`, `guides/TESTING`).
- Architecture direction: `docs/direction/NORTH_STAR.md`.
- Cursor routing: `.cursor/rules/project.mdc` points back to this contract and
  the task-specific handbook; it contains no duplicate implementation rules.
