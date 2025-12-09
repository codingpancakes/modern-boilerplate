import { ApolloServer, BaseContext } from "@apollo/server";
import { startServerAndCreateLambdaHandler } from "@as-integrations/aws-lambda";
import type { GraphQLContext } from "./context";
import { createContext } from "./context";
import { mediaResolvers } from "./resolvers/media";
import { userResolvers } from "./resolvers/users";
import { typeDefs } from "./schema"; // Now loads from schema/index.ts

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
	introspection: process.env.STAGE !== "production", // Enable GraphQL Playground in dev/staging
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

// Export Lambda handler
// Type assertion needed due to Apollo Server v4 + Lambda integration typing mismatch
export const handler: any = startServerAndCreateLambdaHandler(
	server as unknown as ApolloServer<BaseContext>,
	{
		context: createContext,
	} as any,
);
