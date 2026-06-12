# Handler Templates

> **⚠️ Lambda-era files.** The three `.ts.template` files in this directory still show the
> pre-migration AWS Lambda handler shape (`withAuth`, Powertools `Logger`, `aws-lambda`
> types) and have not been rewritten for the Cloudflare Worker yet. **Do not copy them
> as-is** — they will not compile against the current codebase.

## How to add an endpoint today

Copy the nearest sibling in `src/node/routes/` instead — the real code is the template:

| You're building | Copy from |
|---|---|
| User-scoped endpoint (auth'd user's own data) | `src/node/routes/users.ts` (GET/PATCH `/me`; PATCH shows `withIdempotency` + transaction + audit) |
| Media / R2-backed endpoint | `src/node/routes/media.ts` |
| Public endpoint (health-style) | `src/node/routes/utils.ts` |
| Webhook (signature-verified, idempotent) | `src/node/routes/webhooks.ts` |
| Dev-only diagnostic | `src/node/routes/test.ts` |
| Org-scoped endpoint | GraphQL org resolvers (`src/node/handlers/graphql/resolvers/organizations.ts`) show the membership/`ACTIVE` checks; no REST sibling exists yet |

Steps (the same happy path as [AGENTS.md](../AGENTS.md)):

1. Add the handler to the domain's Hono sub-app in `src/node/routes/{domain}.ts`
   (a new domain gets its own file, mounted in `routes/index.ts` — with `requireAuth()`
   there if protected).
2. Add a Zod schema in `src/node/lib/validation/{domain}.ts`, re-export from `index.ts`.
3. Keep the `@swagger` JSDoc block on the route (that's what `pnpm docs:generate` reads).
4. Follow the invariants: no try-catch, `sanitizeObject()` before writes, `logAudit()` on
   mutations, transactions for multi-step writes, error/response factories only.
5. `pnpm check`.

## What the legacy templates were

- `user-scoped.ts.template` — auth'd single-user endpoints (`withAuth`)
- `org-scoped.ts.template` — endpoints requiring organization membership
- `public.ts.template` — public endpoints / webhooks (`withPublicCors` / signature checks)

They remain useful only as a checklist of concerns (validation, audit, idempotency,
org scoping) until they're rewritten as Hono route templates — or deleted in favor of
"copy the nearest sibling".

## More

- Invariants and Definition of Done: [`AGENTS.md`](../AGENTS.md)
- Project overview: [`README.md`](../README.md)
- Pattern files: [`.cursor/rules/`](../.cursor/rules/) (`handlers.mdc` is partly Lambda-era)
