# Documentation

## Direction
- [North Star](./direction/NORTH_STAR.md) — **where this backend is going:** Cloudflare Workers + Hono + Neon, one-person maintainable, optimized for price and performance
- [Migration Plan](./direction/MIGRATION_PLAN.md) — the AWS → Cloudflare migration: what's done, what changed from the plan, what remains (operational shell, AWS decommission)
- [Audit (June 2026)](./direction/AUDIT_2026-06.md) — verified audit of the pre-migration AWS stack: 8.5/10, findings, and false positives dismissed (historical)

## Setup & Operations
- [Cloudflare Setup](./CLOUDFLARE_SETUP.md) — **start here.** Zero-to-running: local dev (`wrangler dev --local`), migrations, tests, secrets, deploys, R2/Hyperdrive
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) — wrangler `[vars]`, secrets, `.dev.vars`, `.env.*` files
- [Webhook/DLQ Runbook](./runbooks/WEBHOOK_DLQ.md) — Queue failure alerts, triage, replay, and acknowledgement policy

## Security & Compliance
- [Security Model](./SECURITY.md) — Auth, CORS, edge protection, error masking
- [Audit Logging](./AUDIT_LOGGING_GUIDE.md) — Audit trail patterns and integration (platform references partly pre-migration)
- [Data Retention](./DATA_RETENTION_POLICY.md) — Retention policies per data type (platform references partly pre-migration)
- [SOC 2 Checklist](./SOC2_READINESS_CHECKLIST.md) — Compliance readiness tracker (platform items need Cloudflare re-mapping; see its banner)

## Development
- [Testing Guide](./guides/TESTING.md) — Unit + integration testing
- [Handler Templates](../templates/README.md) — Current Hono route templates and endpoint patterns

## Legacy (pre-atomic AWS stack)
Superseded by [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md); kept for reference and for decommissioning the old AWS account:
- [Boilerplate Setup](./legacy-aws/BOILERPLATE_SETUP.md) — AWS/CDK first-deploy guide
- [CDK Teardown](./legacy-aws/CDK_TEARDOWN.md) — how to destroy the AWS stacks (run from a pre-atomic checkout)
- [Lambda & DLQ](./legacy-aws/LAMBDA_CONCURRENCY_DLQ.md) — Lambda concurrency settings, dead letter queues

## For AI Agents
- [AGENTS.md](../AGENTS.md) — **start here.** Canonical guide: architecture, non-negotiable invariants, Definition of Done, and scaling patterns for building on top of this backend.
- Per-domain pattern enforcement lives in `../.cursor/rules/` — note `infrastructure.mdc` and the Lambda-specific parts predate the migration; AGENTS.md wins on conflict.
