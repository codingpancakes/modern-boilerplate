# Code Patterns & Standards

This document defines the coding patterns and standards for this project. **AI assistants should follow these patterns when generating code.**

## Handler Patterns

### Pattern 1: User-Scoped Handlers
**Use for:** Endpoints that operate on the authenticated user's own data.

**Template:** `/templates/user-scoped.ts`

**Examples:**
- `GET /v1/users/me` - Get current user
- `PATCH /v1/users/me` - Update current user
- `POST /v1/media/upload-image` - Upload user's image

**Key Characteristics:**
- Uses `withAuth` middleware
- No organization membership checks
- User ID from JWT claims: `event.claims.sub`
- Persistent logging: `logger.appendKeys({ userId })`

```typescript
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const userId = event.claims.sub;
  logger.appendKeys({ userId });
  
  // Validate input with Zod
  const input = parseBody(event, userSchemas.create);
  
  // Database operations
  const db = await getDb();
  // ... query using userId
  
  return createSuccessResponse(result);
};

export const handler = withAuth(handlerFn);
```

---

### Pattern 2: Organization-Scoped Handlers
**Use for:** Endpoints that require organization membership.

**Template:** `/templates/org-scoped.ts`

**Examples:**
- `GET /v1/orgs/{orgId}/campaigns` - List org campaigns
- `POST /v1/orgs/{orgId}/contacts` - Create org contact

**Key Characteristics:**
- Uses `withAuth` middleware
- Requires organization membership check
- Org ID from path: `getOrgId(event)`
- Persistent logging: `logger.appendKeys({ userId, orgId })`

```typescript
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const userId = event.claims.sub;
  const orgId = getOrgId(event);
  logger.appendKeys({ userId, orgId });
  
  // Check org membership
  await requireOrgMembership(userId, orgId);
  
  // ... rest of handler
};
```

---

### Pattern 3: Public/Webhook Handlers
**Use for:** Public endpoints or webhooks that don't require authentication.

**Template:** `/templates/public.ts`

**Examples:**
- `GET /v1/health` - Health check
- `POST /v1/webhooks/stripe` - Stripe webhook

**Key Characteristics:**
- Uses `withWebhookSignature` or no middleware
- No authentication required
- Validate webhook signatures if applicable

---

### Pattern 4: Python Lambda Proxy
**Use for:** Python-specific workloads (ML inference, data processing, scientific computing).

**When to use:**
- Machine learning inference
- Data processing with pandas/numpy
- Python-specific libraries
- Legacy Python code integration

**Architecture:**
1. **TypeScript proxy** handles authentication
2. **TypeScript invokes** Python Lambda
3. **Python receives** pre-validated claims
4. **Python Lambda** is NOT publicly accessible (security)

**Example: TypeScript Proxy Handler**
```typescript
// src/node/handlers/ml/predict.ts
import type { Context } from 'aws-lambda';
import { withAuth, type AuthenticatedEvent, type HandlerResponse } from '../../lib/middleware';
import { invokePythonLambda } from '../../lib/invokePythonLambda';
import { createSuccessResponse } from '../../lib/response';

const handlerFn = async (
  event: AuthenticatedEvent,
  _context: Context
): Promise<HandlerResponse> => {
  const { claims } = event;

  // Invoke Python Lambda with authenticated claims
  const result = await invokePythonLambda(
    process.env.PYTHON_ML_FUNCTION_NAME || 'python-ml-predict',
    {
      claims,
      body: event.body ? JSON.parse(event.body) : undefined,
      queryStringParameters: event.queryStringParameters || {},
      pathParameters: event.pathParameters || {},
    }
  );

  // Python returns { success: true, data: {...} }
  return createSuccessResponse(result.data);
};

export const handler = withAuth(handlerFn);
```

