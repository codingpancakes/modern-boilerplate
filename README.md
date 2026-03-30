# RailBranch Backend

Production-grade serverless API built with AWS Lambda, TypeScript, and WorkOS authentication.

## Stack

- **Runtime:** Node.js 24 / TypeScript 5 / pnpm
- **API:** AWS Lambda + API Gateway HTTP v2 + GraphQL (Apollo Server)
- **Database:** PostgreSQL on Neon (`drizzle-orm/neon-http`)
- **Auth:** WorkOS JWT (custom Lambda authorizer)
- **Infra:** AWS CDK v2 (CloudFront + WAF + S3 + CodeDeploy blue-green)
- **Observability:** CloudWatch + X-Ray + Sentry + structured logging (Powertools)
- **Validation:** Zod | **Linter:** Biome | **Tests:** Vitest

## Quick Start

```bash
pnpm install
# Create .env.local with your credentials — see docs/ENVIRONMENT_VARIABLES.md
pnpm migrate
pnpm dev                            # http://localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start local Express server (Lambda parity) |
| `pnpm check` | Lint + typecheck + unit tests |
| `pnpm test:run` | Unit tests only |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm typecheck` | TypeScript check |
| `pnpm migrate` | Run Drizzle migrations |
| `pnpm deploy:staging` | Deploy to staging |
| `pnpm build` | TypeScript compile + generate docs |
| `pnpm deploy:production` | Deploy to production |
| `pnpm sync-secrets <stage>` | Sync env vars to AWS (e.g. `pnpm sync-secrets staging`) |

## Project Structure

```
src/node/
  handlers/              Lambda handlers — one per file
    users/               me.ts, update.ts
    media/               upload-image.ts, upload-image-direct.ts, list-images.ts
    webhooks/            workos.ts
    graphql/             handler.ts, context.ts, resolvers/, schema/
    utils/               health.ts, health-detailed.ts, janitor.ts, options.ts
  lib/                   Shared libraries
    validation/          Zod schemas by domain
    services/            Business logic (user-provisioning.ts)
    middleware.ts        withAuth wrapper
    cors.ts              Dynamic CORS
    db.ts                Neon connection with retry + TTL rotation
    errors.ts            Error factory
    audit.ts             Audit logging
    sanitize.ts          Input sanitization
    sentry.ts            Error tracking
    idempotency.ts       Request deduplication
  authorizers/           workos-jwt.ts (Lambda authorizer)
  db/schema/             Drizzle schema (8 tables, 3 enums)

infrastructure/          CDK stacks (security, database, media, api, monitoring, pipeline)
local-dev/server.ts      Express dev server mimicking Lambda
templates/               Handler templates (.ts.template)
tests/                   Unit + integration tests
```

## Architecture

```
Client → CloudFront (WAF) → API Gateway HTTP v2 → Lambda Authorizer (JWT)
                                                  → Lambda Handlers → Neon Postgres
                                                                    → S3 (presigned URLs)
```

- **Auth:** WorkOS JWT verified by Lambda authorizer → claims forwarded to handlers
- **REST:** `withAuth` middleware wraps handlers, validates claims, adds CORS/security headers
- **GraphQL:** Apollo Server with depth limiting, complexity analysis, mutation limits
- **Deploys:** Blue-green via CodeDeploy (canary 10%/5min in prod, all-at-once in staging)
- **Idempotency:** Hash-based dedup with TTL for webhooks and critical mutations

## Auth Flow

1. Client sends `Authorization: Bearer <JWT>`
2. Lambda authorizer verifies RS256 signature via WorkOS JWKS
3. Claims forwarded to handler via `event.requestContext.authorizer.lambda`
4. `getUserIdFromClaims(event)` resolves `authIdentity → userId` (JIT creates user on first login)

## Creating a New Handler

```bash
cp templates/user-scoped.ts.template src/node/handlers/{domain}/{action}.ts
```

Then: add Zod schema in `lib/validation/`, register route in `infrastructure/lib/routes/` and `local-dev/server.ts`, run `pnpm check`.

See [templates/README.md](./templates/README.md) for detailed guide.

## Documentation

| Doc | Purpose |
|-----|---------|
| [Setup Guide](./docs/BOILERPLATE_SETUP.md) | First-time project setup from zero |
| [Environment Variables](./docs/ENVIRONMENT_VARIABLES.md) | All env vars, secrets, SSM params |
| [Security Model](./docs/SECURITY.md) | Auth, CORS, WAF, input validation, error masking |
| [Audit Logging](./docs/AUDIT_LOGGING_GUIDE.md) | How audit trail works, integration patterns |
| [Testing Guide](./docs/guides/TESTING.md) | Unit + integration testing |
| [CDK Teardown](./docs/guides/CDK_TEARDOWN.md) | How to destroy AWS stacks |
| [Lambda & DLQ](./docs/LAMBDA_CONCURRENCY_DLQ.md) | Concurrency settings, dead letter queues |
| [Data Retention](./docs/DATA_RETENTION_POLICY.md) | Retention policies per data type |
| [SOC 2 Checklist](./docs/SOC2_READINESS_CHECKLIST.md) | Compliance readiness tracker |

## AI Coding Rules

This project uses `.cursor/rules/` for AI pattern enforcement:

| Rule | Scope | Purpose |
|------|-------|---------|
| `backend-core.mdc` | Always | Core invariants, directory layout |
| `handlers.mdc` | `src/node/handlers/**` | REST handler patterns |
| `graphql.mdc` | `src/node/handlers/graphql/**` | GraphQL resolver patterns |
| `validation-security.mdc` | `src/node/lib/**` | Validation, sanitization, security |
| `infrastructure.mdc` | `infrastructure/**` | CDK patterns |
| `testing.mdc` | `tests/**` | Test patterns, mock conventions |
