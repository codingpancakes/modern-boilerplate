# Backend Architecture

**Status:** Production Ready ✅  
**Last Updated:** December 5, 2025

---

## Overview

This is a production-ready AWS Lambda backend boilerplate with TypeScript, featuring:

- ✅ **Type-safe** - Full TypeScript with Zod validation
- ✅ **Consistent** - Standardized patterns across all handlers
- ✅ **Scalable** - Domain-organized structure
- ✅ **Maintainable** - Clean, well-documented code
- ✅ **Production-ready** - CORS, retry logic, error handling

---

## Project Structure

```
src/node/
├── handlers/              # Lambda handlers (11 total)
│   ├── media/            # Image upload/list handlers
│   ├── users/            # User profile handlers
│   ├── webhooks/         # Webhook handlers (WorkOS)
│   ├── test/             # Test endpoints
│   └── utils/            # Health check, OPTIONS
│
├── lib/                  # Shared libraries
│   ├── validation/       # Domain-organized Zod schemas
│   │   ├── users.ts     # User validation schemas
│   │   ├── media.ts     # Media validation schemas
│   │   ├── organizations.ts
│   │   ├── webhooks.ts
│   │   ├── common.ts    # Shared schemas (pagination, etc.)
│   │   ├── helpers.ts   # Validation helper functions
│   │   └── index.ts     # Main exports
│   │
│   ├── response.ts       # Response helpers
│   ├── update-helper.ts  # Generic update helpers
│   ├── cors.ts           # Centralized CORS handling
│   ├── db.ts             # Database connection (with retry)
│   ├── middleware.ts     # Auth middleware
│   ├── errors.ts         # Error handling
│   └── permissions.ts    # Permission checks
│
└── db/
    └── schema.ts         # Drizzle ORM schema
```

---

## Key Patterns

### **1. Handler Structure**

All handlers follow this consistent pattern:

```typescript
import { Logger } from '@aws-lambda-powertools/logger';
import { withAuth, AuthenticatedEvent } from '../../lib/middleware';
import { parseBody, userSchemas } from '../../lib/validation';
import { createSuccessResponse } from '../../lib/response';
import { getDb } from '../../lib/db';
import type { Context } from 'aws-lambda';

const logger = new Logger({ serviceName: 'handler-name' });

const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const userId = event.claims.sub;
  logger.appendKeys({ userId });

  // 1. Validate input
  const input = parseBody(event, userSchemas.create);

  // 2. Database operations
  const db = await getDb();
  const [result] = await db
    .insert(users)
    .values({ ...input, userId })
    .returning();

  // 3. Return response
  return createSuccessResponse(result);
};

export const handler = withAuth(handlerFn);
```

---

### **2. Validation (Domain-Organized)**

Validation schemas are organized by domain for scalability:

```typescript
// Import from domain-specific schemas
import { parseBody, userSchemas } from '../../lib/validation';
import { parseQuery, mediaSchemas } from '../../lib/validation';

// Use in handlers
const input = parseBody(event, userSchemas.update);
const query = parseQuery(event, mediaSchemas.listImages);
```

**Available schemas:**
- `userSchemas` - User creation, updates, profile
- `mediaSchemas` - Image uploads, listing
- `organizationSchemas` - Organization operations
- `webhookSchemas` - Webhook events
- `commonSchemas` - Pagination, IDs

---

### **3. Response Helpers**

Consistent response format across all handlers:

```typescript
import { 
  createSuccessResponse,
  createErrorResponse,
  createPaginatedResponse,
  createNoContentResponse 
} from '../../lib/response';

// Success response
return createSuccessResponse({ user, profile });

// Paginated response
return createPaginatedResponse({
  items: users,
  total: count,
  page: 1,
  limit: 10
});

// No content (204)
return createNoContentResponse();
```

---

### **4. Update Helpers**

Generic helpers for building update objects:

```typescript
import { buildNestedUpdates, hasUpdates } from '../../lib/update-helper';

// Automatically maps partial input to nested updates
const updates = buildNestedUpdates(input);

// Check if there are any updates
if (!hasUpdates(updates)) {
  throw Errors.BadRequest('No fields to update');
}

// Use in database operations
await db.update(users).set(updates.users);
await db.update(profiles).set(updates.profiles);
```

