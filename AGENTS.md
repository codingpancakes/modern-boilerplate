# AGENTS.md — Guide for AI Agents Building on This Backend

> **Prime directive:** This is a production-grade serverless boilerplate, not a scrappy MVP.
> The foundation is built to platform-team quality (race-safe idempotency, DataLoader batching,
> JWKS authorizer, blue-green deploys with auto-rollback, DB-enforced audit immutability).
> **When you add code, keep it at that bar.** Match the existing patterns exactly — consistency
> is more valuable than your personal preference. When in doubt, copy the nearest sibling file.

---

## What this is

Node.js 24 / TypeScript 5 / pnpm · AWS Lambda + API Gateway HTTP v2 · Neon Postgres (drizzle-orm)
· WorkOS JWT auth · Zod validation · Biome · Vitest · AWS CDK · CodePipeline CI/CD.

Two surfaces:
- **REST handlers** (`src/node/handlers/{domain}/{action}.ts`) wrapped by `withAuth` / `withPublicCors`.
- **GraphQL** (`src/node/handlers/graphql/`) — Apollo, DataLoaders, resolver-level audit.

---

## Architecture map

```
src/node/
  handlers/          One Lambda per file. REST: {domain}/{action}.ts. GraphQL: graphql/resolvers,schema.
  lib/               Shared cross-cutting libs (middleware, cors, db, errors, audit, sanitize, idempotency).
  lib/validation/    Zod schemas by domain. Export {domain}Schemas, re-export from index.ts.
  lib/services/      Business logic (user-provisioning.ts). Handlers stay thin; logic lives here.
  db/schema/         Drizzle schema. db/migrations/ holds SQL + journal (drizzle-kit generated).
  authorizers/       WorkOS JWT Lambda authorizer (the single source of auth trust).
infrastructure/      CDK stacks + RouteBuilder. One stack per concern.
local-dev/server.ts  Express dev server mirroring the Lambda contract.
docs/                Human docs. .cursor/rules/ holds per-domain agent patterns.
```

Layering is strict: `handlers → lib/services → lib → db`. Handlers orchestrate; they don't hold logic.

---

## Non-negotiable invariants

These are enforced across the codebase. Breaking one is a regression, even if it "works":

1. **No try-catch in handlers.** Middleware (`withAuth` / `withPublicCors`) catches and formats all errors.
2. **Zod-validate every input.** `parseBody(event, schema)` / `parseQuery(...)` for REST; `schema.parse(input)` in resolvers.
3. **`sanitizeObject()` before every DB write.** No exceptions for "trusted" input.
4. **`logAudit()` on every mutation.** Call it fire-and-forget (`void logAudit(...)`); never `await` it on the hot path. The request wrappers (`withAuth` / `withPublicCors` / GraphQL handler) call `flushAudits()` before returning, which drains in-flight writes — an un-awaited promise alone is *not* guaranteed to finish before Lambda freezes.
5. **Drizzle ORM only.** Never raw SQL in app code (migrations are the only SQL).
6. **`ACTIVE` filter on all membership queries:** `eq(organizationMembers.status, "ACTIVE")`.
7. **Response/error factories only.** REST: `createSuccessResponse(data)` / `throw Errors.NotFound("X")`.
   GraphQL: `throw new GraphQLError(msg, { extensions: { code } })`. Never hand-roll `{ statusCode, body }`.
8. **Transactions for multi-step writes:** `db.transaction(async (tx) => { ... })`. This relies on the WebSocket-capable `neon-serverless` driver wired in `lib/db.ts` — the `neon-http` driver throws `"No transactions support"` at runtime, so never switch the driver back (driver choice guarded by `tests/unit/lib/db.test.ts`; commit/rollback atomicity guarded against a real Postgres in `tests/integration/db-transactions.test.ts`, run via `pnpm test:integration`).
9. **Secrets via Secrets Manager**, config via `commonEnv`. Never plaintext credentials in env or code.
10. **Auth comes only from the API Gateway authorizer.** No local JWT re-parsing/fallback in handlers.
11. **Migrations must be expand/contract (backward-compatible one release in each direction).** The
    pipeline deploys code first, then runs migrations — so old code runs against the new schema during
    the deploy, and a rollback runs old code against it indefinitely. Additive changes only per release:
    new columns nullable or defaulted, no renames (add new + backfill + drop old across separate releases),
    no dropping/tightening anything the currently-deployed code still reads or writes.

---

## Definition of Done (apply to EVERY new feature)

Before you consider a change complete, verify all of these:

