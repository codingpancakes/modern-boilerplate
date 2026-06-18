import { createSchema, createYoga } from "graphql-yoga";
import { type Context, Hono } from "hono";
import {
	createContext,
	type GraphQLContext,
} from "../handlers/graphql/context";
import {
	complexityPlugin,
	errorFormattingPlugin,
	isDevelopmentStage,
	mutationLimitPlugin,
	parseErrorPlugin,
	requestLoggingPlugin,
	sentryPlugin,
	validationLimitsPlugin,
} from "../handlers/graphql/plugins";
import { resolvers } from "../handlers/graphql/resolvers/merge";
import { typeDefs } from "../handlers/graphql/schema";
import type { AppEnv } from "../lib/hono/types";

/**
 * GraphQL on the shared Hono app — GraphQL Yoga (Workers-native), replacing
 * the old Apollo-on-Lambda harness.
 *
 * Mounted at `/v1/graphql` behind `requireAuth()` by the route barrel
 * (`routes/index.ts`) — auth lives at the barrel, never re-applied here. The
 * schema, resolvers, DataLoaders, and the depth/complexity/mutation limits
 * port unchanged; CORS + security headers and audit draining come from the
 * app-level middleware (`app.ts`), exactly like every REST route.
 *
 * Wire compatibility with the Apollo handler:
 *   - errors serialize as { message, extensions: { code } } and non-safe
 *     codes are masked outside dev (see plugins.ts errorFormattingPlugin)
 *   - introspection and GraphiQL (GET) exist only outside production/staging
 */

const DEFAULT_GRAPHIQL_QUERY = `# Welcome to GraphQL API Documentation
#
# Keyboard shortcuts:
#  - Ctrl/Cmd + Enter: Execute query
#  - Ctrl/Cmd + Space: Auto-complete
#
# Requests need a WorkOS JWT in the Authorization header
# (set it in the "Headers" tab below):
#   { "Authorization": "Bearer YOUR_JWT_TOKEN" }

# Example: Get your user profile
query Me {
	me {
		id
		email
		firstName
		lastName
		profile {
			preferredName
			photoUrl
			onboardingCompleted
		}
		organizations {
			role
			organization {
				id
				name
				slug
			}
		}
	}
}
`;

/** Hono request context, forwarded to Yoga as its server context. */
type GraphQLServerContext = {
	honoContext: Context<AppEnv>;
};

const yoga = createYoga<GraphQLServerContext, GraphQLContext>({
	schema: createSchema<GraphQLServerContext & GraphQLContext>({
		typeDefs,
		resolvers,
	}),
	// Yoga only answers requests whose path matches this (Hono mounts this
	// sub-app at /v1/graphql, so the raw request path is always exactly this).
	graphqlEndpoint: "/v1/graphql",
	context: ({ honoContext }) => createContext(honoContext),
	// Apollo-parity error shaping/masking lives in errorFormattingPlugin;
	// Yoga's own masking would double-wrap and change the wire shape.
	maskedErrors: false,
	// CORS, security headers, and OPTIONS preflight are handled by the shared
	// app middleware (lib/hono/middleware.ts) — same as every REST route.
	cors: false,
	landingPage: false,
	// The Apollo endpoint never accepted multipart (file-upload) requests.
	multipart: false,
	// Responses are fully BUFFERED: incremental delivery (@defer/@stream) is an
	// opt-in plugin (@graphql-yoga/plugin-defer-stream) that is deliberately NOT
	// installed, and there are no subscriptions. This matters because the
	// request's DB pool is drained when the response Promise resolves (dbScope
	// middleware) — a streamed body would have resolvers touching a closed pool.
	// If you ever add defer/stream, move the pool drain to ctx.waitUntil first.
	logging: false,
	// GraphiQL on GET only outside production/staging (the old /graphql/docs
	// behavior); stage is checked per request, not at module init.
	graphiql: () =>
		isDevelopmentStage() && {
			title: "GraphQL API Documentation",
			defaultQuery: DEFAULT_GRAPHIQL_QUERY,
		},
	plugins: [
		sentryPlugin,
		requestLoggingPlugin,
		complexityPlugin,
		mutationLimitPlugin,
		validationLimitsPlugin,
		parseErrorPlugin,
		errorFormattingPlugin,
	],
});

export const graphql = new Hono<AppEnv>();

graphql.on(["GET", "POST"], "/", (c) =>
	yoga.fetch(c.req.raw, { honoContext: c }),
);
