# Operations and Bindings

Use this playbook for `wrangler.toml`, Worker bindings, secrets, queues, cron,
health checks, and deployment behavior.

## Configuration classes

| Kind | Source of truth | Code typing |
| --- | --- | --- |
| Secret | `.dev.vars.example` name registry; `.dev.vars` locally; Wrangler secret remotely | Runtime string via `process.env` |
| Non-secret variable | `wrangler.toml [vars]` and every named environment | Runtime string via `process.env` |
| R2/KV/Queue/rate-limit binding | `wrangler.toml` top level and every named environment | `WorkerBindings` and Hono bindings |
| Cron | `[triggers].crons` and the exact same key in `src/node/cron.ts` | Cron handler type |

Never commit secret values. Add only secret names to `.dev.vars.example`.

## Fail-closed policy

Local development may use an explicit, documented fallback when the platform
cannot simulate a capability. Staging and production must fail closed when a
missing binding would weaken authentication, rate limiting, signature
verification, durability, or auditability.

Detailed health checks should surface missing required production configuration
before traffic promotion. Keep health output useful without exposing secret
values or internal credentials.

## Queues

- HTTP routes verify and validate before enqueueing.
- Consumers validate assumptions again at the durable boundary.
- Acknowledge only after the durable operation completes.
- Retry transient failures; use delayed retry for known lock windows.
- Dead-letter handling must persist an alert/audit signal before acknowledging.
- A failed DLQ persistence attempt is still bounded by its consumer retry and
  retention configuration; alert before that budget can be exhausted.
- Queue handlers use DB, audit, and Sentry scopes because HTTP middleware is not
  present.

Adding or changing `[[queues.consumers]]` requires one simple/full Wrangler
deploy per environment to register the consumer; gradual version deploys do not
register it.

## Cron

Cron expression strings are dispatch keys. The `wrangler.toml` value and
`cronRegistry` key must match byte-for-byte. A handler must await all work and
throw if any required job fails.

Current daily maintenance is a single `0 4 * * *` trigger that runs janitor and
audit retention work. Local testing:

```bash
npx wrangler dev --local --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+4+*+*+*"
```

## Deployment-sensitive changes

- Migrations and code deploy independently; follow expand/contract.
- Gradual deploys must parse and identify the active version reliably. Ambiguous
  state is a failed deployment, not permission to guess.
- Health failure during canary or promotion must roll back and exit non-zero.
- Queue consumer registration changes need the documented simple deployment.
- New bindings require local, staging, and production configuration plus types
  and health coverage.
- New secrets require registry and setup-document updates.

## Review checklist

- [ ] Binding/variable exists in every environment where it is required.
- [ ] `WorkerBindings` and Hono types match configuration.
- [ ] Deployed stages fail closed; any local fallback is explicit.
- [ ] Detailed health detects missing critical configuration safely.
- [ ] Queue ack/retry/DLQ behavior has explicit platform retry/retention bounds
      and alerts before terminal loss.
- [ ] Cron registry and trigger expressions match exactly.
- [ ] Migration and deployment order is documented.
- [ ] Rollback behavior remains possible.
