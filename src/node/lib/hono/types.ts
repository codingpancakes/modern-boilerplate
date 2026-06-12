import type { WorkerBindings } from "../../worker";

/**
 * Claims set by `requireAuth()` (lib/hono/auth.ts) after direct WorkOS token
 * verification via the shared verifier (`authorizers/verify-token.ts`).
 *
 * Values are stringified exactly like the old API Gateway authorizer context
 * (HTTP API simple authorizers stringified every value), so numeric claims
 * (exp/iat) may arrive as strings — downstream code (`lib/auth.ts getClaims`)
 * still normalizes with `Number(...)`, keeping one claim shape everywhere.
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
 *
 * Bindings = the Worker bindings declared in wrangler.toml (`c.env.IMAGES`
 * etc. — see `WorkerBindings` in src/node/worker.ts, the single source of
 * truth). String vars/secrets are mirrored onto `process.env` by
 * nodejs_compat, so plain config reads don't go through `c.env`. Under the
 * local Node server (`@hono/node-server`) non-string bindings are absent at
 * runtime — code using them must guard (e.g. `c.env?.IMAGES`).
 */
export type AppEnv = {
	Bindings: WorkerBindings;
	Variables: {
		/** Set for every request by the request-id middleware. */
		requestId: string;
		/** Set ONLY after `requireAuth()` has run; unset on public routes. */
		claims: AuthClaims;
	};
};
