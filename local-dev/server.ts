import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { jwtVerify, importJWK } from 'jose';

// Load environment variables BEFORE importing handlers
dotenv.config({ path: '.env.local' });

// Now import handlers after env vars are loaded
import { handler as healthHandler } from '../src/node/handlers/utils/health';
import { handler as workosWebhookHandler } from '../src/node/handlers/webhooks/workos';
import { handler as uploadImageHandler } from '../src/node/handlers/media/upload-image';
import { handler as uploadImageDirectHandler } from '../src/node/handlers/media/upload-image-direct';
import { handler as listImagesHandler } from '../src/node/handlers/media/list-images';
import { handler as usersMeHandler } from '../src/node/handlers/users/me';
import { handler as usersUpdateHandler } from '../src/node/handlers/users/update';
import { handler as testApiKeyHandler } from '../src/node/handlers/test/api-key';
import { handler as testWebhookHandler } from '../src/node/handlers/test/webhook';
// GraphQL handler needs special treatment - don't import the Lambda handler
import { handler as graphqlDocsHandler } from '../src/node/handlers/graphql/docs';
import { ApolloServer } from '@apollo/server';
import { userResolvers } from '../src/node/handlers/graphql/resolvers/users';
import { mediaResolvers } from '../src/node/handlers/graphql/resolvers/media';
import { typeDefs } from '../src/node/handlers/graphql/schema';
import { getDb } from '../src/node/lib/db';

// Disable AWS Lambda Powertools tracing in local mode
process.env._X_AMZN_TRACE_ID = 'Root=1-00000000-000000000000000000000000';
process.env.POWERTOOLS_TRACE_DISABLED = 'true';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'local-test';
process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs20.x';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Increase body size limit to 50MB for image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Create Apollo Server for GraphQL
const resolvers = {
  Query: {
    ...userResolvers.Query,
    ...mediaResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...mediaResolvers.Mutation,
  },
  User: userResolvers.User,
  Profile: userResolvers.Profile,
  OrganizationMembership: userResolvers.OrganizationMembership,
  Organization: userResolvers.Organization,
};

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  formatError: (error) => {
    console.error('GraphQL Error:', error);
    return {
      message: error.message,
      extensions: {
        code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
      },
    };
  },
});

// Start Apollo Server
apolloServer.start().then(() => {
  console.log('✅ Apollo Server started');
}).catch((err) => {
  console.error('❌ Failed to start Apollo Server:', err);
});

// WorkOS access token verification
const CLIENT_ID = process.env.WORKOS_CLIENT_ID;
if (!CLIENT_ID) {
  throw new Error('WORKOS_CLIENT_ID is required in .env.local');
}
const JWKS_URL = `https://api.workos.com/sso/jwks/${CLIENT_ID}`;

// JWKS cache
let jwksCache: any = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour

async function fetchJWKS(): Promise<any> {
  const now = Date.now();
  if (jwksCache && (now - jwksCacheTime) < JWKS_CACHE_TTL) {
    return jwksCache;
  }

  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status} ${response.statusText}`);
  }
  
  const jwks = await response.json();
  jwksCache = jwks;
  jwksCacheTime = now;
  return jwks;
}

async function verifyAccessToken(accessToken: string): Promise<any> {
  // Decode header to get kid
  const [headerB64] = accessToken.split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());
  
  // Get JWKS and find matching key
  const jwks = await fetchJWKS();
  if (!jwks.keys || !Array.isArray(jwks.keys)) {
    throw new Error('Invalid JWKS response');
  }
  
  const jwk = jwks.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(`No matching key found for kid: ${header.kid}`);
  }
  
  // Import key and verify token
  const key = await importJWK(jwk, jwk.alg);
  console.log('Local JWT verification - token:', accessToken ? `${accessToken.slice(0, 20)}...${accessToken.slice(-20)}` : 'missing');
  console.log('Local JWT verification - CLIENT_ID:', CLIENT_ID);
  
  const { payload } = await jwtVerify(accessToken, key, {
    issuer: ['https://api.workos.com/', `https://api.workos.com/user_management/${CLIENT_ID}`],
    // Skip audience validation - WorkOS tokens may not include aud claim
  });
  
  console.log('Local JWT payload:', JSON.stringify(payload, null, 2));
  
  return payload;
}

