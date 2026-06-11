# Migration Plan — AWS/CDK → Cloudflare Workers + Hono + Neon

> Target architecture and rationale: [NORTH_STAR.md](./NORTH_STAR.md).
> Estimate: **~3–4 weeks to production parity** for one experienced dev who knows this repo.
> The app layer ports nearly untouched; the operational shell (CI/CD, alerting, deploy
> safety) is the long pole.

## Strategy: incremental, route-by-route

Both stacks share the same Neon database, so there is no big-bang cutover. Cloudflare
sits in front and proxies unmigrated paths to the existing CloudFront origin. Each
route gets a free rollback path: flip the proxy rule back.

Migration order (least → most stateful):

1. `health` / `health-detailed`
2. Media (presigned upload, list, direct upload) — R2 first
3. REST (users)
4. GraphQL
5. Webhooks last (idempotency locks + DLQ semantics deserve the most care)

## Phases

### Phase 1 — Hono on the current Lambda stack (pure upside, do regardless)

- Mount REST handlers as Hono routes via the `aws-lambda` adapter; keep CDK deploys unchanged.
- Rewrite `lib/middleware.ts` wrappers (`withAuth`, `withPublicCors`) as Hono middleware.
- Local dev = run the same Hono app with `@hono/node-server`. **Delete `local-dev/server.ts`**
  and drop `express`, `cors`, `@types/express`, `@types/cors`.
- Replace swagger-jsdoc with `@hono/zod-openapi` (docs generated from existing Zod schemas).

### Phase 2 — Cloudflare foundations

- `wrangler.toml` with envs (staging/production), `nodejs_compat` enabled.
- Hyperdrive config for Neon (the Neon serverless driver also runs on Workers natively).
- R2 buckets (images, public assets) — point the existing presigned-URL code at the R2 S3 endpoint.
- Secrets via `wrangler secret`; delete the Secrets Manager fetch/rotation caching in `db.ts`.
- CI: GitHub Actions re-expressing the buildspec gates — `pnpm audit`, lint, typecheck,
  unit tests, integration tests against ephemeral Postgres, then `wrangler deploy` + smoke test.

### Phase 3 — Route-by-route cutover (order above)

- Cron Triggers replace the janitor and audit-retention schedules.
- Cloudflare Queues replaces the webhook DLQ; keep the DB-backed idempotency exactly as is.
- GraphQL: swap Apollo's Lambda integration for **GraphQL Yoga** (Workers-native).
  Resolvers, DataLoaders, depth/complexity limits carry over; the server harness
  (~200 lines) is the rewrite. This is the most novel code in the migration.
- Replace AWS Powertools logger/tracer with a thin structured logger + Sentry
  (mechanical, but touches every file).

### Phase 4 — Operational shell (do not under-invest here)

- **Deploy safety:** gradual deployments (percentage rollout between Worker versions)
  + a health-check script that auto-promotes or auto-reverts. This replaces the
  CodeDeploy blue-green canary — the one place the platform gives us *less* out of
  the box than we have today. Budget real time for it.
- Alerting: Workers analytics + Cloudflare notifications + Sentry alert rules.
- Logpush → retention sink for compliance evidence (pairs with the app audit trail).

### Phase 5 — Decommission AWS

- Follow [CDK_TEARDOWN](../guides/CDK_TEARDOWN.md). Archive CloudTrail logs before
  deleting anything (retention evidence).
- Update SECURITY.md, ENVIRONMENT_VARIABLES.md, SOC2 checklist, and AGENTS.md to
  describe the Cloudflare stack (until then, those docs describe the code as it is).

## Port / rebuild / delete

| Component | Fate | Notes |
|---|---|---|
| Drizzle schema + migrations | **Port (zero change)** | Same Postgres (Neon) |
| `lib/` core: validation, sanitize, pagination, errors, idempotency, audit | **Port (near-zero)** | Pure TS + Drizzle; `node:crypto` works under `nodejs_compat` |
| WorkOS verifier (jose) | **Port (zero change)** | WebCrypto-based; becomes Hono middleware (Lambda authorizer concept disappears) |
| Media presigned URLs | **Port (small)** | R2 is S3-API-compatible |
| Handlers + middleware | **Rewrite (mechanical)** | API GW event shape → Hono context; done in Phase 1 |
| GraphQL server harness | **Rewrite (~200 lines)** | Apollo → Yoga; resolvers/loaders/plugins port |
| Powertools logger/tracer | **Replace** | Thin structured logger + Sentry |
| Webhook DLQ, cron Lambdas | **Replace (small)** | Queues + Cron Triggers |
| CI/CD (CodePipeline/buildspec) | **Rebuild** | GitHub Actions; same gates, ~30s deploys |
| Blue-green auto-rollback | **Rebuild (deliberate)** | Gradual deployments + promote/revert script |
| Express dev shim, origin-verify, Secrets rotation caching, WAF/CDN/monitoring stacks, swagger-jsdoc | **Delete** | Platform makes the problem not exist |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| GraphQL server swap (most novel code) | Migrate GraphQL late (step 4 of cutover); keep Apollo running on Lambda until Yoga passes the full resolver test suite |
| Auto-rollback under-investment | Treat Phase 4 as a deliverable with its own week, not a cleanup task |
| `nodejs_compat` edge cases | Run the integration suite under `vitest-pool-workers` / miniflare before each cutover |
| 128MB isolate memory | Fine for current payloads (4.5MB direct upload, 15MB presigned); heavy processing → Queues/Containers |
| Compliance evidence gaps | Enable Cloudflare account audit logs + Logpush from day one; app audit trail unchanged |

## Pre-migration hardening (current stack)

From the 2026-06 audit ([AUDIT_2026-06.md](./AUDIT_2026-06.md)) — do these only if the
migration slips past a quarter; most are mooted by the move:

- Still worth doing now: emit a metric + alarm on audit write failures (carries to Workers);
  fix cursor pagination millisecond-precision edge (`lib/pagination.ts`).
- Mooted by migration: S3 bucket versioning (R2 decision instead), CloudTrail retention,
  `ALERT_EMAIL` fail-fast, buildspec SSM validation, reserved concurrency.
