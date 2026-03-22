import type { ApolloServerPlugin } from "@apollo/server";
import { ApolloServer } from "@apollo/server";
import {
	handlers,
	startServerAndCreateLambdaHandler,
} from "@as-integrations/aws-lambda";
import depthLimit from "graphql-depth-limit";
import { captureException, flush as flushSentry } from "../../lib/sentry";
import type { GraphQLContext } from "./context";
import { createContext } from "./context";
import { mediaResolvers } from "./resolvers/media";
import { organizationResolvers } from "./resolvers/organizations";
import { userResolvers } from "./resolvers/users";
import { typeDefs } from "./schema";

const resolvers = {
	Query: {
		...userResolvers.Query,
		...mediaResolvers.Query,
		...organizationResolvers.Query,
	},
	Mutation: {
		...userResolvers.Mutation,
		...mediaResolvers.Mutation,
		...organizationResolvers.Mutation,
	},
	User: userResolvers.User,
	Profile: userResolvers.Profile,
	OrganizationMembership: userResolvers.OrganizationMembership,
	Organization: userResolvers.Organization,
};

const CLIENT_ERROR_CODES = new Set([
	"GRAPHQL_VALIDATION_FAILED",
	"BAD_USER_INPUT",
	"GRAPHQL_PARSE_FAILED",
	"PERSISTED_QUERY_NOT_FOUND",
	"FORBIDDEN",
	"UNAUTHENTICATED",
]);

const sentryPlugin: ApolloServerPlugin<GraphQLContext> = {
	async requestDidStart() {
		return {
			async didEncounterErrors(requestContext) {
				for (const error of requestContext.errors) {
					if (CLIENT_ERROR_CODES.has(error.extensions?.code as string)) {
						continue;
					}
					const originalError =
						error.originalError instanceof Error ? error.originalError : error;
					captureException(originalError, {
						graphqlPath: error.path,
						graphqlQuery: requestContext.request.query,
					});
				}
			},
			async willSendResponse() {
				await flushSentry();
			},
		};
	},
};

const isProduction = process.env.STAGE === "production";

const server = new ApolloServer<GraphQLContext>({
	typeDefs,
	resolvers,
	introspection: !isProduction,
	validationRules: [depthLimit(10)],
	plugins: [sentryPlugin],
	formatError: (error) => {
		console.error("GraphQL Error:", error);

		const code = error.extensions?.code || "INTERNAL_SERVER_ERROR";
		const message =
			isProduction && code === "INTERNAL_SERVER_ERROR"
				? "Internal server error"
				: error.message;

		return {
			message,
			extensions: { code },
		};
	},
});

// Export Lambda handler following official Apollo Server docs
export const handler = startServerAndCreateLambdaHandler(
	server,
	handlers.createAPIGatewayProxyEventV2RequestHandler(),
	{
		context: async ({ event }) => {
			return createContext({ event });
		},
	},
);