- [ ] Input validated with a Zod schema (bounded arrays/strings; `jsonObject` for arbitrary JSON).
- [ ] `sanitizeObject()` applied before any DB write.
- [ ] Auth enforced (`withAuth` / authorizer) and **org-scoped** where data is org-owned.
- [ ] Null-guard every DB result before use (`if (!row) throw ...`).
- [ ] `logAudit()` on mutations, with `extractRequestContext(event)` / `auditRequestContext(context)`.
- [ ] Multi-step writes wrapped in a transaction.
- [ ] Errors thrown via the factory; no internal details leak (5xx masked in deployed envs).
- [ ] **Async/scheduled Lambdas: attach a DLQ + a CloudWatch error alarm** (see Scaling Patterns).
- [ ] **Recursive utilities are depth-bounded** (mirror `redactSensitive`'s depth guard).
- [ ] Schema changes are expand/contract-safe (deployable and rollback-able against the previous release).
- [ ] Route registered in `infrastructure/lib/routes/` **and** `local-dev/server.ts`.
- [ ] `pnpm check` passes (Biome lint + `tsc --noEmit` + Vitest) before commit.

If a checkbox doesn't apply, that should be obvious — not assumed.

---

## Scaling patterns (replicate these — they're the quality bar)

- **Idempotency:** wrap non-idempotent REST mutations in `withIdempotency(event, async () => {...})`.
  Use the atomic-upsert pattern already in `lib/idempotency.ts`; never SELECT-then-INSERT.
- **N+1 prevention:** in GraphQL field resolvers, use `context.loaders.*` (DataLoader) — never query per-row.
- **DB access:** always `await getDb()` (singleton + in-flight dedup + secret-rotation TTL). Don't create clients.
- **Async resilience:** any EventBridge/scheduled/queue-driven Lambda MUST set `deadLetterQueue` on
  `RouteBuilder.createHandler` and get a per-function error alarm. A silent failure with no DLQ is a bug.
- **Sensitive data:** secrets are redacted by key name from `changes` AND `metadata` before audit write.
  Never log tokens/passwords. PII (email/name) is retained for forensics by design.
- **Audit trail is immutable:** the DB rejects `UPDATE` and in-window `DELETE`. Never try to mutate rows;
  never put a secret in `metadata` (it persists for 7 years, un-deletable).
- **New Lambda:** always via `RouteBuilder.createHandler()` — it wires the shared role, bundling,
  tracing, blue-green + auto-rollback. Grant new IAM permissions on the shared `lambdaRole`, not per-function.

---

## How to add a feature (the happy path)

1. **Schema** → `db/schema/{domain}.ts`, export from `index.ts`. Generate migration with drizzle-kit.
2. **Validation** → `lib/validation/{domain}.ts`, export `{domain}Schemas`, re-export from `index.ts`.
3. **Logic** → `lib/services/{domain}.ts` if non-trivial; keep handlers thin.
4. **Handler/Resolver** → copy the nearest sibling; follow `.cursor/rules/handlers.mdc` or `graphql.mdc`.
5. **Route** → register in `infrastructure/lib/routes/{public,protected,internal}-routes.ts` AND `local-dev/server.ts`.
6. **Test** → `tests/unit/{domain}/`. Mock DB/S3/Sentry; never hit real infra.
7. `pnpm check`, then commit.

---

## Deploy & environments

- **`git push develop` → staging pipeline auto-deploys.** **`git push main` → production auto-deploys.**
- Pipelines build, run CDK deploy (blue-green), then run migrations. Both must be green before promoting.
  This ordering is why invariant 11 (expand/contract migrations) exists — there is always a window where
  the live code and the schema are one step apart.
- **WAF is production-only**, toggled by SSM `/{PROJECT_NAME}/{stage}/enable-waf` (read in `buildspec.yml`, gates
  `api-stack.ts`). The WAF rule definitions stay in code regardless of the toggle. Re-enable before real users.
- Never commit secrets (`.env*` are protected). SSM is the source of truth for env toggles, not local `.env`.

---

## Reference

- Per-domain patterns: `.cursor/rules/` (`backend-core`, `handlers`, `graphql`, `infrastructure`, `validation-security`, `testing`, `scaling-quality`).
- Deep docs: `docs/` (`AUDIT_LOGGING_GUIDE`, `SECURITY`, `DATA_RETENTION_POLICY`, `SOC2_READINESS_CHECKLIST`, `ENVIRONMENT_VARIABLES`).
- Setup: `docs/BOILERPLATE_SETUP.md`.
