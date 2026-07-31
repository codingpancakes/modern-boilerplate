# Canonical Feature Request

This is the autonomous execution contract for extending the backend. A
requester should be able to describe a feature in one sentence and rely on this
document for the implementation standard.

## How to invoke it

Use one sentence:

```md
Create <feature and essential fields/behavior>. Follow the canonical feature
request.
```

Examples:

```md
Create organization-owned projects with a required name and optional
description, with protected list, get, create, and update endpoints. Follow the
canonical feature request.
```

```md
Add a self-service user preference for interface locale and expose protected
read and update operations. Follow the canonical feature request.
```

The requester does **not** need to restate repository architecture, WorkOS
authentication, authorization mechanics, Zod, sanitization, Drizzle,
transactions, idempotency, audit, migrations, tests, OpenAPI, file placement,
or verification commands. This contract and the linked playbooks own those
decisions.

## Agent mandate

When a request invokes this contract, the agent must:

1. Read [`AGENTS.md`](../../AGENTS.md) and every applicable playbook in this
   directory.
2. Inspect the current working tree and preserve unrelated changes.
3. Trace the nearest complete sibling from schema through public surface and
   tests.
4. Turn the short product request into the smallest coherent end-to-end
   implementation.
5. Apply the defaults below wherever the requester did not specify a different
   behavior.
6. Implement without asking about routine technical decisions already answered
   by the repository.
7. Stop only when a missing product decision cannot be resolved safely by these
   defaults and would materially change ownership, exposure, destructive
   behavior, financial meaning, or external infrastructure.
8. Complete verification and report exact evidence and remaining risks.

## Safe defaults for short requests

These defaults apply unless the requester says otherwise.

### Surface and exposure

- New application data is **protected**, never public by accident.
- Use REST for a requested endpoint unless GraphQL or both surfaces are named.
- Mount protected REST domains through `requireAuth()` in the route barrel.
- Provide only the operations implied by the request. “Read and write” means
  list/get/create/update; it does not imply hard delete.
- Lists use the existing bounded keyset-pagination pattern.
- REST changes include OpenAPI updates.

### Ownership and authorization

- “User-owned” or “my” data is scoped to the authenticated user. A caller may
  not supply another user ID to escape that scope.
- “Organization-owned” data requires current `ACTIVE` membership.
- For organization-owned data, `ACTIVE` members may read and `OWNER`/`ADMIN`
  may write by default. Broader member writes require an explicit product rule.
- Ownership and membership are enforced in the service/query, not inferred
  after fetching a broad row.
- Cross-user and cross-organization access is denied and tested.
- Authentication and resource authorization remain separate checks.

If ownership cannot be inferred from the request or existing domain, ask one
concise ownership question instead of inventing public or shared access.

### Schema and API

- Use UUID primary and foreign keys, database timestamps, explicit ownership
  relationships, and indexes matching actual query shapes.
- Bound every string, array, object, filter, and pagination input.
- Required/optional behavior follows the request and nearest domain sibling.
- Do not invent hard deletion. If lifecycle behavior was not requested, omit
  delete/archive operations.
- Use an expand/contract-safe generated migration.
- Keep API response and error shapes consistent with the existing surface.

### Writes and durability

- Persist user/provider-controlled values only after validation and
  sanitization.
- Put reusable authorization, business rules, state transitions, and mutation
  workflows in a domain service; keep routes/resolvers thin.
- Use a transaction for related writes and invariants.
- Apply transactional idempotency to retryable, non-idempotent REST mutations.
- Audit every domain mutation with the helper appropriate to its durability
  boundary.
- Null-guard database results and throw through canonical error factories.
- Use queues or cron only when the requested behavior genuinely requires
  asynchronous or scheduled work.

### Code quality

- Copy the nearest complete pattern before creating an abstraction.
- Do not add a generic repository, base service, wrapper, or catch-all helper
  for one consumer.
- Do not add dependencies when existing code or platform primitives suffice.
- Do not perform opportunistic refactors, broad formatting, or unrelated
  cleanup.
- Do not leave unused exports, commented-out code, placeholder TODOs,
  compatibility shims, or half-wired layers.
- Update a canonical playbook in the same patch if the canonical pattern
  genuinely changes.

### Tests and completion

- Cover happy path, unauthenticated, unauthorized, cross-owner, invalid-input,
  missing-row, dependency-failure, and audit behavior where applicable.
- Cover idempotent replay, rollback, constraints, and concurrency where the
  behavior can race or partially commit.
- Use real Postgres for migrations, transactions, constraints, locks, and
  concurrency claims.
- Update generated REST or GraphQL contracts.
- Run every applicable command in
  [`TESTING_AND_VERIFICATION.md`](TESTING_AND_VERIFICATION.md).
- Review the final diff for duplication, dead code, unnecessary abstractions,
  inconsistent naming, stale documentation, weakened tests, and unrelated
  changes.
- Report files changed, important decisions, exact checks/results, and any
  remaining risk.

## When the agent may ask a question

Do not pause for file names, helper selection, validation mechanics, endpoint
mounting, migration commands, audit plumbing, test placement, or other
repository-owned choices.

Ask only when no safe default above resolves a consequential ambiguity, such
as:

- ownership cannot be determined;
- the request requires permanent deletion or conflicts with retention policy;
- roles or consent rules conflict with an existing domain;
- money, currency, tax, billing, or accounting meaning is unclear;
- a breaking API change appears necessary;
- a new provider or infrastructure subsystem is required;
- two interpretations would produce materially different product behavior.

Ask the smallest question needed, then continue the implementation.

## Protected endpoint review

For every protected operation, the completed implementation must answer all
four questions:

1. **Authentication:** How is the WorkOS identity verified?
2. **Authorization:** Why may this identity perform this operation?
3. **Scoping:** How does the query prevent access to another owner or
   organization?
4. **State:** Does membership/status/consent permit access now?

A JWT check without resource scoping is incomplete authorization.
