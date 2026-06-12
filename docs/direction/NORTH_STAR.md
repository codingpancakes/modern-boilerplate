# North Star — The One-Person Backend

> Status: **largely realized (June 2026).** The migration executed: this branch runs the
> whole backend as one Cloudflare Worker (Hono + Neon), all AWS code deleted. The
> "Today (AWS)" column below is historical context. Remaining gaps (Hyperdrive, Queues,
> CI, deploy safety/operational shell) are tracked in [MIGRATION_PLAN.md](./MIGRATION_PLAN.md).

## Goal

A backend that one person can own end-to-end — and that scales beautifully on both
axes that matter: **price** and **performance**. Every architectural choice below is
judged against a single question: *does this reduce what one maintainer has to carry?*

## Target stack

| Layer | Today (AWS) | Target | Why |
|---|---|---|---|
| Compute | Lambda + API Gateway + CloudFront | **Cloudflare Workers** | ~0ms cold starts, global by default, no concurrency ceiling, seconds-fast deploys |
| HTTP framework | Raw API GW handlers + Express dev shim | **Hono** | One app object runs on Workers, Node, and Lambda — local dev *is* production routing |
| Database | Neon Postgres (serverless driver) | **Neon via Hyperdrive** (unchanged) | Postgres is the boring, correct choice; Drizzle schema + migrations carry over untouched |
| GraphQL | Apollo Server (Lambda integration) | **GraphQL Yoga** | Workers-native; resolvers, DataLoaders, depth/complexity plugins port as-is |
| Media | S3 + presigned URLs + CloudFront | **R2** | S3-compatible API (presigned code ports), **$0 egress** |
| Async / jobs | SQS DLQ + EventBridge cron | **Queues + Cron Triggers** | Platform-native, no IAM wiring |
| Auth | WorkOS (shared jose verifier) | **WorkOS** (unchanged) | jose is WebCrypto-based — runs on Workers as-is |
| Edge security | AWS WAF ($) + origin-verify hack | **Cloudflare WAF/DDoS** (included) | Always on, no budget toggle; the worker *is* the edge — no origin to protect |
| Secrets | Secrets Manager + rotation caching | **wrangler secrets** | Less machinery to maintain |
| Docs | swagger-jsdoc | **@hono/zod-openapi** | OpenAPI generated from the Zod validators we already write — can't drift |
| CI/CD | CodePipeline + buildspec | **GitHub Actions + wrangler** | ~30s deploys vs ~10min CloudFormation |
| Errors | Sentry | **Sentry** (unchanged) | Works on Workers |

## What we keep (the crown jewels)

These are application-layer TypeScript and port nearly untouched. They are the
actual value of this codebase — the platform underneath is the replaceable shell:

- Shared WorkOS token verifier (single source of truth, RS256 pinned, `client_id` binding)
- DB-backed idempotency (`lib/idempotency.ts` — atomic claim, stale-lock reclaim)
- Immutable audit trail with redaction and retention (`lib/audit.ts`)
- Zod validation + sanitization layers (`lib/validation/`, `lib/sanitize.ts`)
- Multi-tenant scoping and RBAC in resolvers
- Constant-time comparisons for all secret checks
- Destructive-DB guard (`scripts/lib/destructive-db-guard.ts`)
- Real-Postgres integration test harness
- The documentation discipline itself

## What disappears by construction

Not migrated — *deleted*, because the platform makes the problem not exist:

- `local-dev/server.ts` (~400-line Express shim) and its entire drift-bug category
- `lib/origin-verify.ts` + the `X-Origin-Verify` secret and its rotation burden
- Lambda concurrency limits, alarms, and reserved-concurrency debates
- Secrets Manager rotation caching in `db.ts`
- 5 of 8 CDK stacks (WAF, CloudFront/origin, media CDN, public assets CDN, most of monitoring)
- The swagger-jsdoc pipeline

## Cost & performance posture

- Workers Paid: $5/mo incl. ~10M requests, then ~$0.30/M. WAF/CDN/DDoS included. R2 egress $0.
- Equivalent AWS footprint here runs $50–150/mo before meaningful traffic (API GW per-request,
  WAF, CloudFront, ~$0.09/GB egress).
- At high scale the gap narrows (Workers bills CPU-ms); **Neon is the dominant cost line in
  both worlds** and the true scaling bottleneck. Compute is effectively infinite either way.

## Security & compliance posture

- **Equal or better** for the real threat model: app-layer controls carry over intact;
  edge protection improves (always-on WAF, no bypassable origin).
- **Weaker** on platform governance: coarser tokens than IAM, no GuardDuty/CloudTrail-grade
  managed detection — we assemble evidence from Cloudflare audit logs + Logpush + our own audit trail.
- **SOC 2 remains fully achievable** (Cloudflare is SOC 2 / ISO 27001 certified; our controls
  are mostly app-level and survive). Budget extra evidence-assembly time vs AWS.
- Known limits to respect: 128MB isolate memory, CPU-time caps — fine for this API; heavy
  media/batch work goes to Queues, Containers, or an external service.

## One-person maintainability principles

1. **One routing layer.** The same Hono app runs locally and in production. No emulation, no drift.
2. **Platform features over custom infra.** If Cloudflare ships it (WAF, CDN, cron, queues), don't build or wire it.
3. **Boring database.** Postgres + Drizzle + SQL migrations. No exotic storage until a measured need exists.
4. **Deleting beats configuring.** Every config file, stack, and secret is a thing one person has to remember.
5. **Security lives in app code.** Validation, authz, audit, idempotency — portable, testable, auditable TypeScript.
6. **Deploys must be boring.** Seconds-fast, gradual rollout, scripted auto-rollback (see migration plan — this is the one thing we must rebuild deliberately).
