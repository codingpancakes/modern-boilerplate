# Deep Code Audit: `src/node/lib/`, `src/node/types/`, `src/node/authorizers/`

**Date:** 2026-03-21  
**Scope:** Correctness, reliability, edge cases, type safety (NOT security)  
**Files audited:** 22

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Bug | 5 |
| 🟠 Logic Error | 4 |
| 🟡 Edge Case | 8 |
| 🔵 Code Quality | 7 |
| ⚪ Performance | 1 |

---

## 1. `authorizers/workos-jwt.ts`

### 🔴 Bug — Unhandled promise rejection from `Promise.race` timeout

```ts
const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("JWT verification timeout")), 5000);
});

const { payload } = (await Promise.race([
    verifyPromise,
    timeoutPromise,
])) as JWTVerifyResult;
```

**Problem:** When `verifyPromise` resolves first, the `timeoutPromise`'s rejection fires 5 seconds later as an unhandled promise rejection. In Node.js, this can crash the process or trigger warnings. The `setTimeout` is never cleared.

**Impact:** Potential Lambda crash from unhandled rejection, especially under load where many concurrent verifications complete before their timeouts.

**Fix:** Use `AbortController` or clear the timeout:
```ts
let timer: NodeJS.Timeout;
const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("JWT verification timeout")), 5000);
});
try {
    const { payload } = await Promise.race([verifyPromise, timeoutPromise]) as JWTVerifyResult;
    clearTimeout(timer!);
    // ...
} catch (err) {
    clearTimeout(timer!);
    throw err;
}
```

### 🟡 Edge Case — Empty `CLIENT_ID` produces valid but wrong JWKS URL

```ts
const CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";
// ...
JWKS = createRemoteJWKSet(
    new URL(`https://api.workos.com/sso/jwks/${CLIENT_ID}`),
```

**Problem:** If `WORKOS_CLIENT_ID` is not set, the JWKS URL becomes `https://api.workos.com/sso/jwks/` (trailing slash). The `new URL()` won't throw, and `createRemoteJWKSet` succeeds. The authorizer will then make HTTP requests to an invalid WorkOS endpoint on every JWT verification, returning cryptic errors instead of a clear "CLIENT_ID not configured" message.

**Impact:** Confusing debug experience in misconfigured environments; silent failure mode.

### 🟡 Edge Case — Authorizer returns `isAuthorized: true` with empty `sub`

```ts
ctx: Record<string, string> = {
    sub: String(payload.sub ?? ""),
    // ...
};
return { isAuthorized: true, context: ctx };
```

**Problem:** If the JWT has no `sub` claim, the authorizer returns `isAuthorized: true` with `sub: ""`. Downstream middleware.ts checks `if (!claims?.sub)` — empty string is falsy, so the middleware returns 401. The API Gateway already let it through as authorized, creating an inconsistency.

**Impact:** Request passes the authorizer but is rejected by middleware — wasted compute and confusing audit logs.

---

## 2. `lib/auth.ts`

### 🔵 Code Quality — `as any` cast on request context

```ts
const rc = (evt.requestContext as any) || {};
```

**Problem:** Bypasses TypeScript type checking entirely. If the API Gateway event structure changes, no compile-time error will be raised.

**Impact:** Reduced type safety; refactoring risk.

### 🟡 Edge Case — JIT provisioning error path masks real errors

```ts
} catch {
    // Another concurrent request already provisioned — re-query
    const retry = await lookup();
    if (retry[0]?.userId) {
        return retry[0].userId;
    }
    throw Errors.Unauthorized();
}
```

**Problem:** The catch block assumes the error is a unique-constraint violation from concurrent provisioning. But it could be a database connection error, a schema error, or any other failure. In those cases, the retry lookup will also fail (or return empty), and the user gets a misleading 401 Unauthorized instead of 500 Internal Server Error.

**Impact:** Real database errors are masked as authentication failures — extremely difficult to debug.

---

## 3. `lib/middleware.ts`

### 🟠 Logic Error — `corsHeaders()` duplicates/overrides values from `getCorsHeaders()`

```ts
function corsHeaders(origin?: string) {
    return {
        ...getCorsHeaders(origin),
        Vary: "Origin",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    };
}
```