// Helper to convert Express request to Lambda event
function toLambdaEvent(req: express.Request, claims?: any): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${req.method} ${req.path}`,
    rawPath: req.path,
    rawQueryString: new URLSearchParams(req.query as any).toString(),
    headers: req.headers as any,
    queryStringParameters: req.query as any,
    pathParameters: req.params,
    body: req.body ? JSON.stringify(req.body) : undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'local-api',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: {
        method: req.method,
        path: req.path,
        protocol: 'HTTP/1.1',
        sourceIp: req.ip || '127.0.0.1',
        userAgent: req.get('user-agent') || '',
      },
      requestId: `local-${Date.now()}`,
      routeKey: `${req.method} ${req.path}`,
      stage: 'local',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      // Mock authorizer context to support both JWT authorizer and SIMPLE Lambda authorizer shapes
      authorizer: claims ? {
        // Shape returned by JWT authorizer
        jwt: {
          claims,
          scopes: []
        },
        // Shape returned by HTTP API SIMPLE Lambda authorizer
        lambda: {
          ...claims
        }
      } : undefined,
    } as any,
    stageVariables: {},
  };
}

// Helper to create mock context
function createContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'local-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:local',
    memoryLimitInMB: '512',
    awsRequestId: `local-${Date.now()}`,
    logGroupName: '/aws/lambda/local',
    logStreamName: 'local-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  } as any;
}

// Auth middleware
async function requireAuth(req: express.Request, res: express.Response, next: any) {
  const authHeader = req.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  
  const token = authHeader.substring(7);
  console.log('🔑 INTERCEPTED TOKEN:', token);
  
  try {
    const claims = await verifyAccessToken(token);
    (req as any).user = claims;
    next();
  } catch (error) {
    console.error('Access token verification failed:', error);
    return res.status(401).json({ error: 'Invalid access token' });
  }
}

// Choose webhook handler implementation based on env
// Use real handler if either WORKOS_SECRET_ARN (deployed) or WORKOS_WEBHOOK_SECRET (local) is set
const workosWebhookImpl = (process.env.WORKOS_SECRET_ARN || process.env.WORKOS_WEBHOOK_SECRET)
  ? workosWebhookHandler
  : async () => ({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ received: true, stubbed: true }),
    });

// Map handler paths to real Lambda handlers for parity with staging
const handlerMap: Record<string, Function> = {
  '../src/node/handlers/health': healthHandler,
  '../src/node/handlers/webhooks/workos': workosWebhookImpl,
  '../src/node/handlers/media/upload-image': uploadImageHandler,
  '../src/node/handlers/media/upload-image-direct': uploadImageDirectHandler,
  '../src/node/handlers/media/list-images': listImagesHandler,
  '../src/node/handlers/users/me': usersMeHandler,
  '../src/node/handlers/users/update': usersUpdateHandler,
  '../src/node/handlers/test/api-key': testApiKeyHandler,
  '../src/node/handlers/test/webhook': testWebhookHandler,
  '../src/node/handlers/graphql/docs': graphqlDocsHandler,
};

async function loadHandler(path: string) {
  const handler = handlerMap[path];
  if (handler) {
    return handler;
  }
  
  console.error(`No local handler found for: ${path}`);
  return null;
}

// Route wrapper for Lambda handlers
function wrapHandler(handlerPath: string) {
  return async (req: express.Request, res: express.Response) => {
    const handler = await loadHandler(handlerPath);
    if (!handler) {
      return res.status(500).json({ error: 'Handler not found' });
    }

    const event = toLambdaEvent(req, (req as any).user);
    const context = createContext();

    try {
      const result = await handler(event, context);
      
      // Set response headers
      if (result.headers) {
        Object.entries(result.headers).forEach(([key, value]) => {
          res.setHeader(key, value as string);
        });
      }

      // Send response
      res.status(result.statusCode || 200);
      if (result.body) {
        try {
          res.json(JSON.parse(result.body));
        } catch {
          res.send(result.body);
        }
      } else {
        res.end();
      }
    } catch (error) {
      console.error('Handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// Define routes
// Public routes
app.get('/v1/health', wrapHandler('../src/node/handlers/health'));
app.post('/v1/webhooks/workos', (req, res, next) => {
  console.log('🔔 WEBHOOK ROUTE HIT - Request received at /v1/webhooks/workos');
  console.log('Headers:', req.headers);
  console.log('Body preview:', JSON.stringify(req.body).substring(0, 200));
  const handler = wrapHandler('../src/node/handlers/webhooks/workos');
  handler(req, res);
});

// Media endpoints (protected)
app.post('/v1/media/upload-image', requireAuth, wrapHandler('../src/node/handlers/media/upload-image'));
app.post('/v1/media/upload-image-direct', requireAuth, wrapHandler('../src/node/handlers/media/upload-image-direct'));
app.get('/v1/media/images', requireAuth, wrapHandler('../src/node/handlers/media/list-images'));

// User endpoints (protected)
app.get('/v1/users/me', requireAuth, wrapHandler('../src/node/handlers/users/me'));
app.patch('/v1/users/me', requireAuth, wrapHandler('../src/node/handlers/users/update'));

// Test endpoints (various middleware)
app.get('/v1/test/api-key', wrapHandler('../src/node/handlers/test/api-key'));
app.post('/v1/test/webhook', wrapHandler('../src/node/handlers/test/webhook'));

// GraphQL endpoints - handled directly by Apollo Server
app.post('/v1/graphql', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const db = await getDb();
    
    // Look up internal user ID from provider subject (WorkOS ID -> internal UUID)
    const { authIdentities } = await import('../src/node/db/schema/index');
    const { eq } = await import('drizzle-orm');
    
    const providerSubject = user.sub;
    const authResult = await db
      .select({ userId: authIdentities.userId })
      .from(authIdentities)
      .where(eq(authIdentities.providerSubject, providerSubject))
      .limit(1);
    
    if (!authResult || authResult.length === 0 || !authResult[0].userId) {
      return res.status(401).json({ errors: [{ message: 'Unauthorized' }] });
    }
    
    const userId = authResult[0].userId;
    
    const context = {
      userId, // Internal UUID
      orgId: user.org_id || '',
      role: user.role || 'member',
      email: user.email || '',
      providerSubject, // WorkOS ID
      claims: user,
      db,
    };
    
    const { query, variables, operationName } = req.body;
    
    const response = await apolloServer.executeOperation(
      { query, variables, operationName },
      { contextValue: context }
    );
    
    if (response.body.kind === 'single') {
      res.status(200).json(response.body.singleResult);
    } else {
      res.status(200).json({ errors: [{ message: 'Incremental delivery not supported' }] });
    }
  } catch (error) {
    console.error('GraphQL execution error:', error);
    res.status(500).json({ errors: [{ message: 'Internal server error' }] });
  }
});

app.get('/v1/graphql', requireAuth, async (req, res) => {
  // Support GET for introspection queries
  const query = req.query.query as string;
  if (!query) {
    return res.status(400).json({ errors: [{ message: 'Query parameter required' }] });
  }
  
  try {
    const user = (req as any).user;
    const db = await getDb();
    
    // Look up internal user ID from provider subject (WorkOS ID -> internal UUID)
    const { authIdentities } = await import('../src/node/db/schema/index');
    const { eq } = await import('drizzle-orm');
    
    const providerSubject = user.sub;
    const authResult = await db
      .select({ userId: authIdentities.userId })
      .from(authIdentities)
      .where(eq(authIdentities.providerSubject, providerSubject))
      .limit(1);
    
    if (!authResult || authResult.length === 0 || !authResult[0].userId) {
      return res.status(401).json({ errors: [{ message: 'Unauthorized' }] });
    }
    
    const userId = authResult[0].userId;
    
    const context = {
      userId, // Internal UUID
      orgId: user.org_id || '',
      role: user.role || 'member',
      email: user.email || '',
      providerSubject, // WorkOS ID
      claims: user,
      db,
    };
    
    const response = await apolloServer.executeOperation(
      { query },
      { contextValue: context }
    );
    
    if (response.body.kind === 'single') {
      res.status(200).json(response.body.singleResult);
    } else {
      res.status(200).json({ errors: [{ message: 'Incremental delivery not supported' }] });
    }
  } catch (error) {
    console.error('GraphQL execution error:', error);
    res.status(500).json({ errors: [{ message: 'Internal server error' }] });
  }
});

app.get('/v1/graphql/docs', wrapHandler('../src/node/handlers/graphql/docs')); // Public docs

app.listen(PORT, () => {
  console.log(`\n🚀 Local API server running on http://localhost:${PORT}`);
  console.log(`📊 REST API docs: http://localhost:${PORT}/docs (run 'npm run docs:serve' separately)`);
  console.log(`🔵 GraphQL API: http://localhost:${PORT}/v1/graphql`);
  console.log(`📘 GraphQL docs: http://localhost:${PORT}/v1/graphql/docs`);
});
