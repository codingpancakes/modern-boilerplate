import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	APIGatewayProxyStructuredResultV2,
	Context,
} from "aws-lambda";
import cors from "cors";
import * as dotenv from "dotenv";
import express from "express";
import type { JWK, JWTPayload } from "jose";
import { importJWK, jwtVerify } from "jose";

interface JWKSResponse {
	keys: (JWK & { kid?: string; alg?: string })[];
}

interface AuthenticatedRequest extends express.Request {
	user?: JWTPayload;
}

// Load environment variables BEFORE importing handlers
dotenv.config({ path: ".env.local" });

import { ApolloServer } from "@apollo/server";
import depthLimit from "graphql-depth-limit";
import { createContext as createGraphQLContext } from "../src/node/handlers/graphql/context";
// GraphQL handler needs special treatment - don't import the Lambda handler
import { handler as graphqlDocsHandler } from "../src/node/handlers/graphql/docs";
import {
	complexityPlugin,
	mutationLimitPlugin,
	requestLoggingPlugin,
	sentryPlugin,
} from "../src/node/handlers/graphql/plugins";
import { resolvers } from "../src/node/handlers/graphql/resolvers/merge";
import { typeDefs } from "../src/node/handlers/graphql/schema";
import { handler as listImagesHandler } from "../src/node/handlers/media/list-images";
import { handler as uploadImageHandler } from "../src/node/handlers/media/upload-image";
import { handler as uploadImageDirectHandler } from "../src/node/handlers/media/upload-image-direct";
import { handler as testApiKeyHandler } from "../src/node/handlers/test/api-key";
import { handler as testWebhookHandler } from "../src/node/handlers/test/webhook";
import { handler as usersMeHandler } from "../src/node/handlers/users/me";
import { handler as usersUpdateHandler } from "../src/node/handlers/users/update";
// Now import handlers after env vars are loaded
import { handler as healthHandler } from "../src/node/handlers/utils/health";
import { handler as workosWebhookHandler } from "../src/node/handlers/webhooks/workos";

// Disable AWS Lambda Powertools tracing in local mode
process.env._X_AMZN_TRACE_ID = "Root=1-00000000-000000000000000000000000";
process.env.POWERTOOLS_TRACE_DISABLED = "true";
process.env.AWS_LAMBDA_FUNCTION_NAME = "local-test";
process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs24.x";
process.env.AWS_REGION = process.env.AWS_REGION || "us-east-1";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Increase body size limit to 50MB for image uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Create Apollo Server for GraphQL
const apolloServer = new ApolloServer({
	typeDefs,
	resolvers,
	introspection: true,
	validationRules: [depthLimit(10)],
	plugins: [
		sentryPlugin,
		requestLoggingPlugin,
		complexityPlugin,
		mutationLimitPlugin,
	],
	formatError: (error) => {
		console.error("GraphQL Error:", error);
		const code = error.extensions?.code || "INTERNAL_SERVER_ERROR";
		const SAFE_CODES = new Set([
			"BAD_USER_INPUT",
			"GRAPHQL_VALIDATION_FAILED",
			"GRAPHQL_PARSE_FAILED",
			"FORBIDDEN",
			"UNAUTHENTICATED",
			"NOT_FOUND",
			"CONFLICT",
		]);
		const message = SAFE_CODES.has(code as string)
			? error.message
			: "Internal server error";
		return {
			message,
			extensions: { code },
		};
	},
});

const apolloReady = apolloServer
	.start()
	.then(() => {
		console.log("✅ Apollo Server started");
	})
	.catch((err) => {
		console.error("❌ Failed to start Apollo Server:", err);
		process.exit(1);
	});

// WorkOS access token verification
const CLIENT_ID = process.env.WORKOS_CLIENT_ID;
if (!CLIENT_ID) {
	throw new Error("WORKOS_CLIENT_ID is required in .env.local");
}
const JWKS_URL = `https://api.workos.com/sso/jwks/${CLIENT_ID}`;

// JWKS cache
let jwksCache: JWKSResponse | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour

