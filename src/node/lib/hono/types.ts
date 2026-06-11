import type { LambdaContext, LambdaEvent } from "hono/aws-lambda";

/**
 * Claims forwarded by the WorkOS JWT Lambda authorizer
 * (`authorizers/workos-jwt.ts`). HTTP API simple authorizers stringify every
 * context value, so numeric claims (exp/iat) may arrive as strings — same
 * invariant as `AuthenticatedEvent["claims"]` in `lib/middleware.ts`.
 */
export type AuthClaims = {
	sub: string;
	sid?: string;
	iss?: string;
	client_id?: string;
	email?: string;
	org_id?: string;
	role?: string;
	permissions?: string;
	exp?: number | string;
	iat?: number | string;
	[key: string]: string | number | boolean | undefined;
};

/**
 * Shared Hono environment for the whole app. Every sub-app and middleware
 * must be typed `Hono<AppEnv>` / `MiddlewareHandler<AppEnv>` so context
 * variables stay type-safe across mounts.
 */
export type AppEnv = {
	Bindings: {
		/** Original API Gateway event — present only on Lambda via `hono/aws-lambda`. */
		event?: LambdaEvent;
		/** Lambda invocation context — present only on Lambda via `hono/aws-lambda`. */
		lambdaContext?: LambdaContext;
	};
	Variables: {
		/** Set for every request by the request-id middleware. */
		requestId: string;
		/** Set ONLY after `requireAuth()` has run; unset on public routes. */
		claims: AuthClaims;
	};
};
