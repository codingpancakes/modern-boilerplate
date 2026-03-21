# Handler Deep Code Audit Report

**Date:** 2026-03-21  
**Scope:** All files in `src/node/handlers/` — correctness, reliability, edge cases  
**NOT a security audit** — focuses on logic errors, data integrity, and robustness  

---

## Table of Contents
1. [Critical / Bug](#1-critical--bug)
2. [Logic Errors](#2-logic-errors)
3. [Data Integrity](#3-data-integrity)
4. [Edge Cases](#4-edge-cases)
5. [Performance](#5-performance)
6. [Code Quality](#6-code-quality)
7. [GraphQL Schema ↔ Resolver Mismatches](#7-graphql-schema--resolver-mismatches)

---

## 1. Critical / Bug

### 1.1 WorkOS Webhook: User creation is NOT transactional — partial writes possible
**File:** `src/node/handlers/webhooks/workos.ts` — lines ~202–230  
**Severity:** Bug  

```ts
// Create new user and auth identity
const [newUser] = await db
    .insert(users)
    .values({ ... })
    .returning({ id: users.id });

// Create profile record
await db.insert(profiles).values({ userId: newUser.id });

// Create auth identity
await db.insert(authIdentities).values({ ... });
```

**What's wrong:** Three separate INSERT statements are executed outside a transaction. If the `profiles` or `authIdentities` insert fails (e.g. unique constraint, transient DB error), the user row exists in `users` but has no profile or no auth identity. Subsequent webhook retries will find an `authIdentities` record (or not) and take the wrong branch.

**Impact:** Orphaned user records with missing profiles or auth identities. The user cannot log in (no `authIdentities` match) but the email uniqueness constraint blocks re-creation. Manual database intervention would be required.

---

### 1.2 WorkOS Webhook: Idempotency key inserted BEFORE processing — stays "processing" on failure
**File:** `src/node/handlers/webhooks/workos.ts` — lines ~180–192  
**Severity:** Bug  

```ts
// Store idempotency key
await db.insert(idempotencyKeys).values({
    key: idempotencyKey,
    requestHash: webhookEvent.id,
    status: "processing",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
});

// Process based on event type
switch (webhookEvent.event) { ... }

// Mark idempotency key as completed (only reached on success)
await db.update(idempotencyKeys).set({ status: "completed", ... })
```

**What's wrong:** If processing throws an error, the catch block at line ~294 returns a formatted error response but **never** updates the idempotency key status back from `"processing"`. On WorkOS retry, the duplicate-event check at line ~171 finds the key and returns `"Event already processed"` — the event is silently dropped forever (until the key expires after 7 days).

**Impact:** Failed webhook events are permanently lost for up to 7 days. Users may not be provisioned, organizations may not be created.

---

### 1.3 WorkOS Webhook: `user.deleted` has no audit logging and no error on missing user
**File:** `src/node/handlers/webhooks/workos.ts` — lines ~255–270  
**Severity:** Bug  

```ts
case "user.deleted": {
    const userData = webhookEvent.data as WorkOSUserData;
    const [authIdentity] = await db.select(...)...

    if (authIdentity?.userId) {
        await db.delete(users).where(eq(users.id, authIdentity.userId));
    }
    break;
}
```

**What's wrong:** 
1. No audit log is written for user deletion — unlike `user.created`/`user.updated` which both audit.
2. If no matching `authIdentity` is found, the event silently succeeds. This means the idempotency key is marked "completed" and the event can never be reprocessed, even though the user was never actually deleted.

**Impact:** Missing audit trail for user deletions (compliance gap). Phantom users that WorkOS considers deleted but remain in the local database.

---

### 1.4 Test webhook handler: Signature validation is a no-op
**File:** `src/node/handlers/test/webhook.ts` — lines ~46–51  
**Severity:** Bug  

```ts
const _validateSignature = (signature: string, body: string): boolean => {
    const expectedSignature = crypto.createHmac("sha256", WEBHOOK_SECRET)
        .update(body).digest("hex");
    return signature === expectedSignature;
};

// Use withWebhookSignature middleware
export const handler = withWebhookSignature((signature: string) => {
    // In real implementation, we'd need the body to validate
    // For now, just check if signature exists
    return signature.length > 0;
}, handlerFn);
```

**What's wrong:** The actual HMAC validation function `_validateSignature` is never used (note the `_` prefix — dead code). The middleware accepts ANY non-empty string as a valid signature. The comment acknowledges this is incomplete.

**Impact:** If this endpoint is ever exposed in production, any request with a non-empty `X-Webhook-Signature` header is accepted — no actual signature verification occurs.

---

## 2. Logic Errors

### 2.1 Media resolver: S3 prefix path missing `users/` segment  
**File:** `src/node/handlers/graphql/resolvers/media.ts` — lines ~24–26  
**Severity:** Logic Error  

```ts
// GraphQL resolver
const prefix = category
    ? `${context.userId}/${category}/`
    : `${context.userId}/`;
```

vs. in the REST handler (`list-images.ts` line ~91):
```ts
let prefix = `users/${userId}/`;
if (category) { prefix += `${category}/`; }
```

**What's wrong:** The REST handler uses `users/{userId}/` as prefix, but the GraphQL resolver uses just `{userId}/`. Since images are uploaded to `users/{userId}/{category}/...`, the GraphQL `images` query will return **zero results** — it's looking in the wrong path.

**Impact:** The GraphQL `images` query is completely broken — it returns empty results even when images exist.

---

### 2.2 Media resolver: `total` field returns page count, not true total
**File:** `src/node/handlers/graphql/resolvers/media.ts` — line ~44  
**Severity:** Logic Error  

```ts
return {
    images,
    total: images.length, // ← This is the count of THIS PAGE, not the total
    continuationToken: response.NextContinuationToken || null,
};
```

**What's wrong:** The `total` field in the `ImageList` GraphQL type is documented/named to suggest total image count, but it only returns the count of the current page. S3 `ListObjectsV2` does not return a total count, so this is misleading. The schema declares `total: Int!` which consumers will treat as the true total.

**Impact:** Client applications using pagination will display wrong totals. For example, showing "3 of 3 images" when there are actually 100.

---

### 2.3 Media resolver: Image category extraction uses wrong path index
**File:** `src/node/handlers/graphql/resolvers/media.ts` — line ~41  
**Severity:** Logic Error  

```ts
category: item.Key?.split("/")[1] || null,
```

Given the upload path is `users/{userId}/{category}/{timestamp}_{uuid}_{filename}`, the key parts are:
- `[0]` = `users`
- `[1]` = `{userId}`  ← **This is returned as `category`!**
- `[2]` = `{category}`

But since the resolver already uses the wrong prefix (bug 2.1), and the split index is `[1]`, it would return the userId as the category.

**Impact:** Category data in GraphQL responses is the user ID, not the actual category.

Compare with the correct implementation in `list-images.ts` line ~104:
```ts
const categoryFromPath = parts.length > 3 ? parts[3] : "general";
// index 3 is wrong too but at least uses a different logic
```

Note: `list-images.ts` also has an issue — for a path like `users/uuid/profile/file.jpg`, the parts are `[users, uuid, profile, file.jpg]`, so `parts[3]` is the filename, not the category. The correct index is `[2]`.

---

### 2.4 list-images.ts: Category extraction from path uses wrong index
**File:** `src/node/handlers/media/list-images.ts` — line ~104  
**Severity:** Logic Error  

```ts
const categoryFromPath = parts.length > 3 ? parts[3] : "general";
```

For key `users/{userId}/{category}/{timestamp}_{uuid}_{filename}`:
- `parts[0]` = `users`
- `parts[1]` = `{userId}`
- `parts[2]` = `{category}` ← correct
- `parts[3]` = `{filename}` ← this is what's returned

**Impact:** Category in list-images response is actually the filename with timestamp prefix, not the category.

---

### 2.5 list-images.ts: Image URL uses raw S3 URL instead of CDN
**File:** `src/node/handlers/media/list-images.ts` — line ~103  
**Severity:** Logic Error  

```ts
url: `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`,
```

**What's wrong:** The `upload-image.ts` handler returns `CDN_URL` in the response and validates that `CDN_URL` exists, but `list-images.ts` constructs raw S3 URLs using the bucket name. The bucket may not have public access, and this bypasses CloudFront CDN entirely.

**Impact:** URLs in list responses may be inaccessible (if bucket is private, which it likely is since uploads use CDN). Inconsistent URL format between upload and list responses.

---

### 2.6 GraphQL context: `orgId` defaults to empty string, not null
**File:** `src/node/handlers/graphql/context.ts` — line ~22  
**Severity:** Logic Error  

```ts
orgId: (claims.org_id as string) || "",
```

**What's wrong:** When `org_id` is not present in claims, `orgId` becomes `""`. Downstream code (e.g., `user` resolver) does `eq(organizationMembers.organizationId, context.orgId)` which queries for organizations with empty-string ID instead of skipping the filter or returning an error.

**Impact:** The `user(id)` query silently matches nothing (no org has ID `""`), so it always returns "User not found or not in your organization" for users without an org claim — even if both users are actually in the same org.

---

### 2.7 Users resolver `user` query: can return null after membership check passes
**File:** `src/node/handlers/graphql/resolvers/users.ts` — lines ~28–45  
**Severity:** Logic Error  

```ts
user: async (_parent, { id }, context) => {
    const membership = await context.db.query.organizationMembers.findFirst({
        where: and(
            eq(organizationMembers.userId, id),
            eq(organizationMembers.organizationId, context.orgId),
        ),
    });
    if (!membership) {
        throw new Error("User not found or not in your organization");
    }
    // This can return undefined if user was deleted between the two queries
    const user = await context.db.query.users.findFirst({
        where: eq(users.id, id),
    });
    return user; // potentially undefined
},
```

**What's wrong:** The GraphQL schema declares `user(id: ID!): User` (nullable return). However, after confirming membership exists, the code doesn't check if the user actually exists before returning. The `findFirst` can return `undefined`. While GraphQL will serialize this as `null`, it's a logic gap — if membership exists but the user was deleted (cascade didn't clean up memberships, or race condition), the client gets `null` with no error explanation.

**Impact:** Silent null response after passing authorization check. Client has no way to distinguish "not authorized" from "user deleted."

---

## 3. Data Integrity

### 3.1 Users update handler: Two-table update without transaction
**File:** `src/node/handlers/users/update.ts` — lines ~72–93  
**Severity:** Data Integrity  

```ts
// Update user table if user fields provided
if (updates.user) {
    await db.update(users).set(updates.user).where(eq(users.id, userId));
}

// Update profile table if profile fields provided
if (updates.profile) {
    await db.update(profiles).set(updates.profile).where(eq(profiles.userId, userId));
}
```

**What's wrong:** The user and profile tables are updated in separate statements without a transaction. If the second update fails, the first update is already committed, leaving the data in a partially-updated state.

**Impact:** User sees inconsistent data (e.g., name changed but profile photo URL unchanged despite both being in the same request). The audit log records "before" and "after" snapshots, but the "after" state may not reflect what actually persisted.

---

### 3.2 Users update handler: Audit log records stale "after" data on partial failure
**File:** `src/node/handlers/users/update.ts` — lines ~95–108  
**Severity:** Data Integrity  

```ts
// Fetch updated user and profile
const [updatedUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
const [updatedProfile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);

await logAudit({ changes: { before: {...}, after: { user: updatedUser, profile: updatedProfile } } });
```

**What's wrong:** If `updatedUser` or `updatedProfile` is `undefined` (user/profile row doesn't exist), the audit log records `undefined` in the "after" snapshot. The code assumes both exist.

**Impact:** Audit log may contain `undefined` values, making it unreliable for compliance.

---

### 3.3 GraphQL `updateMyAccount`: Two updates without transaction
**File:** `src/node/handlers/graphql/resolvers/users.ts` — lines ~115–148  
**Severity:** Data Integrity  

```ts
if (args.user && Object.keys(args.user).length > 0) {
    [updatedUser] = await context.db.update(users).set({...}).where(...).returning();
}
if (args.profile && Object.keys(args.profile).length > 0) {
    [updatedProfile] = await context.db.update(profiles).set({...}).where(...).returning();
}
```

**What's wrong:** Same issue as 3.1 — two tables updated without a transaction. The mutation name `updateMyAccount` implies atomicity.

**Impact:** Same as 3.1 — partial updates are possible.

---

### 3.4 GraphQL `updateMyAccount`: No audit logging
**File:** `src/node/handlers/graphql/resolvers/users.ts` — lines ~108–175  
**Severity:** Data Integrity  

**What's wrong:** `updateMe` and `updateProfile` are wrapped in `auditResolver`, but `updateMyAccount` — which updates both — has **no** audit logging at all.

**Impact:** Changes made via `updateMyAccount` mutation are not tracked in the audit log. This is a compliance gap since the same changes via `updateMe` + `updateProfile` ARE audited.

---

### 3.5 GraphQL `updateProfile`: No input validation
**File:** `src/node/handlers/graphql/resolvers/users.ts` — lines ~93–106  
**Severity:** Data Integrity  

```ts
updateProfile: auditResolver(
    async (_parent, { input }, context) => {
        const sanitized = sanitizeObject(input);
        const [updated] = await context.db.update(profiles).set({
            ...sanitized,
            updatedAt: new Date().toISOString(),
        }).where(eq(profiles.userId, context.userId)).returning();
        return updated;
    },
    { ... }
),
```

**What's wrong:** `updateMe` validates input with `userSchemas.update.parse(input)`, but `updateProfile` only sanitizes — it does NOT validate against any schema. Any arbitrary field names and values can be passed and spread into the `.set()` call.

**Impact:** Invalid field names are silently ignored by Drizzle (no harm), but invalid values (e.g., `onboardingCompleted: "yes"` instead of `true`) may be persisted if the DB column accepts it. More importantly, the `sanitizeObject` function HTML-escapes strings, which may corrupt data like URLs in `photoUrl`.

---

### 3.6 `sanitizeObject` HTML-escapes ALL strings including URLs
**File:** `src/node/lib/sanitize.ts` — `sanitizeObject` function  
**Severity:** Data Integrity  

```ts
export function sanitizeObject<T extends Record<string, unknown>>(obj: T, ...): T {
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string") {
            sanitized[key] = sanitizeString(value, { ... });
        }
        ...
    }
}
```

And `sanitizeString` calls `escapeHtml` by default:
```ts
export function escapeHtml(input: string): string {
    return input.replace(/[&<>"'/]/g, (char) => htmlEscapeMap[char] || char);
}
```

**What's wrong:** When `sanitizeObject` is used on profile updates (resolvers `updateProfile`, `updateMyAccount`), it HTML-escapes ALL string values. This means a `photoUrl` like `https://cdn.example.com/img?size=200&format=webp` becomes `https:&#x2F;&#x2F;cdn.example.com&#x2F;img?size=200&amp;format=webp` — a completely broken URL.

**Impact:** URLs stored in the database are corrupted. Profile photo URLs, and any string containing `&`, `'`, `"`, `/`, `<`, or `>` will be mangled. This affects every write path that uses `sanitizeObject`.

---

## 4. Edge Cases

### 4.1 upload-image.ts: Filename without extension passes validation incorrectly
**File:** `src/node/handlers/media/upload-image.ts` — lines ~86–88  
**Severity:** Edge Case  

```ts
const fileExtension = input.filename.split(".").pop()?.toLowerCase() || "";
if (!ALLOWED_FILE_EXTENSIONS.IMAGE.includes(fileExtension as any)) {
```

**What's wrong:** If `filename` is `"photo"` (no dot), `split(".").pop()` returns `"photo"`, which is not in the allowed list — this works correctly. But if filename is `"photo."` (trailing dot), `pop()` returns `""`, and the empty string check `|| ""` doesn't help — it falls through to the includes check which correctly rejects it. Actually, this specific case is fine.

However, `ALLOWED_FILE_EXTENSIONS.IMAGE` includes `"svg"`, but the `contentTypeMap` at line ~92 does NOT include `image/svg+xml`. So SVG files pass the extension check but fail the contentType-extension match — resulting in a confusing error message about content type not matching extension, when the real issue is SVG uploads aren't supported in the presigned URL flow.

**Impact:** Confusing error messages for SVG uploads. Users may think they have the wrong content type when SVG is simply not supported.

---

### 4.2 upload-image-direct.ts: No file extension or content-type validation
**File:** `src/node/handlers/media/upload-image-direct.ts` — lines ~75–100  
**Severity:** Edge Case  

**What's wrong:** Unlike `upload-image.ts`, this handler does NOT validate that the file extension matches the content type, and does NOT check against `ALLOWED_FILE_EXTENSIONS`. The Zod schema validates `contentType` is one of the allowed MIME types, but a user could submit `contentType: "image/jpeg"` with `filename: "script.exe"` — the file would be stored with the `.exe` extension.

**Impact:** Filenames don't have to match content types. While the content is still validated as base64 image data by the schema, the mismatch could cause issues downstream (CDN serving, content-type headers on download).

---

### 4.3 upload-image-direct.ts: Base64 validation is insufficient
**File:** `src/node/handlers/media/upload-image-direct.ts` — lines ~83–88  
**Severity:** Edge Case  

```ts
try {
    const base64Data = input.imageData.replace(/^data:[^;]*;base64,/, "");
    imageBuffer = Buffer.from(base64Data, "base64");
} catch (_error) {
    throw Errors.BadRequest("Invalid base64 image data");
}
```

**What's wrong:** `Buffer.from(str, "base64")` does NOT throw on invalid base64 — it silently ignores invalid characters. So the try/catch never catches base64 decoding errors. A string like `"not-base64-at-all!!!"` will decode to a (garbage) buffer without error, and get uploaded to S3.

**Impact:** Garbage data can be uploaded to S3 as "images." No actual image validation occurs — the content could be anything.

---

### 4.4 upload-image-direct.ts: Lambda payload size limit (~6MB) vs 10MB max
**File:** `src/node/handlers/media/upload-image-direct.ts` — line ~90  
**Severity:** Edge Case  

```ts
const maxSize = 10 * 1024 * 1024; // 10MB
if (imageBuffer.length > maxSize) {
```

**What's wrong:** API Gateway has a ~10MB payload limit, and Lambda has a ~6MB invocation payload limit for synchronous invocations. Since the image data is base64-encoded in the JSON body (which adds ~33% overhead), an image larger than ~4.5MB will exceed the Lambda payload limit before this check runs. The 10MB check is unreachable for images over ~4.5MB.

**Impact:** Users get cryptic API Gateway 413 errors instead of the friendly "Image size exceeds maximum" message. The 10MB limit is misleading.

---

### 4.5 WorkOS webhook: `organization.deleted` doesn't handle cascade effects
**File:** `src/node/handlers/webhooks/workos.ts` — lines ~279–284  
**Severity:** Edge Case  

```ts
case "organization.deleted": {
    const orgData = webhookEvent.data as WorkOSOrgData;
    await db.delete(organizations).where(eq(organizations.workosOrgId, orgData.id));
    break;
}
```

**What's wrong:** Deleting an organization cascades to `orgUnits`, `organizationMembers`, `groups`, `groupMemberships`, and `resourceOwners` (per FK constraints). But there's no audit logging, no notification, and no verification that the deletion actually deleted a row (the org may not exist locally).

**Impact:** Massive cascade delete with no audit trail. If the org doesn't exist locally, the event is silently marked as "processed."

---

### 4.6 WorkOS webhook: `user.created` and `user.updated` share the same code path but behave differently for existing users
**File:** `src/node/handlers/webhooks/workos.ts` — lines ~195–250  
**Severity:** Edge Case  

```ts
case "user.created":
case "user.updated": {
```

**What's wrong:** A `user.created` event for a user that already exists (due to JIT provisioning in `getUserIdFromClaims`) falls through to the "update" branch. This is actually handled correctly — but the audit log records `AUDIT_ACTIONS.UPDATE` even though the webhook event was `user.created`. The `eventType` in metadata is correct, but the `action` field is misleading for the first create-via-update path.

**Impact:** Minor audit log inaccuracy — `user.created` events for JIT-provisioned users show as `UPDATE` instead of `CREATE`.

---

### 4.7 Users `me` handler: Throws Unauthorized instead of NotFound
**File:** `src/node/handlers/users/me.ts` — lines ~58–61  
**Severity:** Edge Case  

```ts
if (userResult.length === 0) {
    logger.error("User record not found after auth lookup");
    throw Errors.Unauthorized();
}
```

**What's wrong:** If `getUserIdFromClaims` succeeds (returns a valid userId from authIdentities), but the user row was deleted (e.g., by admin, cascade, or race condition), the handler returns 401 Unauthorized instead of 404 Not Found. The user IS authenticated (valid JWT, valid auth identity) — the issue is the user record is missing.

**Impact:** Misleading error. Client may retry authentication when the real issue is a missing DB record. This could cause infinite auth retry loops.

---

## 5. Performance

### 5.1 Users update handler: 4 sequential DB queries where 2 would suffice
**File:** `src/node/handlers/users/update.ts` — lines ~72–108  
**Severity:** Performance  

```ts
// 1. Fetch current user (for audit "before")
const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
// 2. Fetch current profile (for audit "before")
const [currentProfile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
// 3. Update user
await db.update(users).set(updates.user).where(eq(users.id, userId));
// 4. Update profile
await db.update(profiles).set(updates.profile).where(eq(profiles.userId, userId));
// 5. Fetch updated user (for audit "after")
const [updatedUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
// 6. Fetch updated profile (for audit "after")
const [updatedProfile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
// 7. Log audit
await logAudit({ ... });
```

**What's wrong:** 6 sequential DB queries + 1 audit insert = 7 DB round trips per update. The "before" fetches could use `RETURNING` on the update, and the two "before" fetches could be parallelized with `Promise.all`. Similarly, the two "after" fetches and the two updates could be parallelized.

**Impact:** Each update request takes ~7× the single-query latency. On a serverless Neon connection, this adds up significantly.

---

### 5.2 GraphQL N+1: User.profile, User.organizations are per-row field resolvers
**File:** `src/node/handlers/graphql/resolvers/users.ts` — lines ~178–198  
**Severity:** Performance  

```ts
User: {
    profile: async (user, _args, context) => {
        return context.db.query.profiles.findFirst({
            where: eq(profiles.userId, user.id),
        });
    },
    organizations: async (user, _args, context) => {
        return context.db.query.organizationMembers.findMany({
            where: eq(organizationMembers.userId, user.id),
        });
    },
},
```

**What's wrong:** Classic N+1 problem. If a query returns 10 users, each user triggers 2 additional DB queries (profile + organizations). That's 1 + 10×2 = 21 queries. No DataLoader or batching is used.

**Impact:** Queries involving lists of users (e.g., organization members) will scale poorly. 100 members = 201 DB queries.

---

### 5.3 GraphQL N+1: OrganizationMembership.user and .organization
**File:** `src/node/handlers/graphql/resolvers/users.ts` — lines ~210–226  
**Severity:** Performance  

```ts
OrganizationMembership: {
    user: async (membership, _args, context) => {
        return context.db.query.users.findFirst({ where: eq(users.id, membership.userId) });
    },
    organization: async (membership, _args, context) => {
        return context.db.query.organizations.findFirst({ where: eq(organizations.id, membership.organizationId) });
    },
},
```

**What's wrong:** Same N+1 issue. Requesting `myOrganizations { user { ... } organization { ... } }` triggers 2 queries per membership.

**Impact:** Queries can easily generate 50+ DB queries for users with many memberships.

---

### 5.4 list-images.ts: Default limit is read from validation schema (20) but documentation says 100
**File:** `src/node/handlers/media/list-images.ts` — swagger docs vs. validation  
**Severity:** Code Quality / Edge Case  

Swagger docs say `default: 100, maximum: 1000`, but the Zod schema in `media.ts` says:
```ts
limit: z.coerce.number().min(1).max(100).default(20),
```

**Impact:** Documentation is misleading. Max is 100 (not 1000) and default is 20 (not 100).

---

## 6. Code Quality

### 6.1 GraphQL docs handler: Loads external scripts from unpkg CDN
**File:** `src/node/handlers/graphql/docs.ts` — lines ~51–63  
**Severity:** Code Quality  

```html
<link rel="stylesheet" href="https://unpkg.com/graphiql@3.0.0/graphiql.min.css" />
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/graphiql@3.0.0/graphiql.min.js"></script>
```

**What's wrong:** External CDN dependency. If unpkg goes down, the docs page breaks. Also, React 18 is loaded without a version lock (any 18.x), which could break with minor updates.

**Impact:** Reliability dependency on third-party CDN. Not a code bug, but a reliability concern for a production system.

---

### 6.2 Test API key handler: Hardcoded fallback API key
**File:** `src/node/handlers/test/api-key.ts` — line ~37  
**Severity:** Code Quality  

```ts
const EXPECTED_API_KEY = process.env.TEST_API_KEY || "test-api-key-12345";
```

**What's wrong:** Hardcoded fallback key. If `TEST_API_KEY` env var is not set in production, this endpoint is accessible with a well-known key.

**Impact:** If deployed to production without the env var set, anyone can access this endpoint with the hardcoded key. (This may be intentional for test-only endpoints — flagging for awareness.)

---

### 6.3 Dead code: Unused tracer variable in webhook handler
**File:** `src/node/handlers/webhooks/workos.ts` — line ~11  
**Severity:** Code Quality  

```ts
const _tracer = new Tracer({ serviceName: "workos-webhook" });
```

**What's wrong:** `_tracer` is declared but never used (underscore prefix convention for unused variables).

**Impact:** Unnecessary import and instantiation on every cold start. Minor memory/startup impact.

---

### 6.4 Dead code: Unused tracer variable in janitor handler
**File:** `src/node/handlers/utils/janitor.ts` — line ~4  
**Severity:** Code Quality  

```ts
const _tracer = new Tracer({ serviceName: "idempotency-janitor" });
```

Same as 6.3 — declared but never used.

---

### 6.5 Webhook handler: Emoji in log messages
**File:** `src/node/handlers/webhooks/workos.ts` — throughout  
**Severity:** Code Quality  

```ts
logger.info("🔔 Webhook received", { ... });
logger.info("🔐 Verifying signature...");
logger.info("✅ Signature verified");
```

**What's wrong:** Emojis in structured log messages can cause issues with log parsing tools, CloudWatch Insights queries, and log aggregators. They also make grep/search harder.

**Impact:** Minor — log searchability and parsing issues.

---

### 6.6 GraphQL handler: `mediaResolvers` missing from type resolver map
**File:** `src/node/handlers/graphql/handler.ts` — lines ~14–23  
**Severity:** Code Quality  

```ts
const resolvers = {
    Query: {
        ...userResolvers.Query,
        ...mediaResolvers.Query,
    },
    Mutation: {
        ...userResolvers.Mutation,
        ...mediaResolvers.Mutation,
    },
    User: userResolvers.User,
    Profile: userResolvers.Profile,
    OrganizationMembership: userResolvers.OrganizationMembership,
    Organization: userResolvers.Organization,
    // Note: No Image, ImageList, or ImageUploadUrl type resolvers
};
```

**What's wrong:** Not necessarily a bug — the media types (`Image`, `ImageList`, `ImageUploadUrl`) don't need custom field resolvers since all fields are returned directly from the query/mutation resolvers. But if custom scalar resolvers for `DateTime` or `JSON` are ever needed, they're not registered here.

**Impact:** The `DateTime` and `JSON` scalars declared in `scalars.graphql` have no resolver implementations. Apollo Server will use the default `GraphQLScalarType` which passes values through as-is. This works for strings but means `DateTime` is not actually validated as a date.

---

## 7. GraphQL Schema ↔ Resolver Mismatches

### 7.1 `Organization.members` resolver exists but `myOrganizations` query may not resolve `Organization` fields
**File:** Schema: `organizations.graphql`, Resolver: `users.ts`  
**Severity:** Edge Case  

The `myOrganizations` query returns `[OrganizationMembership!]!`, and each `OrganizationMembership` has an `organization` field resolver. But the `Organization` type declares `members: [OrganizationMembership!]!` — if a client queries `myOrganizations { organization { members { user { ... } } } }`, this triggers the N+1 chain: memberships → organization → members → user.

**Impact:** Deep nested queries can cause exponential DB queries. The `depthLimit(10)` validation rule helps but still allows significant depth.

---

### 7.2 Schema declares `OrganizationMembership.joinedAt: DateTime!` (non-null) but DB column has default
**File:** Schema: `organizations.graphql`, DB: `organizations.ts`  
**Severity:** Edge Case  

The `joinedAt` field is non-null in the schema (`DateTime!`) and has a `.defaultNow()` in the DB. The field resolver fetches from `organizationMembers` table which uses `.defaultNow()` — so this should be fine. However, there's no explicit field resolver for `joinedAt` on `OrganizationMembership` type, so it relies on the default field resolution which looks for a `joinedAt` property on the parent object. If the DB returns the column as `created_at` (snake_case), this could be `null`.

**Impact:** Depends on whether Drizzle maps `joined_at` to `joinedAt` in the result — Drizzle does handle this via the column definition (`timestamp("joined_at", ...)`), so this should work. Flagging for verification.

---

### 7.3 `Profile.onboardingCompleted` declared as `Boolean!` (non-null) but DB default may not be set
**File:** Schema: `users.graphql`, DB: `users.ts`  
**Severity:** Edge Case  

```graphql
onboardingCompleted: Boolean!
```

DB schema:
```ts
onboardingCompleted: boolean("onboarding_completed").default(false),
```

The DB has a default of `false`, but if a profile row was inserted before this column was added (migration), existing rows may have `null`. The GraphQL schema says non-null (`Boolean!`), so returning `null` would cause a GraphQL error.

**Impact:** Potential runtime GraphQL errors for legacy profile rows where `onboarding_completed` is `NULL`.

---

## Summary

| Severity | Count |
|----------|-------|
| Bug | 4 |
| Logic Error | 7 |
| Data Integrity | 6 |
| Edge Case | 7 |
| Performance | 4 |
| Code Quality | 6 |
| **Total** | **34** |

### Top 5 Priority Fixes

1. **Wrap webhook user-creation in a DB transaction** (Bug 1.1) — prevents orphaned users
2. **Fix webhook idempotency key status on failure** (Bug 1.2) — prevents permanently lost events
3. **Fix GraphQL media resolver S3 prefix path** (Logic Error 2.1) — images query is completely broken
4. **Fix `sanitizeObject` to not escape URLs/special chars in data fields** (Data Integrity 3.6) — corrupts stored data
5. **Add transactions to multi-table updates** (Data Integrity 3.1, 3.3) — prevents partial writes
