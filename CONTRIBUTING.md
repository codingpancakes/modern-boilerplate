# Contributing Guide

Welcome! This guide will help you contribute to the RailBranch Backend project.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Project Structure](#project-structure)
3. [Development Workflow](#development-workflow)
4. [Creating New Handlers](#creating-new-handlers)
5. [Code Standards](#code-standards)
6. [Testing](#testing)
7. [Deployment](#deployment)

---

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- pnpm 8.x or higher
- PostgreSQL 14.x or higher
- AWS CLI configured
- WorkOS account

### Initial Setup

```bash
# 1. Clone the repository
git clone <repository-url>
cd RailBranchBackend

# 2. Install dependencies
pnpm install

# 3. Copy environment file
cp .env.local.example .env.local

# 4. Configure environment variables
# Edit .env.local with your credentials

# 5. Run database migrations
pnpm migrate

# 6. Start local dev server
pnpm dev
```

---

## Project Structure

```
RailBranchBackend/
├── .ai/                    # AI assistant guides
│   ├── PATTERNS.md        # Code patterns
│   ├── TEMPLATES.md       # Template usage
│   └── CONTEXT.md         # Project context
│
├── templates/             # Handler templates
│   ├── user-scoped.ts    # User-owned resources
│   ├── org-scoped.ts     # Organization resources
│   └── public.ts         # Public endpoints
│
├── src/node/
│   ├── handlers/         # API handlers (by resource)
│   ├── lib/             # Shared libraries
│   └── db/              # Database schema
│
├── tests/               # Test scripts
│   └── integration/     # Integration tests
│
├── docs/                # Documentation
│   ├── api/            # API documentation
│   ├── architecture/   # Architecture docs
│   └── guides/         # How-to guides
│
├── infrastructure/      # AWS CDK stacks
├── local-dev/          # Local dev server
└── scripts/            # Build & deploy scripts
```

---

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

Follow the [Code Standards](#code-standards) section below.

### 3. Test Locally

```bash
# Start dev server
pnpm dev

# Run tests (in another terminal)
./tests/integration/test-handlers.sh "JWT_TOKEN"
```

### 4. Commit Your Changes

```bash
git add .
git commit -m "feat: add new feature"
```

**Commit Message Format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

---

## Creating New Handlers

### Step-by-Step Guide

#### 1. Choose the Right Template

**Question:** Does this endpoint require organization membership?

- **NO** → Use `templates/user-scoped.ts`
  - Examples: `/users/me`, `/media/upload`, `/journeys`
  
- **YES** → Use `templates/org-scoped.ts`
  - Examples: `/orgs/{orgId}/campaigns`, `/orgs/{orgId}/contacts`
  
- **Public** → Use `templates/public.ts`
  - Examples: `/health`, `/webhooks/*`

#### 2. Copy Template

```bash
# Example: Creating a journey handler
cp templates/user-scoped.ts.template src/node/handlers/journeys/create.ts
```

**Note:** Templates use `.ts.template` extension to avoid build errors. Copy renames to `.ts`.

#### 3. Update Service Name

```typescript
const logger = new Logger({ serviceName: 'journeys-create' });
```

#### 4. Add Zod Schema

In `src/node/lib/validation.ts`:

```typescript
export const schemas = {
  // ... existing schemas
  createJourney: z.object({
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    steps: z.array(z.object({
      type: z.string(),
      config: z.record(z.any()),
    })),
  }),
};
```

#### 5. Implement Handler

```typescript
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const userId = event.claims.sub;
  logger.appendKeys({ userId });

  logger.info('Creating journey');

  // Validate input
  const input = parseBody(event, schemas.createJourney);

  // Database operations
  const db = await getDb();
  const result = await db
    .insert(journeys)
    .values({
      userId,
      name: input.name,
      description: input.description,
      steps: input.steps,
    })
    .returning();

  logger.info('Journey created', { journeyId: result[0].id });

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      data: result[0]
    })
  };
};


export const handler = withAuth(handlerFn);
```

#### 6. Add Swagger Documentation

```typescript
/**
 * @swagger
 * /v1/journeys:
 *   post:
 *     tags: [Journeys]
 *     summary: Create journey
 *     description: Creates a new customer journey
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Welcome Journey"
 *               description:
 *                 type: string
 *                 example: "Onboarding journey for new users"
 *     responses:
 *       200:
 *         description: Journey created successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
```

#### 7. Register Route

In `local-dev/server.ts`:

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

#### 8. Add Test

In `tests/integration/test-handlers.sh`:

```bash
echo "Testing POST /v1/journeys..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Journey",
    "description": "Test description"
  }' \
  $API_URL/v1/journeys)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ PASSED (HTTP 200)"
  PASSED=$((PASSED + 1))
else
  echo "✗ FAILED (Expected 200, got $HTTP_CODE)"
  FAILED=$((FAILED + 1))
fi
```

#### 9. Test Locally

```bash
pnpm dev
./tests/integration/test-handlers.sh "JWT_TOKEN"
```

---

## Code Standards

### TypeScript

- **Strict mode enabled** - No `any` types unless absolutely necessary
- **Explicit return types** for functions
- **Use interfaces** for complex types
- **Import types separately** using `import type`

### Validation

- **Always use Zod** for input validation
- **Define schemas** in `src/node/lib/validation.ts`
- **Use `parseBody()`** for request body validation
- **Use `validate()`** for path/query parameters

### Database

- **Always use Drizzle ORM** - Never raw SQL
- **Use transactions** for multi-step operations
- **Add indexes** for frequently queried fields
- **Use proper types** from schema

### Error Handling

- **Never use try-catch** in handlers (middleware handles it)
- **Use `Errors.*` helpers** (BadRequest, Unauthorized, NotFound)
- **Throw errors directly** - middleware catches them
- **Add context** to error messages

### Logging

- **Add context** at start: `logger.addContext(context)`
- **Use persistent keys**: `logger.appendKeys({ userId, orgId })`
- **Log important events**: start, completion, errors
- **Include relevant data** in logs

### Responses

- **Standardized format**: `{ success: true, data: {...} }`
- **Consistent status codes**: 200, 400, 401, 404, 500
- **Include metadata** for lists (count, cursor)

### Documentation

- **Comprehensive Swagger docs** for every endpoint
- **Code comments** for complex logic
- **Update README** when adding features
- **Document breaking changes**

---

## Testing

### Local Testing

```bash
# Start dev server
pnpm dev

# Run all handler tests
./tests/integration/test-handlers.sh "JWT_TOKEN"

# Run middleware tests
./tests/integration/test-middleware.sh

# Run specific test
curl -X GET \
  -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:3000/v1/users/me
```

### Staging Testing

```bash
# Deploy to staging
pnpm deploy:staging

# Test staging API
./tests/integration/test-api.sh staging
```

### Test Checklist

Before submitting PR:
- [ ] All handler tests pass
- [ ] Middleware tests pass
- [ ] No TypeScript errors (`pnpm build`)
- [ ] No lint errors (`pnpm lint`)
- [ ] Tested locally
- [ ] Added tests for new features
- [ ] Updated documentation

---

## Deployment

### Staging Deployment

```bash
# 1. Ensure all tests pass
./tests/integration/test-handlers.sh "JWT_TOKEN"

# 2. Build
pnpm build

# 3. Deploy to staging
pnpm deploy:staging

# 4. Test staging
./tests/integration/test-api.sh staging
```

### Production Deployment

```bash
# 1. Test staging thoroughly
./tests/integration/test-api.sh staging

# 2. Deploy to production
pnpm deploy:production

# 3. Verify production
./tests/integration/test-api.sh production

# 4. Monitor logs
pnpm logs:production
```

---

## Common Tasks

### Adding a Database Table

```bash
# 1. Add table to src/node/db/schema.ts
export const newTable = pgTable('new_table', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: varchar('name', { length: 200 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

# 2. Generate migration
pnpm drizzle-kit generate

# 3. Run migration
pnpm migrate
```

### Updating Environment Variables

```bash
# 1. Update .env.local for local dev
# 2. Update .env.staging for staging
# 3. Update .env.production for production
# 4. Redeploy affected environments
```

### Generating API Documentation

```bash
# Generate OpenAPI spec
pnpm generate:openapi

# Serve docs locally
pnpm serve:docs
# Open http://localhost:8080
```

---

## Getting Help

### Documentation
- **Code Patterns:** `.ai/PATTERNS.md`
- **Template Usage:** `.ai/TEMPLATES.md`
- **Project Context:** `.ai/CONTEXT.md`
- **Testing Guide:** `tests/README.md`

### Examples
- **User Handlers:** `src/node/handlers/users/`
- **Media Handlers:** `src/node/handlers/media/`
- **Test Scripts:** `tests/integration/`

### Resources
- **Drizzle ORM Docs:** https://orm.drizzle.team/
- **Zod Docs:** https://zod.dev/
- **AWS Lambda Powertools:** https://docs.powertools.aws.dev/lambda/typescript/

---

## Code Review Guidelines

### For Contributors
- Keep PRs focused and small
- Write descriptive commit messages
- Add tests for new features
- Update documentation
- Respond to feedback promptly

### For Reviewers
- Check code follows patterns
- Verify tests are comprehensive
- Ensure documentation is updated
- Test locally if possible
- Be constructive and kind

---

## Questions?

If you have questions or need help:
1. Check the documentation in `.ai/` and `docs/`
2. Look at existing handlers for examples
3. Ask in team chat or create an issue

Thank you for contributing! 🎉
