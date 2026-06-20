# Data Retention Policy

**Last updated:** June 2026
**Runtime:** Cloudflare Workers, Neon Postgres, Cloudflare R2, Cloudflare Queues

This document describes the current Cloudflare stack. Legacy AWS retention notes live
under `docs/legacy-aws/` and are not operational guidance for this branch.

## Retention Summary

| Data | Retention | Enforcement | Status |
|---|---:|---|---|
| Application audit logs | 7 years | Postgres trigger blocks updates and in-window deletes; daily cron prunes expired rows | Implemented |
| Idempotency keys | 7 days | Daily Cloudflare Cron Trigger janitor | Implemented |
| WorkOS webhook DLQ messages | Cloudflare Queue retention | Cloudflare Queues `max_retries = 5` routes permanent failures to DLQ consumer | Implemented |
| `WEBHOOK_FAILED` audit rows | 7 years | Same audit-log retention and immutability rules | Implemented |
| Workers request logs | Cloudflare dashboard retention window | Cloudflare Workers Logs via `[observability] enabled` | Enabled |
| Cloudflare account audit logs | Cloudflare platform retention | Cloudflare dashboard/API audit log | Built in |
| R2 media objects | Until deleted by user/application | Application delete path or manual/admin cleanup | Application-owned |
| Raw long-term request logs | Not retained by this repo | Optional Logpush to R2/external sink, plan-dependent | Optional |

## Application Audit Logs

Audit logs are the primary compliance record. They are stored in Postgres, redacted for
secret-looking keys, and written through `src/node/lib/audit.ts`.

Controls:

- `audit_logs` rows are append-only during the 7-year window.
- Database constraints pin action/resource/status values.
- A daily Cloudflare Cron Trigger calls the audit-retention job.
- Failed audit writes emit a structured log line and Sentry exception.
- Mutations call `logAudit()` and request middleware drains in-flight audit writes before
  the response completes.

Operational checks:

```sql
select count(*) from audit_logs;

select id, timestamp, action, resource_type, resource_id, status
from audit_logs
order by timestamp desc
limit 50;
```

## Idempotency Keys

The `idempotency_keys` table deduplicates critical mutations and webhook processing.
Expired keys are removed by the daily janitor cron (`src/node/handlers/utils/janitor.ts`).

The cleanup is intentionally independent from deploys. If the janitor fails, request
correctness remains intact; storage grows until the job is repaired.

## Webhook Failures and DLQ

WorkOS webhooks are verified at `POST /v1/webhooks/workos`, queued, and processed by
Cloudflare Queues. After repeated processing failure, Cloudflare routes the message to
the dead-letter queue.

The DLQ consumer:

- reports a Sentry exception,
- writes a durable `WEBHOOK_FAILED` audit row,
- acknowledges the dead-lettered message only after the audit/alert path succeeds.

Runbook: [runbooks/WEBHOOK_DLQ.md](./runbooks/WEBHOOK_DLQ.md).

## Platform Logs

Workers Logs are enabled in `wrangler.toml`:

```toml
[observability]
enabled = true
```

Workers Logs are for operational debugging, not the long-term compliance source of
truth. For long-term raw request-log retention, configure Cloudflare Logpush to R2 or an
external sink outside this repo.

Cloudflare Account Audit Logs provide the infrastructure/account-change trail for
deploys, tokens, R2, queues, and secrets. Review them in the Cloudflare dashboard during
incident response and access reviews.

## User and Media Data

User data is retained until deleted by the application owner/user workflow. Audit logs
may retain user identifiers and forensic context for 7 years, even after operational
records are deleted.

Media objects in R2 are retained until deleted. If a product requires GDPR/CCPA-grade
erasure, add a documented anonymization/deletion flow that covers:

- application rows,
- R2 objects,
- WorkOS identity references,
- audit-log minimization strategy for immutable records.

## Open Compliance Follow-ups

- Configure and screenshot Sentry alert rules for audit write failures and webhook DLQ
  failures.
- Decide whether raw request logs need long-term retention; if yes, configure Logpush.
- Document user deletion/export workflows before entering regulated markets.
- Add a periodic access-review checklist for Cloudflare, Neon, WorkOS, Sentry, and GitHub.

## Review Cadence

Review this policy at least annually and whenever the data model, logging strategy, or
target market changes.
