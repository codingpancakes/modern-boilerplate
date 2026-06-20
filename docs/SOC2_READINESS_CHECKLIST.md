# SOC 2 Readiness Checklist

**Last updated:** June 2026
**Runtime:** Cloudflare Workers, Neon Postgres, Cloudflare R2, Cloudflare Queues,
WorkOS, Sentry

This is a readiness tracker, not a certification claim. The codebase now has strong
application controls; the remaining work is mostly dashboard evidence, operating
procedures, and third-party validation.

## Current Assessment

Overall readiness: **high for an engineering boilerplate, not audit-ready by itself**.

Code-backed controls are largely present:

- WorkOS JWT authentication with RS256 pinning and deployed-environment fail-closed
  audience binding.
- Route-level auth for protected REST and GraphQL surfaces.
- Zod validation and bounded sanitization before writes.
- Drizzle parameterized queries.
- Per-request database lifecycle for Workers I/O isolation.
- DB-backed idempotency for critical paths and webhooks.
- Immutable, redacted, 7-year audit trail.
- Cloudflare Queues DLQ for WorkOS webhook processing failures.
- Sentry error capture hook.
- Health-gated gradual deploy with auto-rollback.
- GitHub Actions gate with runtime dependency audit, lint, typecheck, OpenAPI drift
  check, unit tests, and real-Postgres integration tests.
- `staging` and `main` branch/environment mapping with protected deploy branches.

## Control Map

| Area | Current control | Evidence |
|---|---|---|
| Authentication | WorkOS JWT verification, RS256, JWKS cache, `client_id` binding | `src/node/authorizers/verify-token.ts`, tests |
| Authorization | Protected route mounting and org membership checks | `src/node/routes/index.ts`, GraphQL resolvers |
| Input safety | Zod validation, sanitizer depth cap, content-type checks | `src/node/lib/validation/`, `src/node/lib/sanitize.ts` |
| SQL safety | Drizzle ORM and migrations | `src/node/db/` |
| Audit trail | Immutable `audit_logs`, redaction, request context, retention cron | `docs/AUDIT_LOGGING_GUIDE.md` |
| Change management | Protected `staging`/`main`, CI gate, production environment approval | `.github/workflows/ci.yml`, GitHub settings |
| Deployment safety | Canary, health probes, smoke checks, rollback | `scripts/deploy.ts` |
| Incident visibility | Sentry capture and Workers Logs | `src/node/lib/sentry.ts`, `wrangler.toml` |
| Async durability | Cloudflare Queues retries and DLQ audit row | `src/node/queue.ts`, `docs/runbooks/WEBHOOK_DLQ.md` |
| Data retention | Audit retention and idempotency janitor cron jobs | `docs/DATA_RETENTION_POLICY.md`, `src/node/cron.ts` |

## Required Before Real SOC 2 Work

- Create and document Sentry alert rules for app errors, audit write failures, and
  webhook permanent failures.
- Configure Cloudflare notifications for Worker errors and queue backlog/delivery
  failures where available.
- Capture Cloudflare Account Audit Log evidence and access-review screenshots.
- Decide whether raw request-log retention is required; configure Logpush if it is.
- Write a short incident response plan with severity levels, owners, containment,
  recovery, and notification rules.
- Write access review procedures for GitHub, Cloudflare, Neon, WorkOS, and Sentry.
- Write vendor/subprocessor inventory and data-flow notes.
- Define user deletion/export/anonymization flows before GDPR/CCPA markets.
- Run a light staging load test and record results.
- Schedule an external penetration test before a serious launch.

## Production Readiness Checks

Before a production launch:

- `pnpm check`
- `pnpm test:integration:local`
- `pnpm docs:check`
- `pnpm audit --prod --audit-level=high`
- `pnpm audit --audit-level=high`
- staging deploy from `staging` branch succeeds
- production deploy from `main` waits for approval, then succeeds after approval
- `/v1/health/detailed` reports healthy
- smoke checks cover auth 401, GraphQL 401, webhook signature 401, and CORS preflight
- WorkOS webhook replay succeeds on staging
- DLQ runbook has been exercised with a controlled failure or test event
- Sentry receives errors and alert rules notify the intended channel/person

## Evidence To Keep

- GitHub Actions run links for release gates.
- GitHub branch protection and environment approval screenshots.
- Cloudflare deployment logs and Account Audit Log screenshots.
- Neon backup/PITR settings.
- Sentry alert rule screenshots.
- WorkOS auth/webhook configuration screenshots.
- Database migration history.
- Load-test output and interpretation.
- Incident-response tabletop notes.

## Known Gaps

- Dashboard-side alerts are referenced by docs but not proven in the repo.
- Logpush is optional and not configured by this repo.
- Audit-log query pagination is limit-only.
- Value-pattern redaction is not implemented; redaction is key-name based.
- GDPR/CCPA erasure strategy for immutable audit records is not finalized.
- No external penetration test evidence is checked in.