**Example: Python Handler**
```python
# src/python/handlers/ml/predict.py
import json

def handler(event, context):
    """
    ML prediction handler.
    Receives pre-validated claims from TypeScript proxy.
    """
    # Extract user claims (already validated by TypeScript)
    claims = event.get('claims', {})
    user_id = claims.get('sub')
    
    # Get request data
    body = event.get('body', {})
    features = body.get('features', [])
    
    # Your Python logic here
    prediction = run_ml_model(features)
    
    # Return result (TypeScript will wrap in API response)
    return {
        'success': True,
        'data': {
            'userId': user_id,
            'prediction': prediction,
            'confidence': 0.95
        }
    }
```

**CDK Infrastructure**
```typescript
// infrastructure/lib/api-stack.ts

// 1. Create Python Lambda (NOT publicly accessible)
const pythonMLHandler = new lambda.Function(this, "PythonMLHandler", {
  functionName: `${projectName}-${props.stage}-python-ml-predict`,
  runtime: lambda.Runtime.PYTHON_3_11,
  code: lambda.Code.fromAsset(path.join(__dirname, "../../src/python")),
  handler: "handlers.ml.predict.handler",
  architecture: lambda.Architecture.ARM_64,
  memorySize: 512,  // Increase for ML workloads
  timeout: cdk.Duration.seconds(30),
  environment: commonEnv,
  tracing: lambda.Tracing.ACTIVE,
});

// 2. Create TypeScript proxy handler
const tsProxyMLHandler = routeBuilder.createHandler({
  name: "MLPredictProxyHandler",
  path: "handlers/ml/predict.ts",
  environment: {
    ...commonEnv,
    PYTHON_ML_FUNCTION_NAME: pythonMLHandler.functionName,
  },
});

// 3. Add public route (only TypeScript proxy is public!)
this.httpApi.addRoutes({
  path: "/v1/ml/predict",
  methods: [apigwv2.HttpMethod.POST],
  integration: new apigwv2Integrations.HttpLambdaIntegration(
    "MLPredictProxyIntegration",
    tsProxyMLHandler
  ),
  authorizer: customAuthorizer,  // Auth required
});
```

**Key Points:**
- ✅ TypeScript handles ALL authentication
- ✅ Python receives pre-validated claims
- ✅ Python Lambda has NO public endpoint
- ✅ Only TypeScript Lambda can invoke Python
- ✅ Secure by design (IAM-controlled invocation)

**See Also:**
- `src/python/README.md` - Python handler guide
- `src/node/lib/invokePythonLambda.ts` - Helper function
- `PYTHON_PROXY_AUDIT.md` - Security audit

---

## Validation Pattern

**ALWAYS use domain-organized Zod schemas.**

### 1. Define Schema in Domain File
```typescript
// src/node/lib/validation/users.ts
export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  metadata: z.record(z.unknown()).optional(),
});
```

### 2. Export in Index
```typescript
// src/node/lib/validation/index.ts
export const userSchemas = {
  create: userValidation.createUserSchema,
  update: userValidation.updateUserSchema,
  // ...
};
```

### 3. Use in Handler
```typescript
import { parseBody, userSchemas } from '../../lib/validation';

// Automatically validates and throws 400 if invalid
const input = parseBody(event, userSchemas.create);
```

### 4. Type Inference
```typescript
// Type is automatically inferred from schema
type CreateUserInput = z.infer<typeof userSchemas.create>;
```

---

## Database Pattern

**ALWAYS use Drizzle ORM, never raw SQL.**

### ✅ Correct
```typescript
const db = await getDb();

// Select with where clause
const users = await db
  .select()
  .from(users)
  .where(eq(users.id, userId))
  .limit(1);

// Insert
const result = await db
  .insert(resources)
  .values({ userId, name: input.name })
  .returning();

// Update
await db
  .update(users)
  .set({ firstName: input.firstName })
  .where(eq(users.id, userId));
```

