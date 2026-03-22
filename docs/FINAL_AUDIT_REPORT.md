# Final Audit Report — Lib / Schema / Infra / Scripts

**Date:** 2026-03-21  
**Scope:** All lib, validation, schema, authorizer, script, and infrastructure files  
**Auditor:** Automated deep audit

---

## CRITICAL Issues

### C1 — RAW JWT TOKEN LOGGED TO CLOUDWATCH (auth.ts)

- **Severity:** Critical
- **File:** `src/node/lib/auth.ts` — lines 21, 30
- **Code:**
  ```ts
  console.log("🔐 RAW TOKEN:", authHeader);
  console.log("🔑 PARSED CLAIMS:", JSON.stringify(claims, null, 2));
  ```
- **What's wrong:** Every authenticated request logs the full Bearer token (a credential) and the complete decoded claims (including email, sub, org_id). In production, CloudWatch Logs would contain live session tokens that an attacker with log-read access could replay. Also violates SOC 2 logging policy (no PII in plaintext logs).
- **Fix:** Delete both `console.log` lines entirely. If debugging is needed, use a structured logger at `DEBUG` level gated behind `NODE_ENV !== 'production'`.

---

## HIGH Issues

### H1 — `AUTH_ISSUER` env var read at runtime but never set by infra

- **Severity:** High
- **File:** `src/node/authorizers/workos-jwt.ts` — line 10; `infrastructure/lib/api-stack.ts` `commonEnv` (absent)
- **Code:**
  ```ts
  const AUTH_ISSUER = process.env.AUTH_ISSUER ?? "https://api.workos.com/";
  ```
- **What's wrong:** The authorizer reads `AUTH_ISSUER` from env, but `commonEnv` in api-stack.ts never sets it. The fallback `"https://api.workos.com/"` works today, but if the issuer ever changes or the team adds a custom issuer for staging, the env var would silently fall back. More critically, this is a security-relevant config (JWT issuer validation) that should be explicit.
- **Fix:** Either (a) add `AUTH_ISSUER: "https://api.workos.com/"` to `commonEnv` in api-stack.ts, or (b) remove the env-var read and hard-code the constant since it's a known WorkOS constant.

### H2 — `orgUnitId` set to organization ID (FK mismatch)

- **Severity:** High
- **File:** `src/node/handlers/graphql/resolvers/organizations.ts` — lines 114, 234
- **Code:**
  ```ts
  orgUnitId: org.id, // placeholder -- no unit yet
  orgUnitId: organizationId, // placeholder
  ```
- **What's wrong:** `orgUnitId` is a foreign key referencing `org_units.id` (see `organizations.ts` schema line 139). Storing an `organizations.id` value violates the FK constraint. This **will** fail with a Postgres FK violation error unless there happens to be an `org_units` row with the same UUID (vanishingly unlikely).
- **Fix:** Either (a) make `orgUnitId` nullable in the `organization_members` schema and pass `null` here, or (b) create a root org_unit for each new org and use its ID.

### H3 — `inviteMember` Zod schema requires `userId` as UUID, but GraphQL type uses `ID!`

- **Severity:** High  
- **File:** `src/node/lib/validation/organizations.ts` line 41; `src/node/handlers/graphql/schema/organizations.graphql` line 86
- **Code (Zod):**
  ```ts
  userId: z.string().uuid(),
  ```
  **Code (GraphQL):**
  ```graphql
  input InviteMemberInput {
    userId: ID!
    role: OrgRole
  }
  ```
- **What's wrong:** GraphQL `ID!` serializes to any string. If a client sends a non-UUID string (e.g. a WorkOS user ID like `user_01H...`), the Zod `.uuid()` validation will reject it. This is correct if internal UUIDs are expected, but the GraphQL schema doesn't communicate the UUID requirement — callers will get a confusing validation error.
- **Fix:** Either (a) add a description/comment to the GraphQL schema `userId: ID! # Must be internal UUID`, or (b) accept the potential for non-UUID IDs if external identifiers are used.

---

## MEDIUM Issues

### M1 — Dead exports: `getUserId()` and `getOrgId()` in auth.ts

