# Project Context for AI Assistants

This document provides essential context about the project for AI coding assistants.

## Project Overview

**Name:** RailBranch Backend  
**Type:** AWS Lambda-based REST API  
**Framework:** Node.js + TypeScript + AWS CDK  
**Database:** PostgreSQL (via Drizzle ORM)  
**Auth:** WorkOS (JWT-based)  
**Storage:** AWS S3  
**Deployment:** AWS Lambda + API Gateway

---

## Tech Stack

### Core
- **Runtime:** Node.js 20.x
- **Language:** TypeScript 5.x
- **Package Manager:** pnpm

### AWS Services
- **Lambda:** Serverless functions
- **API Gateway:** HTTP API (v2)
- **S3:** File storage
- **RDS:** PostgreSQL database
- **CloudFront:** CDN for images
- **CDK:** Infrastructure as Code

### Key Libraries
- **@aws-lambda-powertools/logger:** Structured logging
- **drizzle-orm:** Type-safe database queries
- **zod:** Runtime validation
- **jose:** JWT verification
- **@workos-inc/node:** Authentication provider

---

## Project Structure

```
RailBranchBackend/
├── .ai/                      # AI assistant guides (YOU ARE HERE)
│   ├── PATTERNS.md          # Code patterns to follow
│   ├── TEMPLATES.md         # How to use templates
│   └── CONTEXT.md           # This file
│
├── templates/               # Handler templates
│   ├── user-scoped.ts      # For user-owned resources
│   ├── org-scoped.ts       # For organization resources
│   └── public.ts           # For public endpoints
│
├── src/node/
│   ├── handlers/           # API endpoint handlers
│   │   ├── users/         # User management
│   │   ├── media/         # File uploads
│   │   ├── webhooks/      # Webhook handlers
│   │   ├── test/          # Test endpoints
│   │   └── utils/         # Utility handlers
│   ├── lib/               # Shared libraries
│   │   ├── validation/    # Domain-organized Zod schemas
│   │   │   ├── users.ts
│   │   │   ├── media.ts
│   │   │   ├── organizations.ts
│   │   │   ├── webhooks.ts
│   │   │   ├── common.ts
│   │   │   ├── helpers.ts
│   │   │   └── index.ts
│   │   ├── response.ts    # Response helpers
│   │   ├── update-helper.ts # Update helpers
│   │   ├── middleware.ts  # Auth & error handling
│   │   ├── invokePythonLambda.ts # Python Lambda invocation
│   │   ├── cors.ts        # CORS handling
│   │   ├── db.ts          # Database connection
│   │   ├── errors.ts      # Error helpers
│   │   └── permissions.ts # Authorization
│   └── db/
│       └── schema.ts      # Drizzle schema definitions
│
├── src/python/            # Python Lambda handlers
│   ├── handlers/          # Python handlers
│   │   ├── users/        # User-related Python handlers
│   │   └── test/         # Test Python handlers
│   ├── lib/              # Python shared libraries
│   ├── requirements.txt  # Python dependencies
│   └── README.md         # Python handler guide
│
├── tests/                  # Test scripts
│   └── integration/       # Integration tests
│
├── docs/                   # Documentation
│   ├── api/               # API docs (OpenAPI)
│   ├── architecture/      # Architecture docs
│   └── guides/            # How-to guides
│
├── infrastructure/         # AWS CDK stacks
├── local-dev/             # Local development server
└── scripts/               # Build & deploy scripts
```

---

## Key Concepts

### 1. Middleware Pattern
All handlers use middleware for cross-cutting concerns:
- `withAuth` - JWT authentication
- `withApiKey` - API key validation
- `withWebhookSignature` - Webhook signature verification
- `withCustomHeader` - Custom header validation

Middleware handles errors automatically - **never use try-catch in handlers**.

### 2. Validation Pattern
All input validation uses domain-organized Zod schemas:
- Schemas organized by domain in `src/node/lib/validation/`
- Import from domain: `import { parseBody, userSchemas } from '../../lib/validation'`
- Use `parseBody()` for request body validation
- Use `parseQuery()` for query parameter validation
- Use `validate()` for general validation
- Types automatically inferred from schemas

### 3. Database Pattern
All database access uses Drizzle ORM:
- Schema defined in `src/node/db/schema.ts`
- Type-safe queries
- **Never use raw SQL**
- Connection pooling handled automatically

### 4. Logging Pattern
Structured logging with AWS Lambda Powertools:
- Add context: `logger.addContext(context)`
- Persistent keys: `logger.appendKeys({ userId, orgId })`
- Log levels: `info`, `warn`, `error`

### 5. Response Helpers
Standardized response functions:
- Use `createSuccessResponse()` for 200 responses
- Use `createErrorResponse()` for error responses
- Use `createPaginatedResponse()` for paginated lists
- Use `createNoContentResponse()` for 204 responses
- CORS headers added automatically by middleware

