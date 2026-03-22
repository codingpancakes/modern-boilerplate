# RailBranch Backend — Code Patterns

Follow these patterns exactly when adding new code. Reference existing handlers as examples.

---

## 1. Handler Structure (REST)

Every REST handler follows this exact shape:

```typescript
import { Logger } from "@aws-lambda-powertools/logger";
import type { Context } from "aws-lambda";
import { getUserIdFromClaims } from "../../lib/auth";
import { Errors } from "../../lib/errors";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { sanitizeObject } from "../../lib/sanitize";
import { parseBody } from "../../lib/validation/helpers";
import { userSchemas } from "../../lib/validation";

const logger = new Logger({ serviceName: "resource-action" });

/**
 * @swagger
 * /v1/resource:
 *   post:
 *     tags: [Resource]
 *     summary: Create resource
 *     security:
 *       - BearerAuth: []
 *     ...
 */
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const userId = getUserIdFromClaims(event);
  logger.appendKeys({ userId });

  const input = parseBody(event, mySchema);
  const sanitized = sanitizeObject(input);

  const db = await getDb();
  const [result] = await db.insert(table).values({ ...sanitized, userId }).returning();

  await logAudit({
    userId,
    action: AUDIT_ACTIONS.CREATE,
    resourceType: AUDIT_RESOURCE_TYPES.USER,
    resourceId: result.id,
    status: AUDIT_STATUS.SUCCESS,
  });

  return createSuccessResponse(result);
};

export const handler = withAuth(handlerFn);
```

**Rules:**
- One handler per file, named by action: `create.ts`, `update.ts`, `list.ts`, `me.ts`
- `withAuth` wraps all authenticated handlers
- `withPublicCors` wraps public/webhook handlers
- Never try-catch — middleware handles all errors
- Always `sanitizeObject()` user input before DB write
- Always `logAudit()` on mutations
- Use `parseBody(event, schema)` for POST/PATCH, `parseQuery(event, schema)` for GET

---

## 2. GraphQL Resolvers

```typescript
// Queries use DataLoaders (context.loaders.*) for N+1 prevention
user: async (_parent, { id }, context: GraphQLContext) => {
  if (!context.orgId) {
    throw new Error("Organization context required.");
  }
  const membership = await context.db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.userId, id),
      eq(organizationMembers.organizationId, context.orgId),
      eq(organizationMembers.status, "ACTIVE"),  // Always filter ACTIVE
    ),
  });
  if (!membership) throw new Error("User not found or not in your organization");
  return context.db.query.users.findFirst({ where: eq(users.id, id) });
},

// Mutations validate with Zod, sanitize, audit
updateProfile: auditResolver(async (_parent, { input }, context) => {
  const validated = userSchemas.updateProfileInput.parse(input);
  const sanitized = sanitizeObject(validated);
  const [updated] = await context.db
    .update(profiles)
    .set({ ...sanitized, updatedAt: new Date().toISOString() })
    .where(eq(profiles.userId, context.userId))
    .returning();
  return updated;
}, { /* audit config */ }),
```

**Rules:**
- All membership queries must filter `status = "ACTIVE"`
- DataLoaders in `context.ts` also filter ACTIVE
- Validate with Zod `.parse()` on all mutation inputs
- `sanitizeObject()` before DB write
- Use `auditResolver()` wrapper or `void logAudit()` for fire-and-forget audit

---

## 3. Validation (Zod)

Schemas live in `src/node/lib/validation/` organized by domain:

```
validation/
├── users.ts          # createUser, updateUser, updateProfileInput, updateUserProfile
├── media.ts          # uploadImageRequest, uploadImageDirectRequest, listImagesQuery
├── organizations.ts  # createOrganization, createOrgUnit
├── webhooks.ts       # workos webhook event schema
├── common.ts         # pagination, uuid params
├── helpers.ts        # parseBody(), parseQuery(), validate()
└── index.ts          # Re-exports all schemas
```

**Adding a new schema:**
1. Add to the appropriate domain file (or create new one)
2. Export via the `schemas` object at bottom of domain file
3. Export from `index.ts`
4. Use with `parseBody(event, mySchemas.create)` in handler

```typescript
// validation/tasks.ts
export const createTask = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

export const taskSchemas = { create: createTask };
```

---

## 4. Database (Drizzle ORM)

Schema in `src/node/db/schema/` — one file per domain.