- **Severity:** Medium
- **File:** `src/node/lib/auth.ts` — lines 38, 43
- **Code:**
  ```ts
  export function getUserId(evt: APIGatewayProxyEventV2): string { ... }
  export function getOrgId(evt: APIGatewayProxyEventV2): string | undefined { ... }
  ```
- **What's wrong:** Neither `getUserId` nor `getOrgId` is imported anywhere in `src/` or `tests/`. All handlers use `getUserIdFromClaims()` instead. These are dead code.
- **Fix:** Remove both functions, or mark them as `@deprecated` if kept for future use.

### M2 — Dead exports: `withSecretToken`, `withWebhookSignature`, `withExternalHeader`, `withExternalApiKey`, `withOpenApiKey`, `withOpenHeader` in withCustomHeader.ts

- **Severity:** Medium
- **File:** `src/node/lib/withCustomHeader.ts` — lines 150, 166, 183, 240, 253, 216
- **What's wrong:** Only `withApiKey` and `withCustomHeader` are imported by handlers. The other 6 convenience wrappers (`withSecretToken`, `withWebhookSignature`, `withExternalHeader`, `withExternalApiKey`, `withOpenApiKey`, `withOpenHeader`) have zero imports in `src/node/handlers/`.
- **Fix:** Keep if planned for future use; otherwise remove to reduce surface area.

### M3 — Dead exports: `traceQuery`, `traceExternalCall`, `traceLambdaInvoke` in tracer.ts

- **Severity:** Medium
- **File:** `src/node/lib/tracer.ts` — lines 23, 45, 68
- **What's wrong:** Only `tracer` (the raw instance) is imported (by `middleware.ts`). The three helper functions `traceQuery`, `traceExternalCall`, `traceLambdaInvoke` are never imported by any handler.
- **Fix:** Consider removing unused helpers or integrating them into handlers that make DB/external calls.

### M4 — Dead exports: `withAudit`, `extractRequestContext` in audit.ts

- **Severity:** Medium
- **File:** `src/node/lib/audit.ts` — lines 119, 90
- **What's wrong:** Handlers use `logAudit()` and `auditResolver()` directly but `withAudit` and `extractRequestContext` are never imported by any handler.
- **Fix:** Remove if not needed, or add to relevant REST handlers.

### M5 — Dead exports: `sanitizeUrl`, `sanitizeEmail`, `sanitizeString`, `escapeHtml` in sanitize.ts (from handlers)

- **Severity:** Medium
- **File:** `src/node/lib/sanitize.ts`
- **What's wrong:** Only `sanitizeObject`, `sanitizeFilename`, `validateFileExtension`, `ALLOWED_FILE_EXTENSIONS`, `FILE_SIZE_LIMITS` are imported by handlers. `sanitizeUrl`, `sanitizeEmail`, `sanitizeString`, `escapeHtml` have no handler imports (though `sanitizeString` and `escapeHtml` are used internally by `sanitizeObject`). `validateFileSize` and `formatFileSize` have zero imports anywhere.
- **Fix:** `validateFileSize` and `formatFileSize` are fully dead — consider removal.

### M6 — Dead exports: `customClaim` in middleware.ts

- **Severity:** Medium
- **File:** `src/node/lib/middleware.ts` — line 38
- **What's wrong:** `customClaim()` is exported and documented, but no handler calls it. The authorizer forwards `urn:*` claims, but nothing reads them.
- **Fix:** Keep if planned for future use; otherwise remove.

### M7 — Dead exports: `resetDbConnection` in db.ts

- **Severity:** Medium
- **File:** `src/node/lib/db.ts` — line 126
- **What's wrong:** Exported but never imported in `src/` or `tests/`.
- **Fix:** Remove or use in test setup.

### M8 — `withIdempotency` never used by any handler

- **Severity:** Medium
- **File:** `src/node/lib/idempotency.ts` — line 15
- **What's wrong:** The `idempotency-key` header is listed in CORS allowed headers (cors.ts, api-stack.ts), the DB table exists, and `cleanupExpiredKeys` is used by the janitor handler. But `withIdempotency()` itself is never called by any mutation handler.
- **Fix:** Wire into POST/PUT/PATCH handlers that should be idempotent, or remove the middleware if not needed.

