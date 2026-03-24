# RailBranch Backend

> Production-grade serverless REST API built with AWS Lambda, TypeScript, and WorkOS authentication.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24.x-green)](https://nodejs.org/)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-orange)](https://aws.amazon.com/lambda/)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](./tests/)

**Tech Stack:** AWS Lambda + API Gateway v2 + PostgreSQL (Neon) + Drizzle ORM + WorkOS Auth + TypeScript

## Architecture

- **API Gateway v2** with custom Lambda authorizer validating WorkOS JWTs
- **Lambdas**: Node.js 24.x, bundled as CommonJS (esbuild) to avoid dynamic require issues
- **DB**: Neon serverless Postgres using `@neondatabase/serverless` + `drizzle-orm`
- **Secrets**: AWS Secrets Manager (WorkOS + DB)
- **Observability**: CloudWatch + AWS X-Ray + Lambda Powertools

## 📚 Documentation

### For Developers
- **[Getting Started](#quick-start)** - Set up your local environment
- **[Quick Reference](./docs/QUICK_REFERENCE.md)** - Essential daily commands
- **[Testing Guide](./docs/guides/TESTING.md)** - How to test (local, staging, production)
- **[Contributing Guide](./CONTRIBUTING.md)** - How to contribute
- **[Creating Handlers](./templates/README.md)** - Step-by-step guide
- **[Code Patterns](./.ai/PATTERNS.md)** - Standards and best practices

### For AI Assistants
- **[AI Context](./.ai/CONTEXT.md)** - Project overview for AI
- **[AI Patterns](./.ai/PATTERNS.md)** - Code patterns to follow
- **[Handler Templates](./templates/README.md)** - How to use templates

### Architecture
- **[Architecture Guide](./docs/architecture/README.md)** - Complete architecture overview
- **[API Documentation](./docs/api/)** - OpenAPI/Swagger specification

---

## 📁 Project Structure

```
RailBranchBackend/
├── .ai/                      # 🤖 AI assistant guides
│   ├── PATTERNS.md          # Code patterns
│   └── CONTEXT.md           # Project context
│
├── templates/               # 📝 Handler templates
│   ├── user-scoped.ts.template
│   ├── org-scoped.ts.template
│   ├── public.ts.template
│   └── README.md
│
├── src/node/
│   ├── handlers/           # 🎯 API endpoint handlers
│   │   ├── users/         # User management
│   │   ├── media/         # Image uploads
│   │   ├── webhooks/      # Webhook handlers
│   │   ├── test/          # Test endpoints
│   │   └── utils/         # Utility handlers
│   ├── lib/               # 🔧 Shared libraries
│   │   ├── validation/    # Domain-organized Zod schemas
│   │   │   ├── users.ts
│   │   │   ├── media.ts
│   │   │   ├── organizations.ts
│   │   │   ├── webhooks.ts
│   │   │   ├── common.ts
│   │   │   └── index.ts
│   │   ├── response.ts    # Response helpers
│   │   ├── update-helper.ts # Update helpers
│   │   ├── middleware.ts  # Auth & error handling
│   │   ├── cors.ts        # CORS handling
│   │   ├── db.ts          # Database connection
│   │   └── errors.ts      # Error helpers
│   └── db/
│       └── schema/         # Drizzle schema (8 tables, 3 enums)
│
├── tests/                  # ✅ Test scripts
│   ├── integration/       # Integration tests
│   └── README.md          # Testing guide
│
├── docs/                   # 📖 Documentation
│   ├── api/               # API docs (OpenAPI)
│   ├── architecture/      # Architecture docs
│   └── guides/            # How-to guides
│
├── infrastructure/         # ☁️ AWS CDK stacks
├── local-dev/             # 🔨 Local development server
├── scripts/               # 🚀 Build & deploy scripts
└── CONTRIBUTING.md        # Contributing guide
```

## Environment

### Staging: `.env.staging`

Required:
- `AWS_REGION=us-east-1`
- `STAGE=staging`
- `WORKOS_CLIENT_ID=...`
- `DATABASE_URL=postgresql://...` (Neon)
- `CORS_ORIGIN=https://*.postway.co`
- `API_DOMAIN=api-staging.postway.services`

Custom domain options:
- `HOSTED_ZONE_NAME=postway.services` (Route 53 managed)
- `API_CERT_ARN=arn:aws:acm:us-east-1:...` (use existing ACM cert; omit if using HOSTED_ZONE_NAME)

Notes:
- If DB TLS fails, try removing `channel_binding=require` from `DATABASE_URL`.
- `SKIP_DB=true` can bypass DB in handlers for auth-only checks.

### Local: `.env.local`

- `STAGE=local`
- `AWS_REGION=us-east-1`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/serverless_db?sslmode=disable`
- `WORKOS_CLIENT_ID=...` (used to fetch JWKS for local JWT verification)
- `SKIP_DB=false` (set true for auth-only testing)
- `PORT=3000`

## 🚀 Quick Start

### Prerequisites
- Node.js 24.x or higher
- pnpm 8.x or higher
- PostgreSQL 14.x or higher
- AWS CLI configured
- WorkOS account

### Installation

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.local.example .env.local
# Edit .env.local with your credentials

# 3. Start local database
pnpm local:db

# 4. Run migrations
pnpm migrate

# 5. Start development server
pnpm dev
```

### Testing

```bash
pnpm test:run             # Unit tests (Vitest)
pnpm check                # Lint + typecheck + unit tests

# Integration tests (requires local server running)
./tests/integration/test-handlers.sh "YOUR_JWT_TOKEN"

# Test specific endpoint
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/users/me
```

### Creating Your First Handler

```bash
# 1. Copy template (note: .ts.template → .ts)
cp templates/user-scoped.ts.template src/node/handlers/resource/action.ts

# 2. Follow the guide
# See templates/README.md for detailed instructions
```

## Deployment (staging)

1) Ensure `.env.staging` contains required variables above
2) Deploy:
```bash
pnpm deploy:staging
```
3) After deploy, check stack outputs:
- `ApiEndpoint` (execute-api URL)
- `CustomDomain` (if configured)
- If using external DNS: `ApiCustomDomainRegionalDomainName` and `ApiCustomDomainRegionalHostedZoneId`

