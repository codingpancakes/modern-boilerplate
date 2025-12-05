# How to Use Handler Templates

This guide explains how to use the handler templates to create new API endpoints quickly and consistently.

## Available Templates

| Template | Use Case | Location |
|----------|----------|----------|
| **user-scoped** | User's own data (no org required) | `/templates/user-scoped.ts.template` |
| **org-scoped** | Organization resources | `/templates/org-scoped.ts.template` |
| **public** | Public endpoints, webhooks | `/templates/public.ts.template` |

---

## Quick Start: Creating a New Handler

### Step 1: Choose the Right Template

**Ask yourself:** Does this endpoint require organization membership?

- **NO** → Use `user-scoped.ts`
  - Examples: `/users/me`, `/media/upload`, `/profile/settings`
  
- **YES** → Use `org-scoped.ts`
  - Examples: `/orgs/{orgId}/campaigns`, `/orgs/{orgId}/contacts`
  
- **Public/Webhook** → Use `public.ts`
  - Examples: `/health`, `/webhooks/stripe`

### Step 2: Copy Template to New Location

```bash
# Example: Creating a new journey handler
cp templates/user-scoped.ts.template src/node/handlers/journeys/create.ts
```

**Note:** Templates use `.ts.template` extension to avoid TypeScript compilation errors. When you copy, rename to `.ts`.

### Step 3: Update the Handler

1. **Change service name** (line ~19)
   ```typescript
   const logger = new Logger({ serviceName: 'journeys-create' });
   ```

2. **Update Swagger docs** (lines ~21-60)
   ```typescript
   /**
    * @swagger
    * /v1/journeys:
    *   post:
    *     tags: [Journeys]
    *     summary: Create journey
    *     ...
    */
   ```

3. **Add Zod schema** in appropriate domain file
   ```typescript
   // src/node/lib/validation/users.ts (or appropriate domain)
   export const createJourneySchema = z.object({
     name: z.string().min(1).max(200),
     description: z.string().optional(),
     steps: z.array(z.object({
       type: z.string(),
       config: z.record(z.unknown()),
     })),
   });
   ```
   
   Then export in `src/node/lib/validation/index.ts`:
   ```typescript
   export const journeySchemas = {
     create: journeyValidation.createJourneySchema,
     // ...
   };
   ```

4. **Implement handler logic**
   ```typescript
   import { createSuccessResponse } from '../../lib/response';
   import { parseBody, journeySchemas } from '../../lib/validation';
   
   const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
     logger.addContext(context);
     const userId = event.claims.sub;
     logger.appendKeys({ userId });
   
     logger.info('Creating journey');
   
     // Validate input
     const input = parseBody(event, journeySchemas.create);
   
     // Database operations
     const db = await getDb();
     const [result] = await db
       .insert(journeys)
       .values({
         userId,
         name: input.name,
         description: input.description,
         steps: input.steps,
       })
       .returning();
   
     logger.info('Journey created', { journeyId: result.id });
   
     return createSuccessResponse(result);
   };
   
   export const handler = withAuth(handlerFn);
   ```

### Step 4: Register Route

Add to `local-dev/server.ts`:

```typescript
// 1. Import handler
import * as createJourney from '../src/node/handlers/journeys/create';

// 2. Add to handlerMap
const handlerMap: Record<string, any> = {
  // ... existing handlers
  'journeys-create': createJourney.handler,
};

// 3. Add route
wrapHandler('/v1/journeys', 'POST', 'journeys-create'),
```

### Step 5: Add Test

Add to `tests/integration/test-handlers.sh`:

```bash
echo "Testing POST /v1/journeys..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Journey",
    "description": "Test description",
    "steps": []
  }' \
  $API_URL/v1/journeys)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ PASSED (HTTP 200)"
  echo "  Response: $BODY"
else
  echo "✗ FAILED (Expected 200, got $HTTP_CODE)"
  echo "  Response: $BODY"
fi
```

### Step 6: Test Locally

```bash
# Start dev server
pnpm dev

# Run tests
./tests/integration/test-handlers.sh "YOUR_JWT_TOKEN"
```

---

## Template Customization Guide

### Adding Query Parameters

