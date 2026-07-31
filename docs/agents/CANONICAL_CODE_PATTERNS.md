# Canonical Code Patterns

This is the copy-shape guide for agents. It complements the invariants in root
[`AGENTS.md`](../../AGENTS.md); it does not replace them.

Patterns here are intentionally short. Before copying one, open the linked
source file and its tests—the source is where edge cases and failure behavior
live.

## WorkOS authentication: protected REST domain

Authentication is mounted once in the route barrel:

```typescript
// src/node/routes/index.ts
routes.use("/v1/widgets/*", requireAuth());
routes.route("/v1/widgets", widgets);
```

The domain route consumes verified claims:

```typescript
widgets.get("/", async (c) => {
  const userId = await getUserIdFromClaims(c.get("claims"));
  const db = await getDb();

  const rows = await db
    .select()
    .from(widgetsTable)
    .where(eq(widgetsTable.userId, userId));

  return sendSuccess(c, { widgets: rows });
});
```

Rules:

- Apply `requireAuth()` in `src/node/routes/index.ts`, never inside each handler.
- Never parse or verify the bearer token in a route.
- Never trust `claims.sub` as the application user ID. It is the WorkOS provider
  subject. `getUserIdFromClaims()` resolves the `auth_identities` mapping and
  race-safely provisions the first login when the webhook has not arrived.
- Never accept a body/path user ID for a caller-owned resource.
- A missing or invalid token is `401`. WorkOS JWKS infrastructure failure is
  `503`, because it says nothing about token validity.

Canonical sources:

- Mounting: `src/node/routes/index.ts`
- Middleware: `src/node/lib/hono/auth.ts`
- RS256/JWKS verification: `src/node/authorizers/verify-token.ts`
- WorkOS subject → internal user: `src/node/lib/auth.ts`
- Worked REST route: `src/node/routes/users.ts`
- Tests: `tests/unit/lib/hono-auth.test.ts`,
  `tests/unit/authorizers/verify-token.test.ts`,
  `tests/integration/jit-provisioning.test.ts`

## What WorkOS token verification guarantees

`requireAuth()` accepts only a bearer token that passes the shared verifier:

- signature verified against the WorkOS JWKS;
- algorithm pinned to `RS256`;
- issuer accepted by the configured WorkOS contract;
- expiration checked by `jose`;
- `sub` required;
- token `client_id` must equal `WORKOS_CLIENT_ID`.

WorkOS access tokens do not use a conventional `aud` claim here. The
`client_id` comparison is the application binding. An empty client ID is
allowed only when `STAGE` is explicitly `local` or `development`; deployed
stages fail closed.

Handlers receive normalized string-valued `AuthClaims` on `c.get("claims")`.
Only the middleware may create that trusted claims object.

## GraphQL authentication

GraphQL uses the same route-level middleware:

```typescript
routes.use("/v1/graphql/*", requireAuth());
routes.route("/v1/graphql", graphql);
```

`createContext(c)` reads `c.get("claims")`, resolves the internal user through
`getUserIdFromClaims()`, obtains the request-scoped database, and creates fresh
DataLoaders. Resolvers must use `context.userId`; they must not re-verify the
token or construct a second identity path.

Canonical source: `src/node/handlers/graphql/context.ts`.

## Organization authorization

Authentication proves identity. Organization authorization comes from the
database:

```typescript
const membership = await requireActiveMembership(
  db,
  userId,
  organizationId,
  "ADMIN",
);
```

Use the shared organization service rather than copying a role hierarchy into a
route. It enforces the `ACTIVE` membership boundary and role ordering.

For a mutation vulnerable to concurrent membership or role changes, re-run the
authoritative membership check on the transaction handle:

```typescript
const result = await db.transaction(async (tx) => {
  await requireActiveMembership(tx, userId, organizationId, "ADMIN");

  const [created] = await tx
    .insert(widgetsTable)
    .values(sanitizeObject({ ...input, organizationId, userId }))
    .returning();

  if (!created) throw Errors.InternalServerError("Widget creation failed");
  return created;
});
```

Do not authorize from `claims.role` alone. Roles and memberships can change
after the token was issued. Do not surface `PENDING` or `INACTIVE` memberships
through ordinary organization queries.

Canonical source: `src/node/lib/services/organizations.ts`.

## WorkOS webhook authentication

WorkOS webhooks are public HTTP routes with a different trust boundary. They do
not use `requireAuth()`.

