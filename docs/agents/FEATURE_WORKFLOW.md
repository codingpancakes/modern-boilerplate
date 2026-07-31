# Feature Workflow

Use this playbook for every endpoint, resolver, service, or domain addition.
Root [`AGENTS.md`](../../AGENTS.md) remains the governing contract.
New feature requests should provide the product decisions in
[`FEATURE_REQUEST_TEMPLATE.md`](FEATURE_REQUEST_TEMPLATE.md); this playbook
turns that contract into an implementation.

## 1. Discover before designing

Find the nearest complete sibling and trace it end to end:

```text
request
  → route or GraphQL resolver
  → validation schema
  → service
  → database schema
  → audit/error/response helpers
  → tests
```

Record these decisions before implementation:

- Is the surface REST, GraphQL, scheduled, or queued?
- Is it public, authenticated, or organization-owned?
- What inputs cross the trust boundary, and what are their size limits?
- Is the operation safe to retry? If not, where is idempotency enforced?
- Which writes must commit or roll back together?
- What audit event proves the mutation occurred?
- What happens if each external dependency fails?

If these answers are unclear, the design is not ready.

## 2. Put code in the right layer

| Concern | Location |
| --- | --- |
| HTTP parsing, status, response orchestration | `src/node/routes/{domain}.ts` |
| GraphQL field wiring and GraphQL errors | `src/node/handlers/graphql/resolvers/{domain}.ts` |
| Business rules shared across surfaces | `src/node/lib/services/{domain}.ts` |
| Input constraints | `src/node/lib/validation/{domain}.ts` |
| Cross-cutting reusable mechanism | `src/node/lib/` |
| Tables and relations | `src/node/db/schema/{domain}.ts` |

Routes and resolvers should read like orchestration. If a handler contains a
branching business workflow, move that workflow into a service.

Do not add a generic abstraction for one caller. Extract only when it preserves
an invariant, removes meaningful duplication, or has multiple concrete uses.

## 3. Follow the write pipeline

Every user-visible/domain write follows this order:

1. Authenticate through the existing boundary.
2. Authorize the specific resource and organization.
3. Parse with a bounded Zod schema.
4. Sanitize the validated value with `sanitizeObject()`.
5. Execute related writes in one transaction.
6. Null-guard every returned row.
7. Emit the audit event with the helper appropriate to its durability boundary.
8. Return through the surface-specific response/error factory.

For REST mutations that may be retried, use
`withTransactionalIdempotentJson(...)`. Run the mutation on the transaction
handle supplied by the helper so the business write and stored response commit
atomically.

For GraphQL:

- SDL is inlined in `src/node/handlers/graphql/schema/index.ts`; Workers cannot
  load loose `.graphql` files at runtime.
- Put domain resolvers in `resolvers/{domain}.ts` and merge them in
  `resolvers/merge.ts`.
- Use `context.loaders.*` in field resolvers to avoid N+1 queries.
- Validate mutation inputs with Zod and emit `void logAudit(...)`.

## 4. Make failure behavior explicit

- REST throws `Errors.*`; GraphQL throws `GraphQLError` with an extension code.
- Route handlers do not catch errors. The application boundary owns formatting
  and Sentry capture.
- A missing row is an expected branch, not permission to dereference
  `undefined`.
- Deployed stages fail closed when a required security or durability binding is
  absent.
- Cron handlers throw on failure.
- Queue messages are acknowledged only after durable success; retryable
  failures remain unacknowledged or call `retry()`.

## 5. Keep the change reviewable

A feature patch should normally include:

- schema/migration, if required;
- validation;
- service logic;
- route or resolver wiring;
- positive, authorization-negative, invalid-input, missing-row, and failure
  tests;
- OpenAPI updates for REST;
- configuration and operator documentation when bindings or secrets change.

Do not leave a half-wired domain, a validation schema with no consumer, or a
migration whose application code arrives in a later uncoordinated patch.

## Completion checklist

- [ ] The established dependency direction is preserved: routes/resolvers may
      perform small scoped reads, while reusable rules, authorization, and
      mutation workflows live in services.
- [ ] Untrusted domain input is bounded and validated; persisted
      user/provider-controlled values are sanitized.
- [ ] Authentication and resource-level authorization are separate checks.
- [ ] Retry, transaction, and concurrency behavior are deliberate.
- [ ] Every domain mutation has a redacted audit event with the correct
      request/transaction/background durability.
- [ ] REST/OpenAPI or GraphQL schema changes match the implementation.
- [ ] Negative and failure paths are tested.
- [ ] Required verification was run and reported.
