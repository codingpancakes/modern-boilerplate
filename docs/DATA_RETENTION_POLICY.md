# Data Retention Policy

**Last updated:** July 2026
**Runtime:** Cloudflare Workers, Neon Postgres, Cloudflare R2, Cloudflare Queues

This document describes the current production retention model.

## Retention Summary

| Data | Retention | Enforcement | Status |
|---|---:|---|---|
| Application audit logs | 7 years | Postgres trigger blocks updates and in-window deletes; daily cron prunes expired rows | Implemented |
| Idempotency keys | 24 hours (HTTP mutations) / 7 days (webhook events) | Daily Cloudflare Cron Trigger janitor deletes expired rows | Implemented |
| WorkOS webhook DLQ messages | Normally consumed after durable failure recording; otherwise bounded by the DLQ consumer's retry budget and Cloudflare retention | Main consumer routes after `max_retries = 5`; DLQ consumer retries audit persistence up to 100 times with a 15-minute delay | Implemented, alert-dependent |
| `WEBHOOK_FAILED` audit rows | 7 years | Same audit-log retention and immutability rules | Implemented |
| Workers request logs | Cloudflare dashboard retention window | Cloudflare Workers Logs via `[observability] enabled` | Enabled |
| Cloudflare account audit logs | Cloudflare platform retention | Cloudflare dashboard/API audit log | Built in |
| R2 media objects | Indefinite until manually/admin deleted | No application delete endpoint exists today | Operational gap |
| Raw long-term request logs | Not retained by this repo | Optional Logpush to R2/external sink, plan-dependent | Optional |

## Application Audit Logs

Audit logs are the primary compliance record. They are stored in Postgres, redacted for
secret-looking keys, and written through `src/node/lib/audit.ts`.

Controls:

- `audit_logs` rows are append-only during the 7-year window.
- Database constraints pin action/resource/status values.
- A daily Cloudflare Cron Trigger calls the audit-retention job.
- Failed audit writes emit a structured log line and Sentry exception.
- Request-path domain mutations call `logAudit()` and middleware drains
  in-flight writes before the response completes. Transactional provisioning
  uses `writeAuditLog(tx, ...)`; terminal DLQ handling uses `logAuditStrict()`.

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
HTTP-mutation keys expire after 24 hours (`lib/idempotency.ts` default TTL); webhook
event keys after 7 days (`lib/services/webhook-processor.ts`). Expired keys are
removed by the daily janitor cron (`src/node/handlers/utils/janitor.ts`).

The cleanup is intentionally independent from deploys. If the janitor fails, request
correctness remains intact; storage grows until the job is repaired.

## Webhook Failures and DLQ

WorkOS webhooks are verified at `POST /v1/webhooks/workos`, queued, and processed by
Cloudflare Queues. After repeated processing failure, Cloudflare routes the message to
the dead-letter queue.

The configured DLQ consumer normally drains failures immediately. It:

- reports a Sentry exception,
- writes a durable `WEBHOOK_FAILED` audit row,
- acknowledges the dead-lettered message only after the audit/alert path succeeds.

If durable audit persistence fails, the DLQ consumer requests retry. The
deployed configuration allows up to 100 retries with a 15-minute default retry
delay. That is deliberately long but still bounded: because the DLQ consumer
has no downstream DLQ, Cloudflare eventually discards a repeatedly failing
message after its retry/retention limits. Sentry is flushed before the audit
attempt and Workers Logs record retry failures, so paging and operator response
are part of this control. Temporary queue storage is not the compliance record.

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

Media objects in R2 are retained indefinitely today: this repository has upload
and list flows but no application delete endpoint. Manual/admin deletion is the
only current removal path. If a product requires GDPR/CCPA-grade erasure, add a
documented anonymization/deletion flow that covers:

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