The canonical order is:

1. Read the raw body with `c.req.text()`.
2. Enforce the byte-size limit.
3. Read `workos-signature`.
4. Verify timestamp and HMAC against the exact raw body using constant-time
   comparison.
5. Parse and Zod-validate only after verification.
6. Enqueue the validated event.
7. In deployed stages, fail closed if the queue binding is absent.

Do not implement this from a generic webhook sketch. Copy
`src/node/routes/webhooks.ts`; durable retries and idempotent processing continue
in `src/node/queue.ts` and `src/node/lib/services/webhook-processor.ts`.

## Validated and audited REST mutation

For a retryable mutation, the business write and stored response share one
transaction:

```typescript
let auditEntry: Parameters<typeof logAudit>[0] | undefined;
const response = await withTransactionalIdempotentJson(
  {
    key: c.req.header("idempotency-key"),
    sub: claims.sub,
    method: c.req.method,
    path: c.req.path,
    body: rawBody === "" ? undefined : rawBody,
    query: Object.keys(query).length ? query : undefined,
  },
  async (tx) => {
    const input = parseBody(rawBody, widgetSchemas.create);
    const clean = sanitizeObject(input);

    const [created] = await tx.insert(widgetsTable).values(clean).returning();
    if (!created) throw Errors.InternalServerError("Widget creation failed");

    auditEntry = {
      userId,
      action: AUDIT_ACTIONS.CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.SETTINGS,
      resourceId: created.id,
      requestId: c.get("requestId"),
      ipAddress: c.req.header("cf-connecting-ip"),
      userAgent: c.req.header("user-agent"),
      status: AUDIT_STATUS.SUCCESS,
    };

    return { widget: created };
  },
);

if (auditEntry) void logAudit(auditEntry);
return response;
```

Use the transaction passed by `withTransactionalIdempotentJson()`. Calling
`getDb()` inside its callback breaks atomic response storage. Stage the audit
entry in the callback and start `logAudit()` only after the wrapper returns, so
an audit cannot race ahead of a transaction that later rolls back.

Canonical sources: `src/node/routes/users.ts`,
`src/node/lib/hono/idempotent-response.ts`.

## GraphQL mutation

```typescript
updateWidget: async (_parent, { input }, context) => {
  const validated = widgetSchemas.update.parse(input);
  const result = await updateWidgetService({
    db: context.db,
    actorUserId: context.userId,
    input: validated,
    auditContext: auditRequestContext(context),
  });

  return result;
},
```

Resolvers validate, delegate, and translate errors. Services own non-trivial
authorization and write workflows. Field resolvers use `context.loaders.*`.
Schema SDL is inlined in `src/node/handlers/graphql/schema/index.ts`.

Canonical sources: `src/node/handlers/graphql/resolvers/organizations.ts`,
`src/node/lib/services/organizations.ts`.

## Database and SQL

Use Drizzle query APIs for normal reads and writes. Never concatenate or execute
raw SQL strings. A parameterized Drizzle `sql` fragment is allowed only when:

- Drizzle exposes no suitable typed primitive;
- the database-specific behavior is required for an invariant, such as an
  advisory transaction lock or partial-index predicate;
- the fragment is local, parameterized, and documented;
- a real-Postgres test proves the behavior.

Migrations remain the normal home for DDL.

## Background entry points

HTTP middleware does not wrap queue or cron execution.

- Queue handlers establish DB, audit, and Sentry scopes; acknowledge only after
  durable success.
- Cron handlers use `runWithDbScope()`, await all jobs, and throw on failure.
- Both entry points must be retry-safe.

Canonical sources: `src/node/queue.ts`, `src/node/cron.ts`,
`src/node/worker.ts`.

## Do not copy these anti-patterns

```typescript
// Wrong: token is re-parsed outside the trust boundary.
const claims = decodeJwt(c.req.header("authorization"));

// Wrong: WorkOS subject is not the internal user id.
const userId = c.get("claims").sub;

// Wrong: caller input is not proof of identity.
const userId = body.userId;

// Wrong: token role is not a fresh DB authorization decision.
if (c.get("claims").role === "ADMIN") { /* mutate org */ }

// Wrong: pending invitations are not active membership.
where: eq(organizationMembers.organizationId, organizationId)

// Wrong: authentication outage is not an invalid-token verdict.
catch { throw Errors.Unauthorized(); }
```
