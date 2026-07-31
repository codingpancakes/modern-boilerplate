# North Star

## Goal

A production backend that one person can own end to end without sacrificing
security, correctness, or operational safety.

Every architectural choice must reduce maintenance burden while preserving the
repository invariants in [`AGENTS.md`](../../AGENTS.md).

## Current architecture

| Layer | Standard |
| --- | --- |
| Runtime | One Cloudflare Worker |
| HTTP | Hono, serving REST and GraphQL |
| GraphQL | GraphQL Yoga with request-scoped DataLoaders and query limits |
| Database | Neon Postgres through Drizzle and `@neondatabase/serverless` |
| Authentication | WorkOS JWT through the shared RS256-pinned verifier |
| Authorization | Database-backed ownership, active membership, and role checks |
| Media | Cloudflare R2 with validated presigned-upload flows |
| Async work | Cloudflare Queues with retry and dead-letter handling |
| Scheduled work | Cloudflare Cron Triggers |
| Observability | Structured logs, Sentry, health endpoints, immutable audit trail |
| Deployment | GitHub Actions and health-gated gradual Wrangler deployments |
| Secrets | `.dev.vars` locally and Wrangler secrets when deployed |
| Validation | Bounded Zod schemas followed by persistence sanitization |
| Tests | Vitest unit tests and real-Postgres integration tests |

This table describes what exists now. It is not a migration target.

## Architectural principles

1. **One runtime path.** Local development executes the same Worker application
   and routing tree as deployed environments.
2. **Inward dependencies.** Routes/resolvers orchestrate; shared rules and
   mutation workflows live in services; persistence stays behind Drizzle/schema
   modules. A small scoped read may remain in a thin route or resolver.
3. **One trust boundary.** `requireAuth()` is the only source of verified WorkOS
   claims.
4. **Database-backed authorization.** Token claims identify the caller; current
   ownership, membership, and roles come from the database.
5. **Retry-safe writes.** Transactions, constraints, idempotency, locks, and
   conditional updates close concurrency races.
6. **Fail closed when deployed.** Missing security or durability bindings are
   service failures, not permission to run weakened.
7. **Audit every domain mutation.** Request audits are drained before response
   completion; transactional/background paths use stricter audit helpers. Stored
   audit data is redacted, immutable, and retained by policy.
8. **Platform primitives over custom infrastructure.** Use Worker bindings,
   Queues, Cron Triggers, R2, and platform edge controls where they fit.
9. **Measured evolution.** Do not add infrastructure or abstractions for a
   hypothetical future problem.
10. **Documentation changes with code.** A canonical pattern and its playbook
    are updated in the same patch as the implementation.

## Security posture

The application security baseline includes:

- WorkOS RS256 signature verification, issuer checking, expiry validation, and
  fail-closed `client_id` application binding;
- resource-level authorization with the `ACTIVE` membership consent boundary;
- bounded validation and depth-bounded sanitization;
- parameterized Drizzle queries and real-Postgres constraint/concurrency tests;
- constant-time secret and signature comparisons;
- per-IP application rate limiting plus Cloudflare edge protections;
- error masking, structured Sentry reporting, and secret-redacted audit events;
- durable webhook verification, idempotent processing, retries, and DLQ
  handling;
- health-gated deployments with automatic rollback.

Security also depends on operational controls outside this repository:
Cloudflare zone rules, provider access reviews, alert delivery, WorkOS session
configuration, Neon backups, and incident-response practice. Track those in
[`SOC2_READINESS_CHECKLIST.md`](../SOC2_READINESS_CHECKLIST.md).

## Deliberate limits

- Worker memory and CPU limits make heavy media transformation and large batch
  processing inappropriate for request handlers.
- Stateless WorkOS access tokens remain valid until expiration after session
  revocation. Keep token duration short; add a `sid` denylist only when the
  product requires faster revocation.
- Raw request-log archival is an operational choice; the application audit
  trail is not a substitute for every platform log.
- New database proxies, caches, providers, and services require measured need,
  an explicit design, failure semantics, and tests.

## Change test

Before accepting a new subsystem, answer:

- Which current problem does it solve?
- Which invariant owns it?
- What is its trust boundary?
- How does it fail?
- How is it retried or rolled back?
- How is it observed?
- What must a future maintainer remember?

If those answers are unclear, the subsystem is not ready.