async function fetchJWKS(): Promise<JWKSResponse> {
	const now = Date.now();
	if (jwksCache && now - jwksCacheTime < JWKS_CACHE_TTL) {
		return jwksCache;
	}

	const response = await fetch(JWKS_URL);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch JWKS: ${response.status} ${response.statusText}`,
		);
	}

	const jwks = (await response.json()) as JWKSResponse;
	jwksCache = jwks;
	jwksCacheTime = now;
	return jwks;
}

async function verifyAccessToken(accessToken: string): Promise<JWTPayload> {
	const [headerB64] = accessToken.split(".");
	const header = JSON.parse(Buffer.from(headerB64, "base64").toString()) as {
		kid?: string;
	};

	const jwks = await fetchJWKS();
	if (!jwks.keys || !Array.isArray(jwks.keys)) {
		throw new Error("Invalid JWKS response");
	}

	const jwk = jwks.keys.find((k) => k.kid === header.kid);
	if (!jwk) {
		throw new Error(`No matching key found for kid: ${header.kid}`);
	}

	const key = await importJWK(jwk, jwk.alg);
	const { payload } = await jwtVerify(accessToken, key, {
		issuer: [
			"https://api.workos.com/",
			`https://api.workos.com/user_management/${CLIENT_ID}`,
		],
	});

	console.log("JWT verified, sub:", payload.sub);

	return payload;
}

// Helper to convert Express request to Lambda event
function toLambdaEvent(
	req: express.Request,
	claims?: JWTPayload,
): APIGatewayProxyEventV2 {
	const queryParams = req.query as Record<string, string | undefined>;
	return {
		version: "2.0",
		routeKey: `${req.method} ${req.path}`,
		rawPath: req.path,
		rawQueryString: new URLSearchParams(
			Object.entries(queryParams).filter(
				(e): e is [string, string] => e[1] != null,
			),
		).toString(),
		headers: req.headers as Record<string, string>,
		queryStringParameters: queryParams as Record<string, string>,
		pathParameters: req.params,
		body: req.body ? JSON.stringify(req.body) : undefined,
		isBase64Encoded: false,
		requestContext: {
			accountId: "123456789012",
			apiId: "local-api",
			domainName: "localhost",
			domainPrefix: "localhost",
			http: {
				method: req.method,
				path: req.path,
				protocol: "HTTP/1.1",
				sourceIp: req.ip || "127.0.0.1",
				userAgent: req.get("user-agent") || "",
			},
			requestId: `local-${Date.now()}`,
			routeKey: `${req.method} ${req.path}`,
			stage: "local",
			time: new Date().toISOString(),
			timeEpoch: Date.now(),
			// Mirror the deployed custom Lambda authorizer (SIMPLE response), which
			// exposes claims under `authorizer.lambda` only — no `jwt` block, since
			// no native JWT authorizer is used. Keep this in sync with getClaims().
			authorizer: claims
				? {
						lambda: {
							...(claims as Record<string, string | number | boolean>),
						},
					}
				: undefined,
		} as APIGatewayProxyEventV2["requestContext"],
		stageVariables: {},
	} as APIGatewayProxyEventV2;
}

function createLambdaContext(): Context {
	return {
		callbackWaitsForEmptyEventLoop: false,
		functionName: "local-function",
		functionVersion: "$LATEST",
		invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:local",
		memoryLimitInMB: "512",
		awsRequestId: `local-${Date.now()}`,
		logGroupName: "/aws/lambda/local",
		logStreamName: "local-stream",
		getRemainingTimeInMillis: () => 30000,
		done: () => {},
		fail: () => {},
		succeed: () => {},
	} as Context;
}

async function requireAuth(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction,
) {
	const authHeader = req.get("authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		res.status(401).json({ error: "Missing or invalid Authorization header" });
		return;
	}

	const token = authHeader.substring(7);
	console.log("Auth: token present, length:", token.length);

	try {
		const claims = await verifyAccessToken(token);
		(req as AuthenticatedRequest).user = claims;
		next();
	} catch (error) {
		console.error("Access token verification failed:", error);
		res.status(401).json({ error: "Invalid access token" });
	}
}

// Choose webhook handler implementation based on env
// Use real handler if either WORKOS_SECRET_ARN (deployed) or WORKOS_WEBHOOK_SECRET (local) is set
const workosWebhookImpl =
	process.env.WORKOS_SECRET_ARN || process.env.WORKOS_WEBHOOK_SECRET
		? workosWebhookHandler
		: async () => ({
				statusCode: 200,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ received: true, stubbed: true }),
			});

const handlerMap: Record<string, APIGatewayProxyHandlerV2> = {
	"../src/node/handlers/health": healthHandler,
	"../src/node/handlers/webhooks/workos": workosWebhookImpl,
	"../src/node/handlers/media/upload-image": uploadImageHandler,
	"../src/node/handlers/media/upload-image-direct": uploadImageDirectHandler,
	"../src/node/handlers/media/list-images": listImagesHandler,
	"../src/node/handlers/users/me": usersMeHandler,
	"../src/node/handlers/users/update": usersUpdateHandler,
	"../src/node/handlers/test/api-key": testApiKeyHandler,
	"../src/node/handlers/test/webhook": testWebhookHandler,
	"../src/node/handlers/graphql/docs": graphqlDocsHandler,
};

