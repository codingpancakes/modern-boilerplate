import { ApolloServer } from "@apollo/server";
import {
	handlers,
	startServerAndCreateLambdaHandler,
} from "@as-integrations/aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
	Context,
} from "aws-lambda";
import depthLimit from "graphql-depth-limit";
import { flushAudits } from "../../lib/audit";
import {
	getCorsHeaders,
	handleOptionsRequest,
	securityHeaders,
} from "../../lib/cors";
import * as Sentry from "../../lib/sentry";
import type { GraphQLContext } from "./context";
import { createContext } from "./context";
import {
	complexityPlugin,
	mutationLimitPlugin,
	requestLoggingPlugin,
	sentryPlugin,
} from "./plugins";
import { resolvers } from "./resolvers/merge";
import { typeDefs } from "./schema";

const logger = new Logger({ serviceName: "graphql" });

const isDevelopment = process.env.STAGE === "development";

const server = new ApolloServer<GraphQLContext>({
	typeDefs,
	resolvers,
	introspection: isDevelopment,
	validationRules: [depthLimit(10)],
	plugins: [
		sentryPlugin,
		requestLoggingPlugin,
		complexityPlugin,
		mutationLimitPlugin,
	],
	formatError: (error) => {
		logger.error("GraphQL Error", {
			message: error.message,
			code: error.extensions?.code,
		});

		const code = error.extensions?.code || "INTERNAL_SERVER_ERROR";

		// In production, only pass through messages for known client-facing error codes
		const SAFE_CODES = new Set([
			"BAD_USER_INPUT",
			"GRAPHQL_VALIDATION_FAILED",
			"GRAPHQL_PARSE_FAILED",
			"FORBIDDEN",
			"UNAUTHENTICATED",
			"NOT_FOUND",
			"CONFLICT",
		]);

		const message =
			isDevelopment || SAFE_CODES.has(code as string)
				? error.message
				: "Internal server error";

		return {
			message,
			extensions: { code },
		};
	},
});

const apolloHandler = startServerAndCreateLambdaHandler(
	server,
	handlers.createAPIGatewayProxyEventV2RequestHandler(),
	{
		context: async ({ event }) => {
			return createContext({ event });
		},
	},
);

// Wrap Apollo's Lambda handler to inject security + CORS headers that the
// REST middleware (withAuth / withPublicCors) adds automatically but Apollo's
// integration layer does not.
export const handler = async (
	event: APIGatewayProxyEventV2,
	context: Context,
) => {
	const origin = event.headers?.origin || event.headers?.Origin;

	if (event.requestContext.http.method === "OPTIONS") {
		return handleOptionsRequest(
			origin,
			event.headers as Record<string, string>,
		);
	}

	Sentry.setRequestContext(event);
	logger.appendKeys({ requestId: event.requestContext.requestId });

	try {
		const result = (await apolloHandler(
			event,
			context,
			// Required by @as-integrations/aws-lambda handler signature
			() => {},
		)) as APIGatewayProxyStructuredResultV2;

		return {
			...result,
			headers: securityHeaders({
				...((result?.headers ?? {}) as Record<string, string>),
				...getCorsHeaders(origin),
			}),
		};
	} finally {
		// Resolver audits are fire-and-forget (`void logAudit(...)`); drain them
		// before returning so Lambda can't freeze with an audit write in flight.
		await flushAudits();
	}
};
