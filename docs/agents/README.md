# Agent Handbook

This directory turns the repository-wide contract in [`AGENTS.md`](../../AGENTS.md)
into task-specific playbooks. It is intentionally small: agents should load the
rules relevant to the change, not ingest every document and improvise from a
blurred context.

## Instruction precedence

When instructions disagree, use this order:

1. The current user request.
2. Root [`AGENTS.md`](../../AGENTS.md).
3. The task-specific playbooks in this directory.
4. Current source code and tests as implementation evidence.

Code and tests show the current implementation, but they do not overrule an
explicit invariant. If implementation and documentation disagree, stop and
resolve the discrepancy instead of silently copying either one.

## What to read

| Change touches | Required reading |
| --- | --- |
| Scoping a new schema, domain, or API from product requirements | [`FEATURE_REQUEST_TEMPLATE.md`](FEATURE_REQUEST_TEMPLATE.md) |
| Any new endpoint, resolver, service, or domain | [`FEATURE_WORKFLOW.md`](FEATURE_WORKFLOW.md) |
| Copying an implementation shape, including WorkOS auth | [`CANONICAL_CODE_PATTERNS.md`](CANONICAL_CODE_PATTERNS.md) |
| Authentication, roles, organizations, memberships, invitations, or PII | [`AUTHORIZATION_AND_DATA_BOUNDARIES.md`](AUTHORIZATION_AND_DATA_BOUNDARIES.md) |
| Schema, migrations, transactions, idempotency, or concurrent writes | [`DATABASE_AND_CONCURRENCY.md`](DATABASE_AND_CONCURRENCY.md) |
| Tests, review, CI, or completion claims | [`TESTING_AND_VERIFICATION.md`](TESTING_AND_VERIFICATION.md) |
| Bindings, secrets, queues, cron, health checks, or deploys | [`OPERATIONS_AND_BINDINGS.md`](OPERATIONS_AND_BINDINGS.md) |

Read every row that applies. A feature that adds an org-owned mutation and a
column, for example, requires the request contract, feature, authorization,
database, and testing playbooks.

## Reliable source anchors

Use these before inventing a new pattern:

- HTTP composition and error boundary: `src/node/app.ts`
- Route mounting and authentication: `src/node/routes/index.ts`
- Thin REST mutation: `src/node/routes/users.ts`
- Business logic and org authorization: `src/node/lib/services/organizations.ts`
- Transactional idempotency: `src/node/lib/hono/idempotent-response.ts`
- Audit buffering and redaction: `src/node/lib/audit.ts`
- Per-request database lifecycle: `src/node/lib/db.ts`
- GraphQL context, limits, and resolver merge: `src/node/handlers/graphql/`
- Cron dispatch: `src/node/cron.ts`
- Durable queue processing: `src/node/queue.ts`
- Worker bindings and entry points: `src/node/worker.ts`

## Working discipline

Before editing:

- Read the whole target file and its nearest test.
- Inspect `git status` and preserve unrelated work.
- State the trust boundary, transaction boundary, and failure behavior.
- Search for the repository helper before adding an abstraction.

While editing:

- Keep dependencies inward. Routes/resolvers may contain small scoped reads, but
  shared rules, authorization, and mutation workflows belong in services.
- Make the smallest coherent change; do not mix opportunistic refactors into a
  feature patch.
- Update tests and generated documentation in the same change.
- Treat comments as contracts: explain why a constraint exists, not what the
  syntax already says.

Before handing off:

- Run the verification required by
  [`TESTING_AND_VERIFICATION.md`](TESTING_AND_VERIFICATION.md).
- Report commands and outcomes. Never claim a check passed if it was not run.
- List remaining risks or explicitly say none are known.
- Update these playbooks when a canonical pattern changes.
