import type { MiddlewareHandler } from "hono";
import type { JWTVerifyGetKey } from "jose";
import {
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
import { ApiError } from "../errors";
import type { AppEnv, AuthClaims } from "./types";

/**
 * Auth middleware for the shared Hono app.
 *
 * The bearer token is verified directly with the SHARED verifier
 * (`authorizers/verify-token.ts`) — the single source of auth trust, exactly
 * the validation contract the old API Gateway Lambda authorizer enforced
 * (RS256 + issuer + sub + client_id binding). There is no other claims path:
 * the Worker IS the edge, so no upstream authorizer context exists.
 *
 * Resulting claims are stringified like the old authorizer context, so
 * handlers see one claim shape everywhere (`AuthClaims` in ./types).
 */

/**
 * Byte-compatible with the legacy withAuth 401 body, which says
 * `error: "Unauthorized"` (Errors.Unauthorized() says "Authentication
 * required" — clients already depend on the former).
 */
const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Unauthorized");

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
	// Fail CLOSED in deployed environments: an empty client id disables the
	// `client_id` audience binding (intended only for local dev), which would
	// accept any WorkOS-signed token. Never run unbound in staging/production.
	const stage = process.env.STAGE;
	if (!clientId && (stage === "production" || stage === "staging")) {
		throw new Error(
			"WORKOS_CLIENT_ID is required in deployed environments (audience binding must not be disabled)",
		);
	}
	if (!jwksCache || jwksCache.clientId !== clientId) {
		jwksCache = { clientId, jwks: createWorkosJwks(clientId) };
	}

	let claims: WorkosTokenClaims;
	try {
		claims = await verifyWorkosToken(token, jwksCache.jwks, { clientId });
	} catch {
		throw unauthorized();
	}
	return toAuthorizerContext(claims);
}

/**
 * Mirror the string-only context the old deployed Lambda authorizer built,
 * including `urn:*` custom-claim forwarding, so the claim shape handlers see
 * is unchanged by the platform move.
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
				reason: "invalid_token",
				path: c.req.path,
				method: c.req.method,
			},
		});
		throw error;
	}

	await next();
};
