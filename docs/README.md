# Documentation

## Direction
- [North Star](./direction/NORTH_STAR.md) — **where this backend is going:** Cloudflare Workers + Hono + Neon, one-person maintainable, optimized for price and performance
- [Migration Plan](./direction/MIGRATION_PLAN.md) — phased path from the current AWS/CDK stack (route-by-route, ~3–4 weeks)
- [Audit (June 2026)](./direction/AUDIT_2026-06.md) — verified audit of the current stack: 8.5/10, findings, and false positives dismissed

> The docs below describe the **current AWS/CDK stack** — accurate until the migration lands.

## Setup & Operations
- [Setup Guide](./BOILERPLATE_SETUP.md) — First-time project setup from zero
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) — All env vars, secrets, SSM params
- [CDK Teardown](./guides/CDK_TEARDOWN.md) — How to destroy AWS stacks
- [Lambda & DLQ](./LAMBDA_CONCURRENCY_DLQ.md) — Concurrency settings, dead letter queues

## Security & Compliance
- [Security Model](./SECURITY.md) — Auth, CORS, WAF, origin verification, blue-green deploys, error masking
- [Audit Logging](./AUDIT_LOGGING_GUIDE.md) — Audit trail patterns and integration
- [Data Retention](./DATA_RETENTION_POLICY.md) — Retention policies per data type
- [SOC 2 Checklist](./SOC2_READINESS_CHECKLIST.md) — Compliance readiness tracker

## Development
- [Testing Guide](./guides/TESTING.md) — Unit + integration testing
- [Handler Templates](../templates/README.md) — How to create new handlers
- [Python Handlers](../src/python/README.md) — Python Lambda guide

## For AI Agents
- [AGENTS.md](../AGENTS.md) — **start here.** Canonical guide: architecture, non-negotiable invariants, Definition of Done, and scaling patterns for building on top of this backend.
- Per-domain pattern enforcement lives in `../.cursor/rules/` (`backend-core`, `handlers`, `graphql`, `infrastructure`, `validation-security`, `testing`, `scaling-quality`).
