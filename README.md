# Serverless Backend (CDK + WorkOS + Neon)

Production-grade HTTP API on API Gateway v2 with Lambda (Node.js 20), WorkOS OIDC JWT auth, and Neon Postgres via Drizzle ORM.

## Architecture

- **API Gateway v2** with custom Lambda authorizer validating WorkOS JWTs
- **Lambdas**: Node.js 20.x, bundled as CommonJS (esbuild) to avoid dynamic require issues
- **DB**: Neon serverless Postgres using `@neondatabase/serverless` + `drizzle-orm`
- **Secrets**: AWS Secrets Manager (WorkOS + DB)
- **Observability**: CloudWatch + AWS X-Ray + Lambda Powertools

## Project Structure

```
backend/
├─ infrastructure/                # CDK stacks
├─ src/node/
│  ├─ authorizers/                # WorkOS JWT authorizer
│  ├─ handlers/                   # API handlers
│  ├─ lib/                        # Shared libs (auth, db, errors)
│  └─ db/                         # Schema & migrations
├─ scripts/                       # migrate/seed/deploy scripts
└─ test/                          # Local server (parity with Lambda)
```

## Environment

### Staging: `backend/.env.staging`

Required:
- `AWS_REGION=us-east-1`
- `STAGE=staging`
- `WORKOS_CLIENT_ID=...`
- `DATABASE_URL=postgresql://...` (Neon)
- `CORS_ORIGIN=https://*.railbranch.com`
- `API_DOMAIN=api-staging.railbranch.services`

Custom domain options:
- `HOSTED_ZONE_NAME=railbranch.services` (Route 53 managed)
- `API_CERT_ARN=arn:aws:acm:us-east-1:...` (use existing ACM cert; omit if using HOSTED_ZONE_NAME)

Notes:
- If DB TLS fails, try removing `channel_binding=require` from `DATABASE_URL`.
- `SKIP_DB=true` can bypass DB in handlers for auth-only checks.

### Local: `backend/.env.local`

- `STAGE=local`
- `AWS_REGION=us-east-1`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/serverless_db?sslmode=disable`
- `WORKOS_CLIENT_ID=...` (used to fetch JWKS for local JWT verification)
- `SKIP_DB=false` (set true for auth-only testing)
- `PORT=3000`

## Local Development (parity with Lambda)

Local server uses the real Lambda handlers and validates WorkOS tokens against JWKS (same as authorizer).

```bash
pnpm install

# Start local Postgres
pnpm local:db

# Run migrations
pnpm local:migrate

# Start local API (http://localhost:3000)
pnpm local:server

# Health
curl http://localhost:3000/v1/health

# With a real WorkOS access token
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/users/me
```

Tip: obtain a token from your frontend using WorkOS AuthKit or WorkOS dashboard test tools.

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

## Function Creation Standards

### Handler Pattern
All handlers MUST follow this exact pattern:

```ts
// src/node/handlers/<feature>/<action>.ts
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { getClaims, getOrgId } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { formatError } from '../../lib/errors';

const logger = new Logger({ serviceName: 'feature-action' });
const tracer = new Tracer({ serviceName: 'feature-action' });

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  const requestId = context.awsRequestId;
  logger.addContext(context);

  try {
    const claims = getClaims(event);
    const orgId = getOrgId(event); // if needed
    
    // Handler logic here
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        data: { /* response data */ }
      })
    };
  } catch (error) {
    logger.error('Error in handler', { error });
    return formatError(error, requestId);
  }
};
```

### Required Steps for New Endpoints

1. **Create Handler**: Follow exact pattern above in `src/node/handlers/<feature>/<action>.ts`
2. **Add to Local Server**: Update `test/local-server.ts`:
   - Import: `import { handler as featureActionHandler } from '../src/node/handlers/feature/action'`
   - Add to `handlerMap`: `'../src/node/handlers/feature/action': featureActionHandler`
3. **Add to CDK**: Update `infrastructure/lib/api-stack.ts`:
   - Create handler: `const featureActionHandler = createHandler('FeatureActionHandler', 'handlers/feature/action.ts')`
   - Add route: `this.httpApi.addRoutes({ path: '/v1/feature', methods: [...], integration: ..., authorizer: customAuthorizer })`
4. **Update OpenAPI**: Add endpoint documentation to `docs/openapi.yaml`
5. **Test**: `pnpm local:server` then `pnpm deploy:staging`

### Response Format Standards
- **Success**: `{success: true, data: {...}}`
- **Error**: `{success: false, error: "message", details: {...}}`
- **Headers**: Always include `Content-Type: application/json` and `Access-Control-Allow-Origin: *`

### Special Cases
- **Multiple handlers per file**: Use named exports like `organizations/analytics.ts`
- **Admin endpoints**: Require operator-level authorization
- **Public endpoints**: Omit `customAuthorizer` in CDK routes

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
- `Access-Control-Allow-Origin: *`

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
- CommonJS bundles for stability with Node.js 20
- 256–512MB memory, 5–15s timeouts depending on handler

## Cleanup

- Unused local shim (`test/local-handlers.ts`) has been replaced by real handlers. You can remove it.
- Local docs are consolidated here to avoid drift.

## Checklist

- ✅ GET /v1/health → 200
- ✅ GET /v1/users/me with valid WorkOS JWT → 200
- ✅ Custom domain resolves and serves `/v1/health`
- ✅ Migrations succeed on Neon
- ✅ Structured logs + X-Ray traces
