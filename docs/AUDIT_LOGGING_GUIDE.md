# Audit Logging Guide

**Last updated:** June 2026
**Primary files:** `src/node/lib/audit.ts`, `src/node/db/schema/audit.ts`,
`src/node/handlers/utils/audit-retention.ts`

The audit system is the application-level compliance trail. It records mutations and
security-relevant events, redacts secrets by key name, drains fire-and-forget writes
before responses complete, and keeps rows immutable for the 7-year retention window.

## What Gets Logged

Implemented coverage:

- user/profile mutations through REST and GraphQL,
- organization and membership mutations,
- invite accept/decline lifecycle,
- WorkOS provisioning events,
- GraphQL media upload URL creation,
- direct media uploads,
- auth/access-denied events,
- permanent WorkOS webhook failures from the DLQ consumer.

Do not log ordinary reads or health checks. They are too noisy for the compliance trail.

## Stored Fields

Each row can include:

- `userId`
- `organizationId`
- `action`
- `resourceType`
- `resourceId`
- `changes`
- `metadata`
- `ipAddress`
- `userAgent`
- `requestId`
- `status`
- `errorMessage`
- `timestamp`

Secrets are redacted from `changes` and `metadata` before persistence. PII such as email
and names may be retained intentionally for forensics, so avoid placing extra free-form
PII in metadata.

## REST Pattern

REST route handlers should validate, sanitize, perform the write, then fire-and-forget
the audit entry. The app middleware drains audit writes after the handler returns.

```typescript
void logAudit({
  userId,
  organizationId,
  action: AUDIT_ACTIONS.UPDATE,
  resourceType: AUDIT_RESOURCE_TYPES.USER,
  resourceId: userId,
  changes: { before, after },
  ...extractRequestContext({
    requestId: c.get("requestId"),
    sourceIp: c.req.header("cf-connecting-ip"),
    userAgent: c.req.header("user-agent"),
  }),
  status: AUDIT_STATUS.SUCCESS,
  metadata: {
    source: "rest",
    handler: "users/update",
  },
});
```

## GraphQL Pattern

For simple mutations, use `auditResolver()`. For multi-step mutations, write explicit
`logAudit()` calls so the resource ids and change payloads stay accurate.

```typescript
updateProfile: auditResolver(
  async (_parent, args, context) => {
    const validated = profileUpdateSchema.parse(args.input);
    const sanitized = sanitizeObject(validated);
    const [updated] = await context.db
      .update(profiles)
      .set(sanitized)
      .where(eq(profiles.userId, context.userId))
      .returning();
    return updated;
  },
  {
    action: AUDIT_ACTIONS.UPDATE,
    resourceType: AUDIT_RESOURCE_TYPES.PROFILE,
    getResourceId: (result) => result.id,
    getChanges: (result) => ({ after: result }),
  },
)
```

## Actions and Resource Types

Use the exported enums from `src/node/db/schema/audit.ts`:

- `AUDIT_ACTIONS`
- `AUDIT_RESOURCE_TYPES`
- `AUDIT_STATUS`

Do not invent string literals in route or resolver code.

## Immutability and Retention

The database is the enforcement boundary:

- `UPDATE` is rejected for audit rows.
- `DELETE` is blocked inside the 7-year retention window.
- enum-like fields are constrained at the database layer.
- the daily audit-retention cron prunes expired rows.

The retention job is registered in `src/node/cron.ts` and scheduled in `wrangler.toml`.

## Failure Behavior

Audit writes must never break the user-facing mutation. On failure, `logAudit()`:

- logs a stable structured error,
- captures an exception in Sentry when enabled,
- resolves without throwing to the caller.

This keeps the hot path available while still producing an alertable failure signal.

## Querying

Use the role-gated GraphQL audit query for product/admin access. For direct operational
inspection:

```sql
select id, timestamp, user_id, organization_id, action, resource_type, resource_id, status
from audit_logs
order by timestamp desc
limit 100;
```

Webhook DLQ failures:

```sql
select id, timestamp, resource_id, error_message, metadata
from audit_logs
where action = 'WEBHOOK_FAILED'
order by timestamp desc
limit 50;
```

## Open Follow-ups

- Add cursor pagination to the `auditLogs` query.
- Add value-pattern redaction for obvious token formats, not only key-name redaction.
- Define the GDPR/CCPA erasure/anonymization story for immutable audit rows.
- Capture dashboard evidence for Sentry alert rules and Cloudflare notifications.