```typescript
// 1. Add schema in domain file
export const listJourneysSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
  status: z.enum(['active', 'paused', 'completed']).optional(),
});

// 2. Export in index
export const journeySchemas = {
  list: journeyValidation.listJourneysSchema,
};

// 3. Use in handler
import { parseQuery, journeySchemas } from '../../lib/validation';
const query = parseQuery(event, journeySchemas.list);

const db = await getDb();
let queryBuilder = db.select().from(journeys).where(eq(journeys.userId, userId));

if (query.status) {
  queryBuilder = queryBuilder.where(eq(journeys.status, query.status));
}

const results = await queryBuilder.limit(query.limit);
```

### Adding Path Parameters

```typescript
// 1. Add schema in common.ts
export const journeyIdParam = z.object({
  journeyId: z.string().uuid(),
});

// 2. Use in handler
import { validate, commonSchemas } from '../../lib/validation';
const { journeyId } = validate(commonSchemas.journeyId, event.pathParameters || {});

const db = await getDb();
const result = await db
  .select()
  .from(journeys)
  .where(and(
    eq(journeys.id, journeyId),
    eq(journeys.userId, userId)
  ))
  .limit(1);

if (!result.length) {
  throw Errors.NotFound('Journey');
}
```

### Adding File Upload

```typescript
// 1. Add schema with base64 validation
uploadDocument: z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string(),
  data: z.string().min(1), // base64
}),

// 2. Use S3 in handler
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

const input = parseBody(event, schemas.uploadDocument);

// Decode base64
const buffer = Buffer.from(input.data, 'base64');

// Upload to S3
const key = `users/${userId}/documents/${Date.now()}_${input.filename}`;
await s3Client.send(new PutObjectCommand({
  Bucket: process.env.DOCUMENTS_BUCKET,
  Key: key,
  Body: buffer,
  ContentType: input.contentType,
}));

const url = `${process.env.CDN_URL}/${key}`;
```

---

## Common Patterns

### Pattern: List with Pagination

```typescript
import { parseQuery, commonSchemas } from '../../lib/validation';
import { createPaginatedResponse } from '../../lib/response';

const query = parseQuery(event, commonSchemas.pagination);

const db = await getDb();
const results = await db
  .select()
  .from(resources)
  .where(eq(resources.userId, userId))
  .limit(query.limit);

const total = await db
  .select({ count: sql<number>`count(*)` })
  .from(resources)
  .where(eq(resources.userId, userId));

return createPaginatedResponse({
  items: results,
  total: total[0].count,
  page: query.page,
  limit: query.limit,
});
```

### Pattern: Soft Delete

```typescript
await db
  .update(resources)
  .set({ 
    deletedAt: new Date().toISOString(),
    status: 'deleted'
  })
  .where(and(
    eq(resources.id, resourceId),
    eq(resources.userId, userId)
  ));
```

### Pattern: Conditional Update

```typescript
import { buildUpdateObject, hasUpdates } from '../../lib/update-helper';

const updates = buildUpdateObject(input, ['name', 'status']);

if (!hasUpdates(updates)) {
  throw Errors.BadRequest('No fields to update');
}

updates.updatedAt = new Date().toISOString();

await db
  .update(resources)
  .set(updates)
  .where(eq(resources.id, resourceId));
```

---

## Checklist for New Handler

Before submitting:

- [ ] Copied from appropriate template
- [ ] Updated service name in logger
- [ ] Added Zod schema in appropriate domain file
- [ ] Exported schema in `validation/index.ts`
- [ ] Used response helpers (`createSuccessResponse`, etc.)
- [ ] Implemented handler logic with Drizzle ORM
- [ ] Added comprehensive Swagger documentation
- [ ] Registered route in `local-dev/server.ts`
- [ ] Added test case to test script
- [ ] Tested locally with `pnpm dev`
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Follows patterns in `.ai/PATTERNS.md`

---

## Need Help?

- **Patterns:** See `.ai/PATTERNS.md`
- **Examples:** Check existing handlers in `src/node/handlers/`
- **Testing:** See `tests/README.md`
- **Contributing:** See `CONTRIBUTING.md`
