# Testing and Verification

Tests are evidence about risk, not a ritual at the end of a patch. Choose the
smallest layer that can genuinely prove the behavior.

## Test layers

| Layer | Use it for |
| --- | --- |
| Unit Vitest | Validation, branching, response/error mapping, audit calls, service orchestration |
| App-level Vitest | Middleware order, auth boundaries, route wire format, CORS/security headers |
| Real-Postgres Vitest | Transactions, constraints, locks, concurrency, rollback, migrations |
| Documentation validation | Broken local links, stale concrete paths, REST/OpenAPI drift |
| Wrangler dry run/local worker | Bundling and binding/config integration |
| Smoke/load scripts | Deployed health, CORS, and basic capacity signals |

Unit tests must mock external infrastructure. A transaction mock must invoke the
callback with the transaction-shaped mock, but passing such a test is not proof
that a real transaction works.

## Minimum feature matrix

Test applicable cases:

- happy path;
- schema rejection at each boundary;
- unauthenticated and unauthorized access;
- missing row/null return;
- dependency or database failure;
- audit invocation and secret redaction;
- repeated request/idempotency replay;
- concurrent execution for race-prone writes;
- deployed-stage behavior when a required binding is absent.

Prefer assertions on the public result and durable state. Avoid snapshots of
large implementation details.

## Commands

During development, run the narrowest relevant test first. Before handoff:

```bash
pnpm check
```

When REST documentation changed:

```bash
pnpm docs:check
```

For prose-only edits, `pnpm docs:validate` is the fast link/path check.

When transactions, locks, constraints, migrations, or concurrent writes
changed:

```bash
pnpm test:integration:local
```

For the broad local CI gate when its dependencies are available:

```bash
pnpm check:ci
```

`check:ci` includes the production dependency audit, lint, typecheck, OpenAPI
drift check, unit tests, and the real-Postgres integration suite. Hosted CI
additionally performs the full-history gitleaks scan, enforces coverage
thresholds, and reports the full dependency audit.

Do not use `lint:fix` across a dirty worktree without reviewing the scope; it
may rewrite unrelated user changes.

## Writing durable tests

- Name the behavior and invariant, not the function implementation.
- Freeze time or inject it when expiry matters.
- Use deterministic IDs and explicit fixtures.
- Release concurrent operations from a barrier instead of hoping timing
  produces a race.
- Assert no partial rows remain after a forced failure.
- Test fail-closed behavior, not only successful configuration.
- Keep setup local to the suite unless a shared fixture has multiple real
  consumers.

## Handoff evidence

Report:

- exact commands run;
- pass/fail counts or the relevant successful result;
- checks not run and why;
- remaining risk, if any.

“Looks good” is not verification. Never hide a failing check as unrelated
without showing the evidence and identifying ownership.
