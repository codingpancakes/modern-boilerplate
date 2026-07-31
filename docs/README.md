# Documentation

## Agent handbook

Task-routed implementation guidance lives in [`agents/README.md`](agents/README.md).
Start with root [`AGENTS.md`](../AGENTS.md), then read every playbook matching
the change. The handbook covers feature structure, authorization boundaries,
database concurrency, testing evidence, and Cloudflare operations.
Use the [canonical feature-request template](./agents/FEATURE_REQUEST_TEMPLATE.md)
to describe new schema and API behavior without repeating implementation rules.

## Architecture

- [North Star](./direction/NORTH_STAR.md) — current architecture, security
  posture, deliberate limits, and evolution principles

## Setup & Operations
- [Launch a New Project](./guides/LAUNCH_NEW_PROJECT.md) — **start here for a new project.** Linear walkthrough: scaffold → local → staging → production → custom domain, and where every credential goes.
- [Cloudflare Setup](./CLOUDFLARE_SETUP.md) — local dev, migrations, tests, secrets, deploys, R2, Queues, and rate limiting
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) — wrangler `[vars]`, secrets, `.dev.vars`, `.env.*` files
- [Webhook/DLQ Runbook](./runbooks/WEBHOOK_DLQ.md) — Queue failure alerts, triage, replay, and acknowledgement policy

## Security & Compliance
- [Security Model](./SECURITY.md) — Auth, CORS, edge protection, error masking
- [Audit Logging](./AUDIT_LOGGING_GUIDE.md) — Audit trail patterns and integration
- [Data Retention](./DATA_RETENTION_POLICY.md) — Retention policies per data type
- [SOC 2 Checklist](./SOC2_READINESS_CHECKLIST.md) — Compliance readiness tracker

## Development
- [Testing Guide](./guides/TESTING.md) — Unit + integration testing
- [Canonical Code Patterns](./agents/CANONICAL_CODE_PATTERNS.md) — copy-safe shapes for WorkOS auth, authorization, mutations, and background work
- [Canonical Feature Request](./agents/FEATURE_REQUEST_TEMPLATE.md) — autonomous defaults for one-sentence schema, query, and mutation requests
- [Handler Templates](../templates/README.md) — Current Hono route templates and endpoint patterns

## For AI Agents
- [AGENTS.md](../AGENTS.md) — **start here.** Canonical guide: architecture, non-negotiable invariants, Definition of Done, and scaling patterns for building on top of this backend.
- [Agent Handbook](./agents/README.md) — task routing and focused playbooks.
- `.cursor/rules/project.mdc` is only a router to these canonical instructions;
  it intentionally duplicates no patterns.