### M9 — `schemas` unified object missing `updateOrganization`, `inviteMember`, `updateMemberRole`

- **Severity:** Medium
- **File:** `src/node/lib/validation/index.ts` — lines 55–68
- **Code:**
  ```ts
  export const schemas = {
    // ...
    createOrganization: organizationSchemas.create,
    createOrgUnit: organizationSchemas.createOrgUnit,
    // Missing: updateOrganization, inviteMember, updateMemberRole
  };
  ```
- **What's wrong:** The backward-compatible `schemas` object includes `createOrganization` and `createOrgUnit` but omits `updateOrganization`, `inviteMember`, `updateMemberRole`. Anyone using the `schemas` flat object won't find these.
- **Fix:** Add the missing entries, or document that callers should use `organizationSchemas.*` directly.

### M10 — Sentry only imported by middleware.ts — not used in REST handlers

- **Severity:** Medium
- **File:** `src/node/lib/sentry.ts`; no handler imports
- **What's wrong:** `setUser`, `setRequestContext`, `captureException`, `captureMessage`, `addBreadcrumb`, `flush` — none of these are imported directly by any handler. Only `middleware.ts` (the `withAuth` wrapper) uses Sentry. Handlers using `withPublicCors` or `withCustomHeader` get zero Sentry coverage.
- **Fix:** Integrate Sentry into `withPublicCors` and `withCustomHeader` wrappers, or add it to individual handlers.

### M11 — `createOrgUnit` validation schema never used by resolvers

- **Severity:** Medium
- **File:** `src/node/lib/validation/organizations.ts` — line 50
- **What's wrong:** The `createOrgUnit` schema exists in validation and is exported via `schemas.createOrgUnit`, but no handler or resolver imports or uses it. There's no `createOrgUnit` mutation in the GraphQL schema or any REST handler.
- **Fix:** Either implement the mutation or remove the dead schema.

### M12 — `OrganizationMembership.joinedAt` in GraphQL doesn't map to any DB column

- **Severity:** Medium
- **File:** `src/node/handlers/graphql/schema/organizations.graphql` — line 26
- **Code:**
  ```graphql
  type OrganizationMembership {
    ...
    joinedAt: DateTime!
  }
  ```
- **What's wrong:** The `organization_members` DB table has `createdAt` but no `joinedAt` column. The GraphQL type exposes `joinedAt` which won't resolve unless there's a field resolver mapping `createdAt → joinedAt`. Without it, this field will return `null` despite being `DateTime!` (non-nullable), causing a GraphQL error.
- **Fix:** Add a field resolver that maps `createdAt` to `joinedAt`, or rename the GraphQL field to `createdAt`.

---

## LOW Issues

### L1 — `Errors.Conflict()` and `Errors.RateLimited()` never used by handlers

- **Severity:** Low
- **File:** `src/node/lib/errors.ts` — lines 51, 52
- **What's wrong:** These error factory methods are defined but never thrown by any handler. Not harmful but adds unused API surface.
- **Fix:** Keep for completeness; remove if minimizing bundle.

### L2 — `CORS_PARENT_DOMAINS` redundantly merged with `CORS_DOMAIN_PATTERNS`

- **Severity:** Low
- **File:** `src/node/lib/cors.ts` — lines 14–26
- **What's wrong:** Both `CORS_PARENT_DOMAINS` and `CORS_DOMAIN_PATTERNS` (after stripping `*.`) are merged into the same `PARENT_DOMAINS` Set. The env vars are documented separately in `sync-secrets.ts` and `api-stack.ts`. This works correctly but is confusing — both env vars achieve the same result.
- **Fix:** Document the equivalence, or consolidate into a single env var.

### L3 — `database` field name inconsistency in migrate.ts