### 6. Error Handling
Standardized error handling:
- Use `Errors.*` helpers (BadRequest, Unauthorized, NotFound, etc.)
- Middleware converts to proper HTTP responses

### 7. Python Lambda Proxy Pattern
For Python-specific workloads (ML, data processing):
- **TypeScript handles authentication** using `withAuth` middleware
- **TypeScript invokes Python Lambda** using `invokePythonLambda()`
- **Python receives pre-validated claims** (no auth code needed)
- **Python Lambda is NOT publicly accessible** (security best practice)
- Example: `src/node/handlers/users/python-profile.ts` → `src/python/handlers/users/profile.py`
- Never return error responses directly

---

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `WORKOS_CLIENT_ID` - WorkOS client ID
- `WORKOS_JWKS_URL` - WorkOS JWKS endpoint
- `AWS_REGION` - AWS region (default: us-east-1)

### Optional
- `IMAGES_BUCKET` - S3 bucket for images
- `IMAGES_CDN_URL` - CloudFront URL for images
- `AWS_PROFILE` - AWS profile for local development

---

## Authentication Flow

1. User authenticates with WorkOS
2. WorkOS returns JWT access token
3. Client sends JWT in `Authorization: Bearer <token>` header
4. `withAuth` middleware verifies JWT signature
5. JWT claims available in `event.claims`
6. User ID from `event.claims.sub`

---

## Database Schema Overview

### Core Tables
- `users` - User accounts
- `profiles` - Extended user profiles
- `auth_identities` - Maps WorkOS IDs to user IDs
- `organizations` - Organizations
- `org_units` - Organization units (teams, departments)
- `org_memberships` - User-organization relationships

### Feature Tables
- `journeys` - Customer journeys
- `journey_steps` - Steps within journeys
- `campaigns` - Marketing campaigns
- `contacts` - Contact list

---

## Common Tasks

### Creating a New Handler
1. Choose template from `/templates/`
2. Copy to `src/node/handlers/{resource}/{action}.ts`
3. Add Zod schema to appropriate domain file in `lib/validation/`
4. Export schema in `lib/validation/index.ts`
5. Implement handler logic using response helpers
6. Register route in `local-dev/server.ts`
7. Add test to `tests/integration/test-handlers.sh`
8. Test locally with `pnpm dev`

See `.ai/TEMPLATES.md` for detailed guide.

### Adding a New Database Table
1. Add table definition to `src/node/db/schema.ts`
2. Generate migration: `pnpm drizzle-kit generate`
3. Run migration: `pnpm migrate`
4. Update types if needed

### Deploying
```bash
# Deploy to staging
pnpm deploy:staging

# Deploy to production
pnpm deploy:production
```

---

## Testing

### Local Development
```bash
# Start local server
pnpm dev

# Run integration tests
./tests/integration/test-handlers.sh "JWT_TOKEN"

# Test middleware
./tests/integration/test-middleware.sh
```

### Staging/Production
```bash
# Test staging API
./tests/integration/test-api.sh staging

# Test production API
./tests/integration/test-api.sh production
```

---

## Important Rules

### DO
✅ Use templates for new handlers  
✅ Use domain-organized Zod schemas  
✅ Use response helpers (`createSuccessResponse`, etc.)  
✅ Use Drizzle ORM for database  
✅ Let middleware handle errors  
✅ Add persistent logging context  
✅ Add Swagger documentation  
✅ Write tests for new endpoints  

### DON'T
❌ Use raw SQL queries  
❌ Use try-catch in handlers  
❌ Parse JSON manually  
❌ Return raw JSON responses (use helpers)  
❌ Add CORS headers manually  
❌ Skip input validation  
❌ Hardcode values  
❌ Use `any` types  
❌ Skip documentation  

---

## Getting Help

- **Code Patterns:** `.ai/PATTERNS.md`
- **Template Usage:** `.ai/TEMPLATES.md`
- **Contributing:** `CONTRIBUTING.md`
- **API Docs:** `docs/api/`
- **Architecture:** `docs/architecture/`

---

## Current State

### Implemented Features
- ✅ User authentication (WorkOS)
- ✅ User profile management
- ✅ Image upload (S3)
- ✅ Health check endpoint
- ✅ Middleware variants (auth, API key, webhook)
- ✅ Comprehensive validation
- ✅ Structured logging
- ✅ Error handling

### Ready to Build
The boilerplate is production-ready. Add your features using the established patterns!

---

## Notes for AI Assistants

When generating code:
1. **Always check** `.ai/PATTERNS.md` first
2. **Use templates** from `/templates/` directory
3. **Follow existing patterns** in similar handlers
4. **Validate all inputs** with Zod
5. **Use Drizzle ORM** for database queries
6. **Add comprehensive logging**
7. **Include Swagger docs**
8. **Write tests**

When answering questions:
- Reference specific files and line numbers
- Show code examples from the project
- Explain the "why" behind patterns
- Suggest improvements when appropriate