4) DNS:
- Route 53: created automatically when `HOSTED_ZONE_NAME` is set
- External DNS: create a CNAME from `API_DOMAIN` to `ApiCustomDomainRegionalDomainName`

## 🎯 Key Features

### ✅ Production-Ready
- **Type-Safe** - Full TypeScript with Zod validation
- **Tested** - Comprehensive integration tests
- **Documented** - OpenAPI/Swagger specs
- **Monitored** - CloudWatch + X-Ray tracing
- **Secure** - JWT authentication + input validation

### 🚀 Developer Experience
- **Templates** - Quick-start templates for new handlers
- **Patterns** - Consistent code patterns
- **Local Dev** - Full Lambda parity locally
- **Hot Reload** - Fast development cycle
- **AI-Friendly** - Guides for AI code assistants

### 🏗️ Architecture
- **Serverless** - AWS Lambda + API Gateway
- **Database** - PostgreSQL (Neon) + Drizzle ORM
- **Auth** - WorkOS JWT authentication
- **Storage** - S3 + CloudFront CDN
- **IaC** - AWS CDK for infrastructure

## WorkOS Auth (JWT)

- API Gateway uses a custom Lambda authorizer (`src/node/authorizers/workos-jwt.ts`)
- Verifies RS256 signature via WorkOS JWKS for `WORKOS_CLIENT_ID`
- Required claims: `sub` (user), `aud` (client), `iss=https://api.workos.com`
- Handlers access claims using `getClaims()` in `src/node/lib/auth.ts`
- Local server validates tokens the same way


## API Response Standards

All API endpoints follow a consistent response structure:

### Success Responses
```json
{
  "success": true,
  "data": {
    // Response payload here
  }
}
```

### Error Responses
```json
{
  "success": false,
  "error": "Human readable error message",
  "details": {
    "code": "ERROR_CODE",
    "requestId": "uuid",
    "timestamp": "2025-08-27T09:54:18.000Z"
  }
}
```

### Headers
All responses include:
- `Content-Type: application/json`
- `Access-Control-Allow-Origin: <matched origin>` (dynamic, per-request)

### Examples

**Organizations List:**
```json
{
  "success": true,
  "data": [
    {
      "id": "org_123",
      "name": "Acme Corp",
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

**Analytics Data:**
```json
{
  "success": true,
  "data": {
    "segments": [
      {"id": "seg_1", "name": "Engineering", "memberCount": 25}
    ],
    "totalMembers": 25,
    "totalSessions": 150
  }
}
```

**Error Example:**
```json
{
  "success": false,
  "error": "Organization not found",
  "details": {
    "code": "NOT_FOUND",
    "requestId": "req_abc123",
    "timestamp": "2025-08-27T09:54:18.000Z"
  }
}
```

## Error Handling & Observability

- Structured logs via Lambda Powertools
- Tracing enabled; disabled in local to reduce noise
- Consistent JSON response structure across all endpoints

## Performance Notes

- ARM64 Lambdas (better price/perform.)
- CommonJS bundles for stability with Node.js 24
- 256–512MB memory, 5–15s timeouts depending on handler

## 📊 Current Status

### Implemented
- ✅ User authentication (WorkOS JWT)
- ✅ User profile management
- ✅ Organization management (GraphQL)
- ✅ Image upload (S3 + CloudFront)
- ✅ Health check endpoint
- ✅ Webhook handling (WorkOS events)
- ✅ Middleware variants (auth, API key, webhook, public CORS)
- ✅ Comprehensive validation (Zod)
- ✅ Structured logging (Lambda Powertools + Sentry)
- ✅ Error handling (structured GraphQL errors, REST error factory)
- ✅ Unit tests (Vitest) + integration tests
- ✅ CI/CD pipeline (CodePipeline/CodeBuild)

### In Progress
- 🚧 Journey management
- 🚧 Campaign management
- 🚧 Contact management

### Planned
- 📋 Analytics
- 📋 Email integration
- 📋 SMS integration

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

### Quick Links
- [Code Patterns](./.ai/PATTERNS.md)
- [Template Usage](./templates/README.md)
- [Testing Guide](./tests/README.md)

---

## 📝 License

MIT License - see LICENSE file for details

---

## 🆘 Need Help?

- **Documentation:** Check `.ai/` and `docs/` directories
- **Examples:** Look at existing handlers in `src/node/handlers/`
- **Issues:** Create an issue on GitHub
- **Questions:** Ask in team chat

---

**Built with ❤️ using AWS Lambda, TypeScript, and modern best practices.**
