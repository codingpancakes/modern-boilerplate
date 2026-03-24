# RailBranch Backend — AI Context

## Stack

- **Runtime:** Node.js 24 / TypeScript 5 / pnpm
- **Cloud:** AWS Lambda + API Gateway (HTTP v2) + S3 + CloudFront + CDK
- **Database:** PostgreSQL on Neon (via `drizzle-orm/neon-http`)
- **Auth:** WorkOS JWT (custom Lambda authorizer)
- **Validation:** Zod
- **Logging:** @aws-lambda-powertools/logger
- **Linter:** Biome

## Directory Structure

```
src/node/
├── handlers/           # Lambda handlers (one per file)
│   ├── users/          # me.ts, update.ts
│   ├── media/          # upload-image.ts, upload-image-direct.ts, list-images.ts
│   ├── webhooks/       # workos.ts
│   ├── graphql/        # handler.ts, context.ts, docs.ts, resolvers/, schema/
│   ├── test/           # api-key.ts, webhook.ts
│   └── utils/          # health.ts, health-detailed.ts, janitor.ts, options.ts
├── lib/                # Shared libraries
│   ├── validation/     # Zod schemas by domain (users.ts, media.ts, organizations.ts, webhooks.ts, common.ts)
│   ├── middleware.ts   # withAuth wrapper
│   ├── cors.ts         # CORS handling
│   ├── audit.ts        # Audit logging
│   ├── sanitize.ts     # Input sanitization, file validation
│   ├── response.ts     # createSuccessResponse, createNoContentResponse
│   ├── errors.ts       # Errors.BadRequest, .Unauthorized, .NotFound, etc.
│   ├── db.ts           # Neon DB connection with retry
│   ├── auth.ts         # getClaims, getUserIdFromClaims (JIT user provisioning)
│   ├── idempotency.ts  # Atomic idempotency via INSERT ON CONFLICT
│   └── withCustomHeader.ts, withPublicCors.ts
├── authorizers/        # workos-jwt.ts (Lambda authorizer)
└── db/
    └── schema/         # Drizzle schema (8 tables, 3 enums)

infrastructure/         # CDK stacks
local-dev/server.ts     # Express dev server mimicking Lambda
scripts/                # migrate.ts, sync-secrets.ts, destroy-all.sh
templates/              # Handler templates (.ts.template)
```

## Database Schema (8 tables)

| Table | Purpose |
|-------|---------|
| `users` | Core user accounts (email, name, type) |
| `profiles` | Extended profile (preferredName, photoUrl, persona, snapshot) |
| `auth_identities` | Maps WorkOS subject to userId (provider, providerSubject) |
| `organizations` | Orgs synced from WorkOS (workosOrgId, name, slug) |
| `org_units` | Hierarchical units within orgs (code, parentId) |
| `organization_members` | User-org membership (role, status, orgUnitId) |
| `idempotency_keys` | Webhook dedup (key, status, requestHash, expiresAt) |
| `audit_logs` | Full audit trail (userId, orgId, action, resourceType, changes) |

**Enums:** `userType` (OPERATOR, MEMBER), `orgRole` (OWNER..VIEWER), `assignmentStatus` (ACTIVE, INACTIVE, etc.)

## Auth Flow

1. Client sends `Authorization: Bearer <JWT>` header
2. Lambda authorizer (`workos-jwt.ts`) verifies JWT via WorkOS JWKS
3. Claims forwarded to handler in `event.requestContext.authorizer.lambda`
4. `getUserIdFromClaims(event)` resolves authIdentity → userId (JIT creates user on first login)
5. `withAuth` middleware wraps handlers and returns 401 if no valid claims

## Key Patterns Summary

See `PATTERNS.md` for full details. Critical rules:

- **No try-catch in handlers** — middleware catches errors
- **Zod for all validation** — `parseBody(event, schema)` / `parseQuery(event, schema)`
- **Drizzle ORM only** — never raw SQL
- **Response helpers** — `createSuccessResponse(data)`, never raw `{ statusCode, body }`
- **sanitizeObject()** on all user input before DB write (skips URL fields automatically)
- **logAudit()** on all mutations for audit trail
- **ACTIVE filter** on all membership queries
- **ServerSideEncryption: "AES256"** on all S3 uploads
- **CDN_URL** for all image URLs returned to clients (never raw S3)

## Environment Variables (Runtime)

| Var | Source | Purpose |
|-----|--------|---------|
| `WORKOS_CLIENT_ID` | commonEnv | JWT verification |
| `WORKOS_SECRET_ARN` | Secrets Manager ARN | WorkOS API key |
| `DB_SECRET_ARN` | Secrets Manager ARN | Database credentials |
| `IMAGES_BUCKET` | commonEnv | S3 bucket name |
| `IMAGES_CDN_URL` | commonEnv | CloudFront URL |
| `CORS_EXACT_ORIGINS` | commonEnv | Exact allowed origins |
| `CORS_PARENT_DOMAINS` | commonEnv | Allowed parent domains (subdomain matching) |
| `CORS_DOMAIN_PATTERNS` | commonEnv | Wildcard domain patterns (merged into parent domains) |
| `SENTRY_DSN` | commonEnv | Error monitoring |
| `SENTRY_ENVIRONMENT` | commonEnv | Environment label |
