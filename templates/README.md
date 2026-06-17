# Handler Templates

The three `.ts.template` files here are **current Hono route examples** for the
single Cloudflare Worker. They mirror the real `src/node/routes/` modules and
follow every invariant in [`AGENTS.md`](../AGENTS.md). They keep the
`.ts.template` extension on purpose so they are not compiled or linted.

Each one carries a `// TEMPLATE — copy into src/node/routes/<domain>.ts` marker
and a header comment explaining where to mount it in `routes/index.ts` and
whether to apply `requireAuth()` there.

## Best source of truth: copy the nearest sibling

The real code is the canonical template. Start from the closest existing route;
fall back to the `.ts.template` when there's no sibling for your shape.

| You're building | Copy from |
|---|---|
| User-scoped endpoint (auth'd user's own data) | `src/node/routes/users.ts` (GET/PATCH `/me`; PATCH shows `withIdempotency` + transaction + audit) — or `user-scoped.ts.template` |
| Media / R2-backed endpoint | `src/node/routes/media.ts` |
| Public endpoint (health-style) | `src/node/routes/utils.ts` — or `public.ts.template` |
| Webhook (signature-verified, idempotent) | `src/node/routes/webhooks.ts` — or the webhook variant in `public.ts.template` |
| Dev-only diagnostic | `src/node/routes/test.ts` |
| Org-scoped endpoint | GraphQL org resolvers (`src/node/handlers/graphql/resolvers/organizations.ts`) show the membership/`ACTIVE` + role checks; `org-scoped.ts.template` is the REST port (no REST sibling exists yet) |

## The templates

- **`user-scoped.ts.template`** — a protected domain that operates on the
  caller's own data. Resolves the internal user id with `getUserIdFromClaims`,
  scopes every query to that id, and shows a `GET` plus a mutating `POST`
  wrapped in `withIdempotency` (Zod validation → `sanitizeObject` → transaction
  → `logAudit`). Modeled on `routes/users.ts`.
- **`org-scoped.ts.template`** — a protected domain whose data is org-owned.
  Includes a `requireMembership` helper (the REST port of the organizations
  GraphQL resolver: ACTIVE-membership filter + role hierarchy), gates reads on
  membership and mutations on a minimum role, and validates/sanitizes/audits.
- **`public.ts.template`** — a public route (mounted **without**
  `requireAuth()`), plus a signature-verified webhook variant that verifies an
  HMAC over the raw body with `constantTimeEqual`. References `routes/webhooks.ts`
  for the full race-safe idempotency machinery.

## Steps to add an endpoint (same happy path as AGENTS.md)

1. Add the handler to the domain's Hono sub-app in `src/node/routes/{domain}.ts`
   (a new domain gets its own file, mounted in `routes/index.ts` — with
   `requireAuth()` there if protected; omit it for public routes).
2. Add a Zod schema in `src/node/lib/validation/{domain}.ts`, re-export from
   `index.ts`.
3. Keep the `@swagger` JSDoc block on each route (that's what
   `pnpm docs:generate` reads; use `security: []` for public routes).
4. Follow the invariants: no try-catch in handlers, `sanitizeObject()` before
   writes, `logAudit()` on mutations, transactions for multi-step writes,
   error/response factories only, no `any`.
5. `pnpm check`.

## More

- Invariants and Definition of Done: [`AGENTS.md`](../AGENTS.md)
- Project overview: [`README.md`](../README.md)
- Pattern files: [`.cursor/rules/`](../.cursor/rules/) (`handlers.mdc` is partly Lambda-era)
