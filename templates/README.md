# Handler Templates

This directory contains templates for creating new API handlers. Use these templates to ensure consistency and follow best practices.

## Available Templates

Templates use `.ts.template` extension so TypeScript ignores them during build. When you copy them, rename to `.ts`.

### 1. `user-scoped.ts.template`
**Use for:** Endpoints that operate on the authenticated user's own data.

**Examples:**
- `GET /v1/users/me` - Get current user profile
- `PATCH /v1/users/me` - Update user profile
- `POST /v1/media/upload-image` - Upload user's image
- `GET /v1/media/images` - List user's images

**Characteristics:**
- Uses `withAuth` middleware
- No organization membership required
- User ID from `getUserIdFromClaims(event)` (resolves JWT subject to internal UUID)

---

### 2. `org-scoped.ts.template`
**Use for:** Endpoints that require organization membership.

**Examples:**
- `GET /v1/orgs/{orgId}/members` - List organization members
- `POST /v1/orgs/{orgId}/members` - Add organization member
- `GET /v1/orgs/{orgId}/settings` - Get organization settings

**Characteristics:**
- Uses `withAuth` middleware
- Requires organization membership check
- Org ID from path parameters
- Validates user has access to organization

---

### 3. `public.ts.template`
**Use for:** Public endpoints or webhooks without authentication.

**Examples:**
- `GET /v1/health` - Health check
- `POST /v1/webhooks/workos` - WorkOS webhook
- `POST /v1/webhooks/workos` - WorkOS webhook
- `GET /v1/public/status` - Public status endpoint

**Characteristics:**
- No authentication required (or uses webhook signature)
- Public access
- May use `withWebhookSignature` for webhooks
- Three options: no auth, webhook signature, or custom validation

---

## How to Use

### Quick Start

1. **Copy the appropriate template:**
   ```bash
   cp templates/user-scoped.ts.template src/node/handlers/resource/action.ts
   ```

2. **Update the service name:**
   ```typescript
   const logger = new Logger({ serviceName: 'resource-action' });
   ```

3. **Add Swagger documentation:**
   ```typescript
   /**
    * @swagger
    * /v1/resource:
    *   post:
    *     tags: [Resource]
    *     summary: Action on resource
    *     ...
    */
   ```

4. **Add Zod schema** (if needed) in `src/node/lib/validation/{domain}.ts`, export from `index.ts`

5. **Implement handler logic**

6. **Register route** in `infrastructure/lib/routes/` (CDK) and `local-dev/server.ts` (dev server)

7. **Add test** to `tests/integration/test-handlers.sh`

---

## Detailed Guide

See the template files in this directory for comprehensive examples.

## Code Patterns

See [`.cursor/rules/`](../.cursor/rules/) for AI-enforced coding standards and patterns.

---

## Template Structure

All templates follow this structure:

```typescript
// 1. Imports
import { Logger } from '@aws-lambda-powertools/logger';
import { withAuth, AuthenticatedEvent } from '../lib/middleware';
// ... other imports

// 2. Logger initialization
const logger = new Logger({ serviceName: 'handler-name' });

// 3. Swagger documentation
/**
 * @swagger
 * /v1/endpoint:
 *   method:
 *     ...
 */

// 4. Handler function
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  // Setup logging
  logger.addContext(context);
  logger.appendKeys({ userId });
  
  // Validate input
  const input = parseBody(event, schemas.someSchema);
  
  // Business logic
  const db = await getDb();
  // ... database operations
  
  // Return response
  return createSuccessResponse(result);
};

// 5. Export with middleware
export const handler = withAuth(handlerFn);
```

---

## Best Practices

### ✅ DO
- Use the appropriate template for your use case
- Add comprehensive Swagger documentation
- Validate all inputs with Zod
- Use Drizzle ORM for database queries
- Add persistent logging context
- Return standardized responses
- Write tests for your handler

### ❌ DON'T
- Use raw SQL queries
- Use try-catch blocks (middleware handles errors)
- Parse JSON manually
- Skip input validation
- Hardcode values
- Use `any` types
- Skip documentation

---

## Examples

### Example 1: Create Resource (User-Scoped)

```typescript
// src/node/handlers/journeys/create.ts
import { Logger } from '@aws-lambda-powertools/logger';
import { withAuth, AuthenticatedEvent } from '../../lib/middleware';
import { getDb } from '../../lib/db';
import { parseBody, schemas } from '../../lib/validation';
import { journeys } from '../../db/schema';
import type { Context } from 'aws-lambda';

const logger = new Logger({ serviceName: 'journeys-create' });

const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const userId = await getUserIdFromClaims(event);
  logger.appendKeys({ userId });

  const input = parseBody(event, schemas.createJourney);

  const db = await getDb();
  const result = await db
    .insert(journeys)
    .values({ userId, ...input })
    .returning();

  logger.info('Journey created', { journeyId: result[0].id });

  return createSuccessResponse(result[0]);
};

export const handler = withAuth(handlerFn);
```

### Example 2: List Resources (User-Scoped)

```typescript
// src/node/handlers/journeys/list.ts
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const userId = await getUserIdFromClaims(event);
  logger.appendKeys({ userId });

  const query = validate(schemas.paginationQuery, event.queryStringParameters || {});

  const db = await getDb();
  const results = await db
    .select()
    .from(journeys)
    .where(eq(journeys.userId, userId))
    .limit(query.limit);

  return createSuccessResponse({ items: results, count: results.length });
};
```

---

## Need Help?

- **Code Patterns:** [`.cursor/rules/`](../.cursor/rules/) — AI-enforced coding standards
- **Project Overview:** [`README.md`](../README.md) — Architecture and quick start
- **Handler Patterns:** [`.cursor/rules/handlers.mdc`](../.cursor/rules/handlers.mdc) — REST handler conventions