**Problem:** `getCorsHeaders()` already sets both `Vary: "Origin"` and `Access-Control-Allow-Methods`. The local override uses a different format (no spaces after commas: `"GET,POST,PUT,PATCH,DELETE,OPTIONS"` vs `"GET, POST, PUT, PATCH, DELETE, OPTIONS"` in cors.ts). This inconsistency means the CORS methods header format depends on which middleware is used.

**Impact:** Functional redundancy and format inconsistency. Some strict CORS parsers might behave differently.

### 🟠 Logic Error — Authorizer context values are all strings, but type says `number | boolean`

```ts
const claims = lambdaCtx as AuthenticatedEvent["claims"] | undefined;
```

The authorizer (`workos-jwt.ts`) converts everything to strings:
```ts
exp: payload.exp ? String(payload.exp) : "",
```

But the `AuthenticatedEvent` type says:
```ts
claims: {
    exp?: number;
    iat?: number;
    [key: string]: string | number | boolean | undefined;
};
```

**Problem:** Handler code expecting `claims.exp` to be a `number` (e.g., for arithmetic like `claims.exp * 1000`) will get a string `"1679000000"`. TypeScript won't warn because the type says it's `number`.

**Impact:** Potential runtime bugs in any handler that uses `exp` or `iat` numerically.

---

## 4. `lib/pagination.ts`

### 🔴 Bug — `decodeCursor` returns `{ timestamp: NaN, id: undefined }` for malformed cursors

```ts
export function decodeCursor(cursor: string): { timestamp: number; id: string } | null {
    try {
        const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
        const [timestamp, id] = decoded.split("_");
        return {
            timestamp: Number.parseInt(timestamp, 10),
            id,
        };
    } catch {
        return null;
    }
}
```

**Problem:** If the base64-decoded string does not contain `_`, `split("_")` returns `["entirestring"]`. Then `id` is `undefined` (but typed as `string`) and `timestamp` is `NaN` (but typed as `number`). The function returns a non-null result with invalid data instead of `null`.

Additionally, a valid base64url string that decodes to garbage (no underscore) won't throw, so the `catch` path is never triggered.

**Impact:** Callers using the returned cursor values will propagate `NaN` into SQL queries and `undefined` into `WHERE id = $1` clauses. Could cause DB errors or return incorrect results.

**Fix:**
```ts
const parts = decoded.split("_");
if (parts.length < 2) return null;
const ts = Number.parseInt(parts[0], 10);
if (Number.isNaN(ts)) return null;
return { timestamp: ts, id: parts.slice(1).join("_") };
```

### 🟡 Edge Case — `createPaginatedResponse` crashes if called with `limit=0`

```ts
const hasMore = items.length > limit;
const paginatedItems = hasMore ? items.slice(0, limit) : items;
const nextCursor = hasMore
    ? encodeCursor(
        new Date(paginatedItems[paginatedItems.length - 1].createdAt).getTime(),
        paginatedItems[paginatedItems.length - 1].id,
    )
    : undefined;
```

**Problem:** If `limit=0` and `items.length > 0`, then `hasMore=true` and `paginatedItems=items.slice(0,0)=[]`. Accessing `paginatedItems[paginatedItems.length - 1]` becomes `paginatedItems[-1]` which is `undefined`, causing a crash.

**Impact:** Runtime crash. The Zod schema enforces `min(1)`, but this function is a standalone utility that could be called directly without validation.

---

## 5. `lib/sanitize.ts`

### 🔴 Bug — `sanitizeFilename` produces malformed output for files without extensions

```ts
if (sanitized.length > maxLength) {
    const extension = sanitized.split(".").pop() || "";
    const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf("."));
    const maxNameLength = maxLength - extension.length - 1;
    sanitized = `${nameWithoutExt.substring(0, maxNameLength)}.${extension}`;
}
```

**Problem:** For a filename without a dot (e.g., `"averylongfilenamewithnoextension"`), `split(".").pop()` returns the entire filename as "extension", and `lastIndexOf(".")` returns `-1`. Then `substring(0, -1)` returns `""` (JS treats negative as 0). Result: `".averylongfilenamewithnoextension"`.

