import type { MiddlewareHandler } from "hono";
import type { JWTVerifyGetKey } from "jose";
import {
	AuthVerificationUnavailableError,
	createWorkosJwks,
	verifyWorkosToken,
	type WorkosTokenClaims,
} from "../../authorizers/verify-token";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "../audit";
import { errorMessage } from "../error-utils";
import { ApiError } from "../errors";
import { createLogger } from "../logger";
import { isLocalDevelopmentStage } from "../stage";
import type { AppEnv, AuthClaims } from "./types";

/**
 * Auth middleware for the shared Hono app.
 *
 * The bearer token is verified directly with the SHARED verifier
 * (`authorizers/verify-token.ts`) — the single source of auth trust
 * (RS256 + issuer + sub + client_id binding). There is no other claims path:
 * the Worker IS the edge, so no upstream authorizer context exists.
 *
 * Resulting claims use the normalized string contract described by
 * `AuthClaims` in `./types`.
 */

/**
 * Stable authentication failure body. Clients depend on the
 * `error: "Unauthorized"` message.
 */
const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Unauthorized");

const logger = createLogger({ serviceName: "auth-middleware" });

/**
 * JWKS key sets are cached per client id. Safe to share across requests on
 * Workers: jose caches fetched KEYS (plain data / CryptoKey objects), not a
 * live socket — the JWKS HTTP fetch itself happens lazily inside whichever
 * request triggers it.
 */
let jwksCache: { clientId: string; jwks: JWTVerifyGetKey } | undefined;

async function verifyBearerToken(
	authHeader: string | undefined,
): Promise<AuthClaims> {
	const token = authHeader?.startsWith("Bearer ")
		? authHeader.slice("Bearer ".length).trim()
		: "";
	if (!token) throw unauthorized();

	// Read per request, not at module init: on Workers, env vars/secrets are
	// populated per invocation by nodejs_compat.
	const clientId = process.env.WORKOS_CLIENT_ID || "";
	// Fail CLOSED unless the stage is explicitly local/development: an empty
	// client id disables the `client_id` audience binding, which would accept any
	// WorkOS-signed token. A missing/typoed STAGE must not silently run unbound.
	const stage = process.env.STAGE;
	if (!clientId && !isLocalDevelopmentStage(stage)) {
		throw new Error(
			"WORKOS_CLIENT_ID is required unless STAGE is explicitly local/development (audience binding must not be disabled)",
		);
	}
	if (!jwksCache || jwksCache.clientId !== clientId) {
		jwksCache = { clientId, jwks: createWorkosJwks(clientId) };
	}

	let claims: WorkosTokenClaims;
	try {
		claims = await verifyWorkosToken(token, jwksCache.jwks, { clientId });
	} catch (error) {
		// A JWKS outage is NOT an invalid token. Collapsing it into a 401 would
		// tell every client their session is bad while producing zero operator
		// signal (Sentry drops routine 401s). Surface a 503 — app.onError
		// captures 5xx to Sentry.
		if (error instanceof AuthVerificationUnavailableError) {
			// Drop the cached key set: it can hold a rejected/poisoned in-flight
			// fetch (possibly tied to another request's I/O context on Workers);
			// the next request rebuilds it cleanly.
			jwksCache = undefined;
			logger.error("Token verification unavailable (JWKS/infra failure)", {
				error: errorMessage(error),
				cause: error.cause ? errorMessage(error.cause) : undefined,
			});
			throw new ApiError(
				503,
				"AUTH_UNAVAILABLE",
				"Authentication service temporarily unavailable",
			);
		}
		throw unauthorized();
	}
	return toAuthorizerContext(claims);
}

/**
 * Normalize verified claims to the string-only handler contract, including
 * forwarding custom `urn:*` claims.
 */
function toAuthorizerContext(payload: WorkosTokenClaims): AuthClaims {
	const payloadData: Record<string, unknown> = payload;
	const ctx: AuthClaims = {
		sub: String(payload.sub),
		sid: String(payloadData.sid ?? ""),
		iss: String(payload.iss ?? ""),
		client_id: String(payloadData.client_id ?? ""),
		email: String(payloadData.email ?? ""),
		org_id: String(payloadData.org_id ?? ""),
		role: String(payloadData.role ?? ""),
		permissions: JSON.stringify(payloadData.permissions ?? []),
		exp: payload.exp ? String(payload.exp) : "",
		iat: payload.iat ? String(payload.iat) : "",
	};
	for (const [key, val] of Object.entries(payloadData)) {
		if (key.startsWith("urn:") && val !== undefined) {
			ctx[key] = typeof val === "string" ? val : JSON.stringify(val);
		}
	}
	return ctx;
}

/**
 * Require an authenticated caller; sets `c.get("claims")` on success and
 * throws a 401 ApiError otherwise. Applied per-domain in `routes/index.ts`.
 */
export const requireAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
	try {
		c.set("claims", await verifyBearerToken(c.req.header("authorization")));
	} catch (error) {
		// Fire-and-forget — never block the 401 response (drained by the
		// auditFlush middleware before the request finishes).
		void logAudit({
			action: AUDIT_ACTIONS.ACCESS_DENIED,
			resourceType: AUDIT_RESOURCE_TYPES.USER,
			status: AUDIT_STATUS.FAILURE,
			ipAddress: c.req.header("cf-connecting-ip"),
			userAgent: c.req.header("user-agent"),
			requestId: c.get("requestId"),
			metadata: {
				reason:
					error instanceof ApiError && error.statusCode === 503
						? "auth_unavailable"
						: "invalid_token",
				path: c.req.path,
				method: c.req.method,
			},
		});
		throw error;
	}

	await next();
};
