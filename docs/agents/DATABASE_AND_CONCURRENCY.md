# Database and Concurrency

Use this playbook for schema changes, migrations, idempotency, multi-step
writes, counters, invitations, provisioning, and any operation that can race.

## Database lifecycle

Always `await getDb()`. HTTP requests use `dbScope()`; cron and queue work use
the explicit scoped helpers. Never cache a Neon pool, client, transaction, or
query result at module scope.

Application code uses Drizzle ORM. Never concatenate or execute raw SQL strings.
A parameterized Drizzle `sql` fragment is permitted only when no typed Drizzle
primitive exists, the database feature enforces a real invariant, the exception
is documented locally, and a real-Postgres test proves it. DDL belongs in
migrations.

## Migration policy: expand, migrate, contract

Code and migrations deploy separately. Every release must tolerate both:

- old code running against the new schema; and
- rolled-back old code continuing against that schema.

Use separate releases:

1. **Expand:** add nullable/defaulted columns, new tables, or compatible indexes.
2. **Migrate:** deploy dual-read/dual-write code if needed and backfill in
   bounded, restartable batches.
3. **Contract:** only after old code can no longer run, remove the legacy path
   in a later release.

Do not rename in place, drop a live column, tighten nullability without a
completed backfill, or introduce a required column with no compatible default.
Generated Drizzle migration metadata must be committed with the SQL.

## Choose the concurrency mechanism

| Situation | Required mechanism |
| --- | --- |
| Several writes must succeed together | One `db.transaction(...)` |
| Same REST mutation may be retried | `withTransactionalIdempotentJson(...)` |
| Create-if-absent under concurrency | Unique constraint plus atomic upsert |
| Read-check-write on an existing row | Transaction plus row lock or atomic conditional update |
| State transition | Conditional update on the expected old state; verify a row returned |
| Counter/quota | Atomic database expression or locked row, never read-modify-write in memory |
| Queue/webhook redelivery | Durable event idempotency record and retry-safe transaction |

A transaction gives atomicity, not automatic race safety. If two transactions
can both observe the same precondition, add a constraint, lock, or conditional
write.

Never implement idempotency or uniqueness as `SELECT` followed by `INSERT`.

## Transaction rules

- Pass the transaction handle through every service participating in the unit
  of work.
- Do not call `getDb()` again inside the transaction callback.
- Keep external network calls outside a database transaction when possible.
- Null-guard `.returning()` results.
- Decide whether the audit event describes a committed result. For the
  transactional idempotency helper, stage the response and mutation in the same
  transaction; request-level audit flushing handles the detached audit write.
- Throw to roll back. Do not swallow a transaction error and return success.

## Testing database behavior

Mocks can prove orchestration, but they cannot prove isolation, locking,
constraints, rollback, or transaction-driver support. Those behaviors require
the real-Postgres Vitest suite.

For concurrency-sensitive changes, test:

- two or more operations released at the same barrier;
- the final persisted state;
- exact success/failure counts;
- absence of partial writes;
- safe retry after failure;
- database constraint behavior, not just returned values.

Keep the driver guard in `tests/unit/lib/db.test.ts`: replacing
`neon-serverless` with the HTTP driver breaks interactive transactions at
runtime.

## Review checklist

- [ ] Migration is compatible one release backward and forward.
- [ ] Every user/provider-controlled domain value is sanitized before a write;
      internal control rows use typed constructed values and their dedicated helpers.
- [ ] Multi-step writes use one passed transaction handle.
- [ ] A database primitive closes every check-then-act race.
- [ ] Idempotency response and mutation commit together.
- [ ] Constraints express invariants that must survive all callers.
- [ ] Real-Postgres tests cover rollback and concurrency where applicable.