---

## Core Features

### **CORS Handling**

Centralized in `lib/cors.ts`:
- Single source of truth for CORS configuration
- Supports multiple origins (exact match + parent domains)
- Automatic preflight handling
- Applied by middleware, not in handlers

### **Database Connection**

Optimized with retry logic in `lib/db.ts`:
- 3 retry attempts with exponential backoff
- Connection pooling via Neon serverless
- Type-safe queries with Drizzle ORM
- Singleton pattern for Lambda reuse

### **Authentication**

JWT-based auth via API Gateway authorizer:
- `withAuth` middleware for protected routes
- `withPublicCors` for public endpoints
- Claims automatically extracted and typed
- User/org context available in all handlers

### **Error Handling**

Standardized error responses:
- Custom `ApiError` class
- Consistent error format
- Proper HTTP status codes
- CORS headers on errors

---

## Handler Templates

Use templates in `templates/` to create new handlers:

### **User-Scoped Handler**
For operations on authenticated user's own data:
```bash
cp templates/user-scoped.ts.template src/node/handlers/resource/action.ts
```

### **Organization-Scoped Handler**
For operations requiring organization membership:
```bash
cp templates/org-scoped.ts.template src/node/handlers/resource/action.ts
```

### **Public Handler**
For webhooks or public endpoints:
```bash
cp templates/public.ts.template src/node/handlers/resource/action.ts
```

All templates follow the established patterns and include:
- ✅ Proper imports
- ✅ Validation examples
- ✅ Response helpers
- ✅ Logging setup
- ✅ Swagger documentation

---

## Development Workflow

### **1. Create New Handler**
```bash
# Copy template
cp templates/user-scoped.ts.template src/node/handlers/users/new-action.ts

# Update serviceName, validation schema, and logic
# Add route to local-dev/server.ts
# Add route to infrastructure/lib/api-stack.ts
```

### **2. Add Validation Schema**
```typescript
// In src/node/lib/validation/users.ts
export const newActionSchema = z.object({
  field: z.string().min(1),
});

// In src/node/lib/validation/index.ts
export const userSchemas = {
  // ... existing schemas
  newAction: userValidation.newActionSchema,
};
```

### **3. Test Locally**
```bash
pnpm dev              # Start local server
pnpm build            # Verify TypeScript compiles
```

### **4. Deploy**
```bash
pnpm deploy:staging   # Deploy to staging
pnpm deploy:prod      # Deploy to production
```

---

## Best Practices

### **Do's** ✅
- Use domain-specific validation imports
- Use response helpers for all responses
- Use update helpers for complex updates
- Add proper TypeScript types (no `any`)
- Log important context with `logger.appendKeys()`
- Add Swagger documentation to handlers
- Follow existing patterns consistently

### **Don'ts** ❌
- Don't add CORS headers manually (middleware handles it)
- Don't use raw `JSON.stringify()` for responses
- Don't use `any` types
- Don't catch errors just to rethrow them
- Don't hardcode values (use environment variables)
- Don't skip validation

---

## Metrics

| Metric | Value |
|--------|-------|
| **Total handlers** | 11 |
| **Validation domains** | 5 (users, media, orgs, webhooks, common) |
| **Response helpers** | 4 |
| **Update helpers** | 3 |
| **Type safety** | 100% (no `any` in handlers) |
| **Pattern consistency** | 100% |
| **Build status** | ✅ Passing |

---

## Additional Documentation

- **API Reference**: Run `node docs/api/serve-docs.js` for interactive API docs
- **Infrastructure**: See `infrastructure/` for CDK setup
- **Teardown Guide**: See `docs/guides/CDK_TEARDOWN.md`

---

## Summary

This backend follows modern, scalable patterns:
- ✅ Consistent handler structure
- ✅ Domain-organized validation
- ✅ Reusable helper functions
- ✅ Type-safe throughout
- ✅ Production-ready

**Use the templates and follow the patterns to maintain consistency as you build!** 🚀