### ❌ Incorrect
```typescript
// Don't use raw SQL
const result = await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`);
```

---

## Error Handling Pattern

**Let middleware handle errors - don't use try-catch in handlers.**

### ✅ Correct
```typescript
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  // Just throw errors - middleware catches them
  if (!userId) throw Errors.Unauthorized();
  if (!input.name) throw Errors.BadRequest('Name is required');
  
  const db = await getDb();
  const result = await db.select()... // If this fails, middleware catches it
  
  return { statusCode: 200, body: JSON.stringify({ success: true, data: result }) };
};
```

### ❌ Incorrect
```typescript
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  try {
    // Don't wrap everything in try-catch
    const db = await getDb();
    // ...
  } catch (error) {
    // Middleware already does this
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
```

---

## Logging Pattern

### 1. Add Context at Start
```typescript
logger.addContext(context);
```

### 2. Add Persistent Keys
```typescript
// These appear in ALL subsequent logs
logger.appendKeys({ userId, orgId, resourceId });
```

### 3. Log Important Events
```typescript
logger.info('Operation started', { input });
logger.info('Operation completed', { result });
logger.warn('Unusual condition', { details });
logger.error('Operation failed', { error });
```

---

## Response Pattern

**Always use response helpers.**

### Success Response
```typescript
import { createSuccessResponse } from '../../lib/response';

return createSuccessResponse(result);
// or with custom data
return createSuccessResponse({ user, profile });
```

### Paginated Response
```typescript
import { createPaginatedResponse } from '../../lib/response';

return createPaginatedResponse({
  items: results,
  total: count,
  page: 1,
  limit: 10,
});
```

### No Content Response (204)
```typescript
import { createNoContentResponse } from '../../lib/response';

return createNoContentResponse();
```

---

## Swagger Documentation Pattern

**Every handler must have Swagger docs.**

```typescript
/**
 * @swagger
 * /v1/resource:
 *   post:
 *     tags: [Resource]
 *     summary: Create resource
 *     description: Detailed description
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
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
```

---

## File Naming Pattern

### Handlers
- Use kebab-case: `upload-image.ts`, `list-campaigns.ts`
- One handler per file
- Location: `src/node/handlers/{resource}/{action}.ts`

### Schemas
- Define in `src/node/lib/validation.ts`
- Use camelCase: `createResource`, `updateUserProfile`

### Tests
- Use kebab-case: `test-handlers.sh`, `test-middleware.sh`
- Location: `tests/integration/`

---

## Import Pattern

### Order
1. External packages
2. AWS SDK
3. Local lib imports
4. Local schema imports
5. Type imports (last)

```typescript
import { Logger } from '@aws-lambda-powertools/logger';
import { S3Client } from '@aws-sdk/client-s3';
import { withAuth, AuthenticatedEvent } from '../../lib/middleware';
import { parseBody, schemas } from '../../lib/validation';
import type { Context } from 'aws-lambda';
```

---

## Swagger Documentation Pattern

**CRITICAL: ALWAYS add @swagger JSDoc comments to EVERY handler.**

### Why Swagger Docs?
- ✅ Auto-generates OpenAPI 3.0 specification
- ✅ Interactive Swagger UI for testing
- ✅ Client SDK generation
- ✅ API documentation for frontend teams
- ✅ Contract-first development

### Template for User-Scoped Handlers
```typescript
/**
 * @swagger
 * /v1/[resource]/[action]:
 *   [method]:
 *     tags: [[Resource]]
 *     summary: Brief description (one line)
 *     description: Detailed description with examples and use cases
 *     security:
 *       - BearerAuth: []
 *     requestBody:  # For POST/PUT/PATCH only
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fieldName:
 *                 type: string
 *                 example: "example value"
 *               optionalField:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Success response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "user_123"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  // Handler code
};

export const handler = withAuth(handlerFn);
```

### Template for Public Endpoints
```typescript
/**
 * @swagger
 * /v1/[resource]:
 *   [method]:
 *     tags: [[Resource]]
 *     summary: Brief description
 *     description: Detailed description
 *     security: []  # No auth required
 *     responses:
 *       200:
 *         description: Success
 */
```

### AI Instructions for Swagger Generation

When creating a handler, AI should:

1. **Infer HTTP method** from filename or code:
   - `create.ts` → POST
   - `update.ts` → PATCH
   - `delete.ts` → DELETE
   - `list.ts` or `get.ts` → GET

2. **Infer path** from file location:
   - `handlers/users/me.ts` → `/v1/users/me`
   - `handlers/orgs/[orgId]/campaigns.ts` → `/v1/orgs/{orgId}/campaigns`

3. **Detect authentication**:
   - If uses `withAuth` → add `security: [{ BearerAuth: [] }]`
   - If uses `withPublicCors` → add `security: []`

4. **Extract request schema** from `parseBody()`:
   ```typescript
   const input = parseBody(event, userSchemas.update);
   // → Generate requestBody from userSchemas.update
   ```

5. **Infer response** from `createSuccessResponse()`:
   ```typescript
   return createSuccessResponse({ user, profile });
   // → Generate response schema with user and profile objects
   ```

6. **Add error responses**:
   - Always include: 500 (ServerError)
   - If authenticated: 401 (Unauthorized), 403 (Forbidden)
   - If has request body: 400 (BadRequest)
   - If has path params: 404 (NotFound)

### Examples

#### Example 1: Simple GET
```typescript
/**
 * @swagger
 * /v1/users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get current user profile
 *     description: Returns the authenticated user's complete profile
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
```

#### Example 2: POST with Request Body
```typescript
/**
 * @swagger
 * /v1/media/upload-image:
 *   post:
 *     tags: [Media]
 *     summary: Generate presigned URL for image upload
 *     description: Creates a presigned S3 URL for uploading user images
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filename:
 *                 type: string
 *                 example: "profile-photo.jpg"
 *               contentType:
 *                 type: string
 *                 example: "image/jpeg"
 *     responses:
 *       200:
 *         description: Presigned URL generated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
```

#### Example 3: Python Proxy Handler
```typescript
/**
 * @swagger
 * /v1/ml/predict:
 *   post:
 *     tags: [ML]
 *     summary: Run ML prediction
 *     description: |
 *       TypeScript → Python Lambda proxy for ML inference.
 *       TypeScript handles auth, Python handles ML model.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               features:
 *                 type: array
 *                 items:
 *                   type: number
 *     responses:
 *       200:
 *         description: Prediction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     prediction:
 *                       type: string
 *                     confidence:
 *                       type: number
 */
```

### Generating OpenAPI Spec

After adding/updating handlers:
```bash
npm run docs:generate  # Generate OpenAPI spec
npm run docs:serve     # View Swagger UI
```

Open http://localhost:3111 to view interactive API documentation.

---

## Summary Checklist

### For TypeScript Handlers
When creating a new TypeScript handler, ensure:
- [ ] Uses appropriate template (user-scoped, org-scoped, or public)
- [ ] Has Zod schema in appropriate domain file
- [ ] Schema exported in `validation/index.ts`
- [ ] Uses `parseBody()` or `parseQuery()` for validation
- [ ] Uses response helpers (`createSuccessResponse`, etc.)
- [ ] Uses Drizzle ORM (no raw SQL)
- [ ] No try-catch blocks (let middleware handle errors)
- [ ] Has persistent logging context
- [ ] Has comprehensive Swagger documentation
- [ ] Follows file naming conventions
- [ ] Has corresponding test in test script

### For Python Proxy Handlers
When creating a Python Lambda with TypeScript proxy:
- [ ] TypeScript proxy uses `withAuth` middleware
- [ ] TypeScript proxy uses `invokePythonLambda()` helper
- [ ] Python Lambda created in CDK (NOT publicly accessible)
- [ ] TypeScript proxy has env var for Python function name
- [ ] Python handler receives and validates claims
- [ ] Python handler returns `{ success: bool, data: object }`
- [ ] IAM permissions allow Lambda invocation
- [ ] Route added to API Gateway (points to TypeScript proxy only)
- [ ] Test added to integration test script
- [ ] Python dependencies added to `requirements.txt` if needed