```typescript
// Select
const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

// Insert with returning
const [result] = await db.insert(profiles).values({ userId }).returning();

// Update with returning
const [updated] = await db
  .update(users)
  .set({ firstName: input.firstName, updatedAt: new Date().toISOString() })
  .where(eq(users.id, userId))
  .returning();

// Parallel queries
const [userRows, profileRows] = await Promise.all([
  db.select().from(users).where(eq(users.id, userId)).limit(1),
  db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
]);
```

**Rules:**
- Never raw SQL
- Always `.limit(1)` on single-row queries
- Use `Promise.all()` for independent queries
- Connection via `const db = await getDb();` (handles retry + pooling)

---

## 5. Media / S3

All image uploads follow the same pattern:

```typescript
const command = new PutObjectCommand({
  Bucket: IMAGES_BUCKET,
  Key: `users/${userId}/${category}/${timestamp}_${randomUUID()}_${sanitizedFilename}`,
  ContentType: input.contentType,
  ServerSideEncryption: "AES256",    // Always
  Metadata: { userId, originalFilename, uploadedAt },
});
```

- Validate contentType against allowlist: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Validate file extension matches contentType
- No SVG allowed
- Return CDN URL: `${IMAGES_CDN_URL}/${key}` — never raw S3 URL
- Never expose bucket name in response

---

## 6. Audit Logging

```typescript
import { logAudit, AUDIT_ACTIONS, AUDIT_STATUS, AUDIT_RESOURCE_TYPES } from "../../lib/audit";

await logAudit({
  userId,
  organizationId,     // optional
  orgUnitId,          // optional
  action: AUDIT_ACTIONS.CREATE,    // CREATE, UPDATE, DELETE, ACCESS_DENIED
  resourceType: AUDIT_RESOURCE_TYPES.USER,  // USER, PROFILE, ORGANIZATION, MEDIA, WEBHOOK, API_KEY, SETTINGS
  resourceId: result.id,
  changes: { before: oldData, after: newData },  // for updates
  status: AUDIT_STATUS.SUCCESS,
  metadata: { source: "rest" },
});
```

- Log all mutations (create, update, delete)
- Include `before` + `after` for updates
- Fire-and-forget in GraphQL: `void logAudit({...})`
- Await in REST handlers for reliability

---

## 7. Error Handling

```typescript
import { Errors } from "../../lib/errors";

throw Errors.BadRequest("Invalid input");
throw Errors.Unauthorized();
throw Errors.NotFound("Resource");
throw Errors.Forbidden();
throw Errors.Conflict("Resource already exists");
throw Errors.RateLimited();
throw Errors.InternalServerError();
```

Never return error responses directly. Throw and let middleware format.

---

## 8. Response Helpers

```typescript
import { createSuccessResponse, createNoContentResponse } from "../../lib/response";

return createSuccessResponse(data);           // 200 + JSON
return createSuccessResponse({ user, profile }); // 200 + JSON
return createNoContentResponse();             // 204, no body
```

---

## 9. CORS

- `withAuth` middleware adds CORS headers automatically
- `withPublicCors` for public/webhook endpoints
- Origin checked against `CORS_EXACT_ORIGINS`, `CORS_PARENT_DOMAINS`, `CORS_DOMAIN_PATTERNS`
- Dev mode allows `localhost:3000`, `localhost:5173`

---

## 10. Webhook Handlers

```typescript
// workos.ts pattern
const handlerFn = async (event, context) => {
  // 1. Verify signature (timing-safe)
  // 2. Parse + validate with Zod
  // 3. Atomic idempotency: INSERT ON CONFLICT DO NOTHING + check rowCount
  // 4. Process event in switch
  // 5. Mark idempotency key "completed"
  // 6. Compensating delete if multi-insert fails (neon-http has no transactions)
};
export const handler = withPublicCors(handlerFn);
```

---

## Checklist: New Handler

- [ ] Handler file in `src/node/handlers/{domain}/{action}.ts`
- [ ] Zod schema in `src/node/lib/validation/{domain}.ts`
- [ ] Schema exported from `validation/index.ts`
- [ ] Uses `parseBody()` / `parseQuery()` for validation
- [ ] Uses `sanitizeObject()` before DB write
- [ ] Uses `createSuccessResponse()` for response
- [ ] Uses `logAudit()` for mutations
- [ ] Has `@swagger` JSDoc comment
- [ ] Route registered in `local-dev/server.ts`
- [ ] Lint + typecheck pass
