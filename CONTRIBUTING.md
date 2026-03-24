# Contributing Guide

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm
- AWS CLI (configured)
- Docker (for local PostgreSQL, optional -- can use Neon directly)

### Setup
```bash
pnpm install
cp .env.example .env.local   # Configure your env vars
pnpm dev                      # Start local dev server on :3000
```

## Project Structure

See `.ai/CONTEXT.md` for full directory layout and schema overview.

```
src/node/handlers/    # Lambda handlers (one per file)
src/node/lib/         # Shared libs (validation, middleware, audit, cors, db, errors)
src/node/db/schema/   # Drizzle schema (8 tables)
infrastructure/       # CDK stacks
local-dev/server.ts   # Express dev server
templates/            # Handler templates
```

## Creating New Handlers

1. Copy the appropriate template from `/templates/`:
   - `user-scoped.ts.template` -- for user's own data (`/v1/users/*`, `/v1/media/*`)
   - `org-scoped.ts.template` -- for org resources requiring membership check
   - `public.ts.template` -- for public endpoints, webhooks

2. Add Zod schema in `src/node/lib/validation/{domain}.ts`, export from `index.ts`

3. Implement handler following the patterns in `.ai/PATTERNS.md`

4. Register route in `local-dev/server.ts`

5. Run `pnpm biome check src/` and `pnpm tsc --noEmit`

### Example: New user-scoped handler

```typescript
import { Logger } from "@aws-lambda-powertools/logger";
import type { Context } from "aws-lambda";
import { getUserIdFromClaims } from "../../lib/auth";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { sanitizeObject } from "../../lib/sanitize";
import { parseBody } from "../../lib/validation/helpers";

const logger = new Logger({ serviceName: "resource-create" });

const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const userId = getUserIdFromClaims(event);
  logger.appendKeys({ userId });

  const input = parseBody(event, mySchema);
  const sanitized = sanitizeObject(input);

  const db = await getDb();
  const [result] = await db.insert(table).values({ ...sanitized, userId }).returning();

  return createSuccessResponse(result);
};

export const handler = withAuth(handlerFn);
```

## Code Standards

- **No try-catch** in handlers -- middleware handles errors
- **Zod** for all input validation (`parseBody`, `parseQuery`)
- **Drizzle ORM** only -- never raw SQL
- **sanitizeObject()** on all user input before DB writes
- **logAudit()** on all mutations
- **Response helpers** -- `createSuccessResponse()`, `createNoContentResponse()`
- Always filter membership queries by `status = "ACTIVE"`
- Always use `ServerSideEncryption: "AES256"` on S3 uploads
- Return CDN URLs, never raw S3 URLs or bucket names
- No secrets or PII in logs

## Testing

```bash
pnpm test                 # Run unit tests in watch mode
pnpm test:run             # Run unit tests once (CI)
pnpm check                # Lint + typecheck + unit tests

pnpm dev                  # Start local server for integration tests
./tests/integration/test-all.sh "YOUR_JWT_TOKEN"  # Run integration suite
```

See [Testing Guide](./docs/guides/TESTING.md) for full details on local, staging, and production testing.

## Deployment

Deployments are handled via the CI/CD pipeline (CodeBuild + CDK). The pipeline runs `pnpm test:run` before building and deploying.

```bash
# Manual deploy (if needed)
pnpm deploy:staging
pnpm deploy:production
```

## Reference

- `.ai/CONTEXT.md` -- Project context, schema, env vars
- `.ai/PATTERNS.md` -- All code patterns with examples
- `docs/` -- Infrastructure, security, and operational guides