function loadHandler(handlerPath: string): APIGatewayProxyHandlerV2 | null {
	const handler = handlerMap[handlerPath];
	if (handler) {
		return handler;
	}

	console.error(`No local handler found for: ${handlerPath}`);
	return null;
}

function wrapHandler(handlerPath: string) {
	return async (req: express.Request, res: express.Response) => {
		const handler = loadHandler(handlerPath);
		if (!handler) {
			res.status(500).json({ error: "Handler not found" });
			return;
		}

		const event = toLambdaEvent(req, (req as AuthenticatedRequest).user);
		const context = createLambdaContext();

		try {
			const raw = await handler(event, context, () => {});
			const result = (
				typeof raw === "string" ? { statusCode: 200, body: raw } : raw
			) as APIGatewayProxyStructuredResultV2;

			if (result.headers) {
				for (const [key, value] of Object.entries(result.headers)) {
					if (value != null) res.setHeader(key, String(value));
				}
			}

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
			console.error("Handler error:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	};
}

// Define routes
// Public routes
app.get("/v1/health", wrapHandler("../src/node/handlers/health"));
app.post("/v1/webhooks/workos", (req, res) => {
	console.log("Webhook received at /v1/webhooks/workos");
	const handler = wrapHandler("../src/node/handlers/webhooks/workos");
	handler(req, res);
});

// Media endpoints (protected)
app.post(
	"/v1/media/upload-image",
	requireAuth,
	wrapHandler("../src/node/handlers/media/upload-image"),
);
app.post(
	"/v1/media/upload-image-direct",
	requireAuth,
	wrapHandler("../src/node/handlers/media/upload-image-direct"),
);
app.get(
	"/v1/media/images",
	requireAuth,
	wrapHandler("../src/node/handlers/media/list-images"),
);

// User endpoints (protected)
app.get(
	"/v1/users/me",
	requireAuth,
	wrapHandler("../src/node/handlers/users/me"),
);
app.patch(
	"/v1/users/me",
	requireAuth,
	wrapHandler("../src/node/handlers/users/update"),
);

// Test endpoints (various middleware)
app.get("/v1/test/api-key", wrapHandler("../src/node/handlers/test/api-key"));
app.post("/v1/test/webhook", wrapHandler("../src/node/handlers/test/webhook"));

// GraphQL endpoints - handled directly by Apollo Server
// Context is built via the same createContext used by the Lambda handler,
// so local dev stays in sync with deployed behavior automatically.
app.post("/v1/graphql", requireAuth, async (req: express.Request, res) => {
	try {
		const event = toLambdaEvent(req, (req as AuthenticatedRequest).user);
		const context = await createGraphQLContext({ event });

		const { query, variables, operationName } = req.body;

		const response = await apolloServer.executeOperation(
			{ query, variables, operationName },
			{ contextValue: context },
		);

		if (response.body.kind === "single") {
			res.status(200).json(response.body.singleResult);
		} else {
			res
				.status(200)
				.json({ errors: [{ message: "Incremental delivery not supported" }] });
		}
	} catch (error) {
		console.error("GraphQL execution error:", error);
		res.status(500).json({ errors: [{ message: "Internal server error" }] });
	}
});

app.get("/v1/graphql", requireAuth, async (req: express.Request, res) => {
	const query = req.query.query as string;
	if (!query) {
		res.status(400).json({ errors: [{ message: "Query parameter required" }] });
		return;
	}

	try {
		const event = toLambdaEvent(req, (req as AuthenticatedRequest).user);
		const context = await createGraphQLContext({ event });

		const response = await apolloServer.executeOperation(
			{ query },
			{ contextValue: context },
		);

		if (response.body.kind === "single") {
			res.status(200).json(response.body.singleResult);
		} else {
			res
				.status(200)
				.json({ errors: [{ message: "Incremental delivery not supported" }] });
		}
	} catch (error) {
		console.error("GraphQL execution error:", error);
		res.status(500).json({ errors: [{ message: "Internal server error" }] });
	}
});

app.get("/v1/graphql/docs", wrapHandler("../src/node/handlers/graphql/docs")); // Public docs

apolloReady.then(() => {
	app.listen(PORT, () => {
		console.log(`\n🚀 Local API server running on http://localhost:${PORT}`);
		console.log(
			`📊 REST API docs: http://localhost:${PORT}/docs (run 'pnpm docs:serve' separately)`,
		);
		console.log(`🔵 GraphQL API: http://localhost:${PORT}/v1/graphql`);
		console.log(`📘 GraphQL docs: http://localhost:${PORT}/v1/graphql/docs`);
	});
});
