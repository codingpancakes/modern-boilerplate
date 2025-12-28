import { ApolloServer } from "@apollo/server";
import {
	handlers,
	startServerAndCreateLambdaHandler,
} from "@as-integrations/aws-lambda";
import type { GraphQLContext } from "./context";
import { createContext } from "./context";
import { mediaResolvers } from "./resolvers/media";
import { userResolvers } from "./resolvers/users";
import { typeDefs } from "./schema";

// Merge all resolvers
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

// Create Apollo Server
const server = new ApolloServer<GraphQLContext>({
	typeDefs,
	resolvers,
	introspection: process.env.STAGE !== "production",
	formatError: (error) => {
		console.error("GraphQL Error:", error);
		return {
			message: error.message,
			extensions: {
				code: error.extensions?.code || "INTERNAL_SERVER_ERROR",
			},
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