- **Severity:** Low
- **File:** `scripts/migrate.ts` — line 27
- **Code:**
  ```ts
  return `postgresql://${secret.username}:${secret.password}@${secret.host}:${secret.port}/${secret.database || secret.dbname}?sslmode=require`;
  ```
  vs `src/node/lib/db.ts` (line 40):
  ```ts
  dbUrl = `postgresql://${secret.username}:${secret.password}@${secret.host}:${secret.port || 5432}/${secret.database}?sslmode=${sslmode}${channelBinding}`;
  ```
- **What's wrong:** `migrate.ts` falls back to `secret.dbname`, but `db.ts` only checks `secret.database`. If a secret uses the key `dbname`, migrations would work but runtime would fail, or vice versa.
- **Fix:** Use consistent key names. Add `secret.dbname` fallback to `db.ts` or remove it from `migrate.ts`.

### L4 — `migrate.ts` missing default port fallback

- **Severity:** Low
- **File:** `scripts/migrate.ts` — line 27
- **Code:**
  ```ts
  ...@${secret.host}:${secret.port}/...
  ```
- **What's wrong:** Unlike `db.ts` which has `${secret.port || 5432}`, `migrate.ts` doesn't fall back to port 5432 if `port` is missing from the secret.
- **Fix:** Add `${secret.port || 5432}`.

### L5 — `createUser` validation schema may be dead

- **Severity:** Low
- **File:** `src/node/lib/validation/users.ts` — line 12
- **What's wrong:** `userSchemas.create` (`createUser`) is exported but user creation is handled by the WorkOS webhook handler which has its own flow. No REST or GraphQL handler calls `userSchemas.create.parse()`.
- **Fix:** Verify if needed for any handler; remove if not.

### L6 — `corsPreflight: allowOrigins: ["*"]` in api-stack.ts is overly broad

- **Severity:** Low
- **File:** `infrastructure/lib/api-stack.ts` — line 60
- **What's wrong:** The API Gateway-level CORS is set to `allowOrigins: ["*"]`. This is documented as intentional (Lambda handles fine-grained CORS), but means API Gateway's own error responses (401/403/429/5xx) will have `Access-Control-Allow-Origin: *` instead of the specific origin. This is a defense-in-depth gap, though the Lambda middleware adds proper restrictive CORS headers on all Lambda-handled responses.
- **Fix:** Accept as-is (documented), or consider using a single origin from the env-var set and relying on CloudFront behavior.

### L7 — `WORKOS_WEBHOOK_SECRET` not in `commonEnv` but read by webhook handler

- **Severity:** Low
- **File:** `src/node/handlers/webhooks/workos.ts` — line 115; `infrastructure/lib/api-stack.ts` `commonEnv`
- **What's wrong:** The webhook handler first checks `process.env.WORKOS_WEBHOOK_SECRET` before falling back to Secrets Manager. But `commonEnv` doesn't set `WORKOS_WEBHOOK_SECRET` — it only sets `WORKOS_SECRET_ARN`. This means the env var path is dead code in deployed environments (always falls through to Secrets Manager).
- **Fix:** Either remove the env var check from the webhook handler, or add `WORKOS_WEBHOOK_SECRET` to `commonEnv` (less preferred — secrets should stay in Secrets Manager).

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| **Critical** | 1 | JWT token and claims logged in plaintext |
| **High** | 3 | Missing env var, FK violation, schema mismatch |
| **Medium** | 12 | Dead exports, missing schema entries, missing Sentry coverage |
| **Low** | 7 | Minor inconsistencies, dead code, documentation gaps |

### Key Findings by Category

1. **Validation vs Resolvers:** CreateOrganization, UpdateOrganization, InviteMember, UpdateMemberRole schemas all align with their GraphQL inputs. `createOrgUnit` schema has no resolver.
2. **Zod vs DB Columns:** Schemas align well. One mismatch: GraphQL `joinedAt` vs DB `createdAt` on OrganizationMembership.
3. **Dead Exports:** 15+ exported functions/constants have zero imports outside their own file.
4. **Env Var Consistency:** `AUTH_ISSUER` used in authorizer but not set in infra. `WORKOS_WEBHOOK_SECRET` checked at runtime but not provided.
5. **Security:** **Critical** — raw JWT tokens logged. `orgUnitId` FK violation. CORS is well-implemented with proper origin validation.
6. **Field Mismatches:** `orgUnitId` incorrectly set to org ID instead of org_unit ID.
7. **Stale References:** No references to deleted tables found. Schema index file cleanly exports current tables only.