**Impact:** Files without extensions get a leading dot (becoming hidden files on Unix) and aren't actually truncated to `maxLength`.

**Fix:**
```ts
if (sanitized.length > maxLength) {
    const dotIndex = sanitized.lastIndexOf(".");
    if (dotIndex > 0) {
        const extension = sanitized.substring(dotIndex + 1);
        const maxNameLength = maxLength - extension.length - 1;
        sanitized = `${sanitized.substring(0, Math.max(1, maxNameLength))}.${extension}`;
    } else {
        sanitized = sanitized.substring(0, maxLength);
    }
}
```

### 🟡 Edge Case — `formatFileSize` returns `"NaN undefined"` for negative bytes

```ts
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
}
```

**Problem:** For negative `bytes`, `Math.log(negative)` is `NaN`, making `i = NaN`, `sizes[NaN] = undefined`.

**Impact:** Returns garbled string. While negative bytes shouldn't occur in normal flow, defensive functions should handle it.

### 🟡 Edge Case — `sanitizeObject` has no protection against circular references

```ts
export function sanitizeObject<T extends Record<string, unknown>>(obj: T, ...): T {
    // ...
    sanitized[key] = sanitizeObject(value as Record<string, unknown>, options);
    // ...
}
```

**Problem:** If an object has circular references, this recurses infinitely and causes a stack overflow.

**Impact:** Runtime crash if called with circular data (unlikely from JSON-parsed request bodies, but possible from in-memory objects).

---

## 6. `lib/idempotency.ts`

### 🟠 Logic Error — Reclaimed key may be deleted by janitor between INSERT and UPDATE

```ts
// Key existed but was in a failed/expired state — reclaim it
await db.update(idempotencyKeys)
    .set({ status: "processing", ... })
    .where(eq(idempotencyKeys.key, idempotencyKey));
```

**Problem:** Between the INSERT...ON CONFLICT DO NOTHING (which found the key exists) and the reclaim UPDATE, the `cleanupExpiredKeys()` function could delete the expired key. The UPDATE would then affect 0 rows, and the handler proceeds to execute. The subsequent UPDATE to store the completed response also affects 0 rows, so the idempotency response is lost. A future retry with the same key would re-execute the handler.

**Impact:** Very rare race condition. The handler executes twice under specific timing — once losing its idempotency record.

### 🟡 Edge Case — Status fall-through for unexpected states

```ts
if (existing.status === "processing") { throw ... }
if (existing.status === "completed" && existing.response) { return ... }
// Falls through silently to reclaim
```

**Problem:** If `status === "completed"` but `response` is null/empty, the code falls through and reclaims the key, re-executing the handler. This shouldn't happen normally but indicates a prior partial write.

**Impact:** Silent re-execution for edge cases.

---

## 7. `lib/unsubscribe.ts`

### 🔴 Bug — `or()` with all `undefined` args in global unsubscribe check

```ts
or(
    contact.email ? eq(globalUnsubscribes.email, contact.email) : undefined,
    contact.phone ? eq(globalUnsubscribes.phone, contact.phone) : undefined,
),
```

**Problem:** If a contact has neither `email` nor `phone` (both null/empty), this becomes `or(undefined, undefined)`. In Drizzle ORM, `or()` with all undefined arguments evaluates to `undefined`, which when placed inside `and()` is silently dropped. The query becomes:
```sql
WHERE organization_id = $1 AND channel_kind = $2
```
This matches ALL global unsubscribe records for the org+channel, not just the contact's.

**Impact:** Contacts without email AND phone would be incorrectly flagged as globally unsubscribed if any unsubscribe records exist for that org+channel. This is a data-correctness bug.

**Fix:** Add an early return:
```ts
if (!contact.email && !contact.phone) {
    // Cannot check global unsubscribe without identifier — skip
    // (proceed to remaining checks)
}
```

### 🔴 Bug — `unsubscribeFromTopic` uses `onConflictDoUpdate` without a matching unique constraint

