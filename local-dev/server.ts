/**
 * Local dev server — serves THE SAME Hono app as production.
 *
 * There is no Express shim and no per-handler emulation anymore: the app in
 * `src/node/app.ts` (routing, middleware, auth, error formatting) is served
 * directly with `@hono/node-server`, so local dev cannot drift from deployed
 * behavior. Auth uses the shared WorkOS verifier via the app's own auth
 * middleware (`src/node/lib/hono/auth.ts`) — no authorizer emulation.
 *
 * The only local-only additions, registered on a thin wrapper app BEFORE the
 * shared app so its REST middleware stays out of their way (matching how API
 * Gateway invokes them as separate Lambdas in production):
 *   - /v1/graphql       — passthrough to the existing Apollo Lambda handler
 *   - /graphql/docs     — GraphiQL UI (alias kept at /v1/graphql/docs)
 *   - /v1/test/*        — middleware diagnostics used by test-middleware.sh
 */
import * as dotenv from "dotenv";

// Load environment variables BEFORE importing the app — CORS allow-lists,
// origin-verify, and the WorkOS client id are read at module load.
dotenv.config({ path: ".env.local" });

// Disable AWS Lambda Powertools tracing in local mode
process.env._X_AMZN_TRACE_ID = "Root=1-00000000-000000000000000000000000";
process.env.POWERTOOLS_TRACE_DISABLED = "true";
process.env.AWS_LAMBDA_FUNCTION_NAME = "local-test";
process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs24.x";
process.env.AWS_REGION = process.env.AWS_REGION || "us-east-1";

import { serve } from "@hono/node-server";
import type {
	APIGatewayProxyEventV2WithLambdaAuthorizer,
	APIGatewayProxyHandlerV2,
	APIGatewayProxyResultV2,
	Context as LambdaContext,
} from "aws-lambda";
import { type Context, Hono } from "hono";
import { app, appNotFound, appOnError } from "../src/node/app";
import { handler as graphqlDocsHandler } from "../src/node/handlers/graphql/docs";
import { handler as graphqlHandler } from "../src/node/handlers/graphql/handler";
import { handler as testApiKeyHandler } from "../src/node/handlers/test/api-key";
import { handler as testWebhookHandler } from "../src/node/handlers/test/webhook";
import { requireAuth } from "../src/node/lib/hono/auth";
import { requestId } from "../src/node/lib/hono/middleware";
import type { AppEnv, AuthClaims } from "../src/node/lib/hono/types";

// Fail fast: the auth middleware's local verify path needs the client id.
if (!process.env.WORKOS_CLIENT_ID) {
	throw new Error("WORKOS_CLIENT_ID is required in .env.local");
}

const PORT = Number(process.env.PORT) || 3000;

type LocalLambdaEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<
	AuthClaims | undefined
>;

/**
 * Build an API Gateway-shaped event from the Hono context for the legacy
 * Lambda handlers that still take one (the Apollo GraphQL handler and the
 * /v1/test diagnostics). Claims go under `authorizer.lambda`, exactly where
 * the deployed custom authorizer puts them (`getClaims` in `lib/auth.ts`).
 */
function toLambdaEvent(
	c: Context<AppEnv>,
	claims: AuthClaims | undefined,
	rawBody: string,
): LocalLambdaEvent {
	const url = new URL(c.req.url);
	const query = c.req.query();
	const routeKey = `${c.req.method} ${c.req.path}`;
	const now = Date.now();

	return {
		version: "2.0",
		routeKey,
		rawPath: c.req.path,
		rawQueryString: url.searchParams.toString(),
		headers: c.req.header(),
		queryStringParameters: Object.keys(query).length > 0 ? query : undefined,
		body: rawBody === "" ? undefined : rawBody,
		isBase64Encoded: false,
		requestContext: {
			accountId: "123456789012",
			apiId: "local-api",
			authorizer: { lambda: claims },
			domainName: "localhost",
			domainPrefix: "localhost",
			http: {
				method: c.req.method,
				path: c.req.path,
				protocol: "HTTP/1.1",
				sourceIp: "127.0.0.1",
				userAgent: c.req.header("user-agent") ?? "",
			},
			requestId: c.get("requestId"),
			routeKey,
			stage: "local",
			time: new Date(now).toISOString(),
			timeEpoch: now,
		},
		stageVariables: undefined,
	};
}

function createLambdaContext(): LambdaContext {
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
	};
}

/** Convert an API Gateway-shaped result into the Response Hono expects. */
function toResponse(result: APIGatewayProxyResultV2): Response {
	if (typeof result === "string") {
		return new Response(result, {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
	const headers = new Headers();
	for (const [key, value] of Object.entries(result.headers ?? {})) {
		headers.set(key, String(value));
	}
	return new Response(result.body ?? null, {
		status: result.statusCode ?? 200,
		headers,
	});
}

/** Invoke a legacy `APIGatewayProxyHandlerV2` with a context-derived event. */
async function invokeLambda(
	handler: APIGatewayProxyHandlerV2,
	c: Context<AppEnv>,
	claims?: AuthClaims,
): Promise<Response> {
	const event = toLambdaEvent(c, claims, await c.req.text());
	const result = await handler(event, createLambdaContext(), () => {});
	if (!result) {
		// All wrapped handlers are async — the callback style is never used.
		throw new Error("Lambda handler returned no response");
	}
	return toResponse(result);
}

/**
 * Wrapper app for local-only routes. These are registered BEFORE the shared
 * app is mounted so they bypass its REST middleware — in production they are
 * separate Lambdas that API Gateway invokes directly (each applies its own
 * CORS/security headers), not routes behind the shared app's middleware.
 */
const local = new Hono<AppEnv>();
local.use(requestId());
// Mirror the shared app's notFound/onError: `route()` does not carry them up.
local.notFound(appNotFound);
local.onError(appOnError);

// GraphQL — same Apollo Lambda handler, same auth middleware. Deployed, the
// route is POST-only outside development; locally GET is kept for GraphiQL.
local.on(["GET", "POST"], "/v1/graphql", requireAuth(), async (c) =>
	invokeLambda(graphqlHandler, c, c.get("claims")),
);

// GraphiQL UI — public, development-only (deployed at /graphql/docs; the
// /v1/graphql/docs alias matches what the old dev server served).
local.get("/graphql/docs", async (c) => invokeLambda(graphqlDocsHandler, c));
local.get("/v1/graphql/docs", async (c) => invokeLambda(graphqlDocsHandler, c));

// Middleware diagnostics (no API Gateway route; used by test-middleware.sh).
local.get("/v1/test/api-key", async (c) => invokeLambda(testApiKeyHandler, c));
local.post("/v1/test/webhook", async (c) =>
	invokeLambda(testWebhookHandler, c),
);

// Everything else IS the production app — one routing layer, no drift.
local.route("/", app);

serve({ fetch: local.fetch, port: PORT }, () => {
	console.log(`\n🚀 Local API server running on http://localhost:${PORT}`);
	console.log(
		`📊 REST API docs: http://localhost:${PORT}/docs (run 'pnpm docs:serve' separately)`,
	);
	console.log(`🔵 GraphQL API: http://localhost:${PORT}/v1/graphql`);
	console.log(`📘 GraphQL docs: http://localhost:${PORT}/v1/graphql/docs`);
});
