# Backend Architecture

**Status:** Production Ready ✅  
**Last Updated:** December 6, 2025

---

## Overview

This is a production-ready AWS Lambda backend boilerplate with TypeScript, featuring:

- ✅ **Type-safe** - Full TypeScript with Zod validation
- ✅ **Consistent** - Standardized patterns across all handlers
- ✅ **Scalable** - Domain-organized structure
- ✅ **Maintainable** - Clean, well-documented code
- ✅ **Production-ready** - CORS, retry logic, error handling
- ✅ **Secure** - XSS prevention, file validation, input sanitization
- ✅ **Monitored** - CloudWatch alarms, X-Ray tracing, dashboards
- ✅ **Protected** - API Gateway throttling, Lambda concurrency monitoring

---

## Project Structure

```
src/node/
├── handlers/              # Lambda handlers (13 total)
│   ├── media/            # Image upload/list handlers (with validation)
│   ├── users/            # User profile handlers
│   ├── webhooks/         # Webhook handlers (WorkOS)
│   ├── test/             # Test endpoints
│   └── utils/            # Health checks (simple + detailed), OPTIONS
│
├── lib/                  # Shared libraries
│   ├── validation/       # Domain-organized Zod schemas
│   │   ├── users.ts     # User validation schemas
│   │   ├── media.ts     # Media validation schemas (with file size limits)
│   │   ├── organizations.ts
│   │   ├── webhooks.ts
│   │   ├── common.ts    # Shared schemas (pagination, etc.)
│   │   ├── helpers.ts   # Validation helper functions
│   │   └── index.ts     # Main exports
│   │
│   ├── sanitize.ts       # XSS prevention, file validation, input sanitization
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

## Security Features

### **Input Sanitization**

Comprehensive protection against common attacks in `lib/sanitize.ts`:

```typescript
import { 
  sanitizeString,
  sanitizeFilename,
  sanitizeUrl,
  sanitizeEmail,
  sanitizeObject
} from '../../lib/sanitize';

// XSS prevention
const clean = sanitizeString(userInput);

// Filename sanitization (removes path traversal, special chars)
const safeName = sanitizeFilename(uploadedFilename);

// URL validation
const safeUrl = sanitizeUrl(externalLink);

// Deep object sanitization
const cleanData = sanitizeObject(requestBody);
```

### **File Upload Validation**

Secure file handling with size and type validation:

```typescript
import { 
  validateFileSize,
  validateFileExtension,
  validateContentType 
} from '../../lib/sanitize';

// Validate file size (10MB limit for images)
validateFileSize(fileSize, 10 * 1024 * 1024);

// Validate extension
validateFileExtension(filename, ['jpg', 'jpeg', 'png', 'gif', 'webp']);

// Validate content type matches extension
validateContentType(contentType, filename);
```

**Features:**
- File size limits (configurable per type)
- Extension whitelist
- Content-Type validation
- Path traversal prevention
- Special character removal

---

## Monitoring & Observability

### **Health Checks**

Two-tier health check system:

**Simple Health Check** (`GET /v1/health`):
- Quick status check
- Returns: status, timestamp, version, stage
- Use for: Load balancer health checks, uptime monitoring

**Detailed Health Check** (`GET /v1/health/detailed`):
- Comprehensive system status
- Checks: Database connectivity, WorkOS config, S3 config
- Returns: Individual component status + response times
- Use for: Debugging, detailed monitoring

```typescript
// Example detailed response
{
  "status": "healthy",
  "checks": {
    "database": { "status": "ok", "responseTime": 343 },
    "workos": { "status": "ok", "configured": true },
    "s3": { "status": "ok", "configured": true }
  }
}
```

### **CloudWatch Alarms**

Comprehensive monitoring with 6 alarms per environment:

| Alarm | Threshold | Purpose |
|-------|-----------|---------|
| **API 5xx Errors** | > 1% | Detect server errors |
| **API 4xx Errors** | > 10% | Detect client errors |
| **Lambda Errors** | > 10 in 5min | Function failures |
| **Lambda Latency** | > 3s (p95) | Performance issues |
| **Lambda Concurrency** | > 700 (70%) | Approaching limits |
| **Lambda Throttles** | > 10 in 5min | Capacity issues |

**All alarms:**
- Send notifications to SNS topic
- Visible in CloudWatch dashboard
- State: OK / ALARM / INSUFFICIENT_DATA

### **CloudWatch Dashboard**

Real-time monitoring dashboard with widgets:
- Lambda concurrent executions (with limit visualization)
- API Gateway requests
- API Gateway errors (4xx + 5xx)
- Lambda errors
- Lambda duration (p95)
- Lambda throttles

**Access:**
- Staging: `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=postway-staging-api-dashboard`
- Production: `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=postway-production-api-dashboard`

### **X-Ray Tracing**

Distributed tracing enabled on all Lambda functions:
- Trace requests across services
- Identify performance bottlenecks
- Debug errors with full context
- Automatic service map generation

### **API Gateway Throttling**

Rate limiting to protect against abuse:

| Environment | Rate Limit | Burst Limit |
|-------------|------------|-------------|
| **Staging** | 500 req/s | 1,000 |
| **Production** | 1,000 req/s | 2,000 |

**Benefits:**
- Prevents DDoS attacks
- Protects Lambda concurrency
- Returns HTTP 429 (Too Many Requests)
- Cheaper than Lambda throttling

---

## Metrics

| Metric | Value |
|--------|-------|
| **Total handlers** | 13 (11 + 2 health checks) |
| **Validation domains** | 5 (users, media, orgs, webhooks, common) |
| **Response helpers** | 4 |
| **Update helpers** | 3 |
| **Security utilities** | 8 (sanitization + validation) |
| **CloudWatch alarms** | 6 per environment |
| **Type safety** | 100% (no `any` in handlers) |
| **Pattern consistency** | 100% |
| **Build status** | ✅ Passing |
| **Deployment status** | ✅ Staging + Production |

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