```ts
await db.insert(contactSubscriptions)
    .values({ ... })
    .onConflictDoUpdate({
        target: [
            contactSubscriptions.contactId,
            contactSubscriptions.topicId,
            contactSubscriptions.channelKind,
        ],
        set: { status: "UNSUBSCRIBED", source: source || "UNSUBSCRIBE_LINK" },
    });
```

**Problem:** The `contact_subscriptions` table has no unique constraint on `(contactId, topicId, channelKind)` — only regular indexes. PostgreSQL requires a unique index for `ON CONFLICT` target columns. This will throw a database error at runtime:
```
there is no unique or exclusion constraint matching the ON CONFLICT specification
```

**Impact:** Topic-level unsubscription is broken at the database level.

---

## 8. `lib/permissions.ts`

### 🟠 Logic Error — Unsafe cast of `membership.role` without validation

```ts
if (minRole && !hasMinRole(membership.role as OrgRole, minRole)) {
    throw Errors.Forbidden();
}
```

**Problem:** `membership.role` comes from the database and is cast to `OrgRole` without validation. If the DB contains a role not in `ROLE_HIERARCHY` (e.g., a new role added to the DB but not the code), `hasMinRole` silently returns `false` (denying access). This is safe from an authorization perspective but could lock out users with new roles.

**Impact:** Users with unrecognized roles are silently denied access.

---

## 9. `lib/cors.ts`

### 🔵 Code Quality — Missing `Vary: Origin` header in `getExternalCorsHeaders`

```ts
export function getExternalCorsHeaders(origin: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    // ... no Vary header
```

**Problem:** `getCorsHeaders()` includes `Vary: "Origin"` but `getExternalCorsHeaders()` does not. If responses from external CORS endpoints are cached by a CDN, the missing `Vary` header could cause one origin's CORS headers to be served to a different origin.

**Impact:** CDN caching bug for external webhook endpoints.

### 🔵 Code Quality — Redundant double filter

```ts
.filter(Boolean)
.filter((s) => s.length > 0),
```

**Problem:** `filter(Boolean)` already removes empty strings (which are falsy). The second filter is redundant.

---

## 10. `lib/audit.ts`

### 🟡 Edge Case — `undefined as TResult` unsafe cast in error path

```ts
metadata: options.getMetadata?.(undefined as TResult, args),
```

**Problem:** In the `auditResolver` error handler, `undefined` is cast to `TResult` and passed to `getMetadata`. If `getMetadata` accesses properties on the result (e.g., `result.id`), it throws a TypeError at runtime, causing the audit error logging itself to fail, and the error is re-thrown from the audit logging.

**Impact:** If a resolver throws AND the audit `getMetadata` function accesses result properties, the original error could be masked by a secondary TypeError.

---

## 11. `lib/response.ts`

### 🔵 Code Quality — `SuccessResponse` used as return type for error responses

```ts
export function createErrorResponse(...): SuccessResponse {
```

**Problem:** The return type of `createErrorResponse` is `SuccessResponse`, which is semantically misleading. It should be a generic `ApiResponse` type or at least renamed.

### 🔵 Code Quality — `createNoContentResponse` includes `Content-Type` header

```ts
export function createNoContentResponse(): SuccessResponse {
    return {
        statusCode: 204,
        headers: { "Content-Type": "application/json" },
        body: "",
    };
}
```

**Problem:** HTTP 204 No Content responses should not include a `Content-Type` header or body. While API Gateway may handle this gracefully, it's technically incorrect per HTTP spec.

---

## 12. `lib/db.ts`

### 🟡 Edge Case — Password with special characters breaks connection URL

```ts
dbUrl = `postgresql://${secret.username}:${secret.password}@${secret.host}:${secret.port || 5432}/${secret.database}?sslmode=${sslmode}${channelBinding}`;
```

**Problem:** If `secret.password` contains special characters (`@`, `#`, `%`, `/`, `?`), the constructed URL will be malformed. The password is not URL-encoded.

**Impact:** Database connection failure for credentials with special characters in the RDS-style secret fallback path.

**Fix:**
```ts
dbUrl = `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port || 5432}/${secret.database}?sslmode=${sslmode}${channelBinding}`;
```

### 🔵 Code Quality — `connectionAttempts` counter is decoupled from retry logic

