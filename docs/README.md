# Documentation

## Architecture
- [Architecture & Rationale](./ARCHITECTURE.md) — why this stack (Cloudflare Workers + Hono + Neon), cost/performance posture, and one-person maintainability principles

## Setup & Operations
- [Launch a New Project](./guides/LAUNCH_NEW_PROJECT.md) — **start here for a new project.** Linear walkthrough: scaffold → local → staging → production → custom domain, and where every credential goes.
- [Cloudflare Setup](./CLOUDFLARE_SETUP.md) — reference: local dev (`wrangler dev --local`), migrations, tests, secrets, deploys, R2/Hyperdrive
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) — wrangler `[vars]`, secrets, `.dev.vars`, `.env.*` files
- [Webhook/DLQ Runbook](./runbooks/WEBHOOK_DLQ.md) — Queue failure alerts, triage, replay, and acknowledgement policy

## Security & Compliance
- [Security Model](./SECURITY.md) — Auth, CORS, edge protection, error masking
- [Audit Logging](./AUDIT_LOGGING_GUIDE.md) — Audit trail patterns and integration
- [Data Retention](./DATA_RETENTION_POLICY.md) — Retention policies per data type
- [SOC 2 Checklist](./SOC2_READINESS_CHECKLIST.md) — Compliance readiness tracker

## Development
- [Testing Guide](./guides/TESTING.md) — Unit + integration testing
- [Handler Templates](../templates/README.md) — Current Hono route templates and endpoint patterns

## For AI Agents
- [AGENTS.md](../AGENTS.md) — **start here.** Canonical guide: architecture, non-negotiable invariants, Definition of Done, and scaling patterns for building on top of this backend.
- Per-domain pattern enforcement lives in `../.cursor/rules/` (Cloudflare-native since the migration); AGENTS.md wins on conflict.