```ts
let connectionAttempts = 0;
// ...
connectionAttempts++; // incremented each attempt
// But retryCount parameter is what controls the retry loop
```

**Problem:** `connectionAttempts` is only used for the error log. It accumulates across separate `getDb()` calls if the first call fails partway and a second call starts. The logged "attempts" count could be misleading.

---

## 13. `lib/withCustomHeader.ts`

### 🔵 Code Quality — Header lookup misses mixed-case variations

```ts
const headerValue =
    event.headers[config.headerName] ||
    event.headers[config.headerName.toLowerCase()] ||
    event.headers[config.headerName.toUpperCase()];
```

**Problem:** Only checks original, lowercase, and UPPERCASE. Misses mixed case like `X-Api-Key` vs `X-API-Key`. However, AWS API Gateway v2 lowercases all header keys, so `event.headers[config.headerName.toLowerCase()]` should always work. The other two checks are redundant.

---

## 14. `types/enums.ts`

### 🔵 Code Quality — Inconsistent enum key casing

```ts
export enum AppointmentStatus {
    PENDING = "pending",
    CONFIRMED = "confirmed",
    COMPLETED = "completed",
    canceled = "canceled",  // ← lowercase key
}
```

**Problem:** `canceled` uses lowercase key while `PENDING`, `CONFIRMED`, `COMPLETED` use UPPERCASE. Same issue in `SessionStatus` and `AttendeeStatus`. This creates inconsistency where `AppointmentStatus.canceled` looks like a different pattern than `AppointmentStatus.PENDING`.

**Impact:** Confusing for developers; IDE autocomplete shows mixed casing. Should be `CANCELED = "canceled"`.

---

## 15. `lib/withPublicCors.ts`

### 🔵 Code Quality — `error: any` in catch block

```ts
} catch (error: any) {
```

**Problem:** Uses `any` type instead of `unknown`. Other middleware files (`withCustomHeader.ts`) correctly use `error: unknown`.

---

## 16. `lib/sentry.ts`

### ⚪ Performance — All 4xx errors filtered from Sentry

```ts
beforeSend(event, hint) {
    const error = hint.originalException as ErrorWithStatusCode;
    if (error?.statusCode) {
        if (error.statusCode >= 400 && error.statusCode < 500) {
            return null;
        }
    }
    return event;
},
```

**Problem:** Filters ALL 4xx errors including `408 Request Timeout` and `429 Rate Limited` which could indicate system-level issues (upstream timeouts, rate limiting from dependencies). These are valuable signals that differ from typical 400/401/404 client errors.

**Impact:** Potential blind spot for monitoring systemic timeout or throttling issues.

---

## Files with No Significant Issues

- `lib/validation/helpers.ts` — Clean, well-structured
- `lib/validation/common.ts` — Clean
- `lib/validation/users.ts` — Clean
- `lib/validation/media.ts` — Clean
- `lib/validation/organizations.ts` — Minor: `slug` field doesn't validate URL-safe characters
- `lib/validation/webhooks.ts` — Very permissive `data` schema (intentional for webhook flexibility)
- `lib/validation/index.ts` — Clean re-export module
- `lib/tracer.ts` — Clean
- `lib/update-helper.ts` — Clean

---

## Priority Recommendations

1. **P0 (Fix immediately):**
   - `unsubscribe.ts`: `or(undefined, undefined)` producing overly broad queries
   - `unsubscribe.ts`: Missing unique constraint for `onConflictDoUpdate`
   - `pagination.ts`: `decodeCursor` returning `NaN`/`undefined` instead of `null`
   - `authorizers/workos-jwt.ts`: Unhandled promise rejection from timeout race

2. **P1 (Fix soon):**
   - `sanitize.ts`: `sanitizeFilename` broken for extensionless files
   - `middleware.ts`: Claims type mismatch (string vs number for `exp`/`iat`)
   - `auth.ts`: Error masking in JIT provisioning catch block
   - `db.ts`: Password URL-encoding in RDS-style connection string

3. **P2 (Fix when convenient):**
   - `types/enums.ts`: Inconsistent enum key casing
   - `cors.ts`: Missing `Vary` header in external CORS
   - `response.ts`: Misleading type name
   - Various `any` types → `unknown`
