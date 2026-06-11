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
 * On Lambda, claims come ONLY from the API Gateway Lambda authorizer
 * (`event.requestContext.authorizer.lambda`) — the same invariant as
 * `authorizers/workos-jwt.ts` + `lib/middleware.ts` withAuth: no JWT
 * re-parsing fallback in deployed environments.
 *
 * In local dev (`@hono/node-server`, no API Gateway in the loop) there is no
 * authorizer context, so the bearer token is verified directly with the
 * SHARED verifier (`authorizers/verify-token.ts`) and the resulting claims
 * are stringified exactly like the deployed authorizer's context, so handlers
 * see one claim shape everywhere.
 */

const CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";

/**
 * Byte-compatible with the legacy withAuth 401 body, which says
 * `error: "Unauthorized"` (Errors.Unauthorized() says "Authentication
 * required" — clients already depend on the former).
 */
const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Unauthorized");

// HTTP API simple authorizers return all context values as strings, so
// exp/iat arrive as e.g. "1711385600" or "" — accept both types (same check
// as lib/middleware.ts).
const isNumericish = (v: unknown): boolean =>
	v === undefined ||
	v === "" ||
	typeof v === "number" ||
	(typeof v === "string" && /^\d+$/.test(v));

function getRecord(
	value: unknown,
	key: string,
): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const inner = (value as Record<string, unknown>)[key];
	if (typeof inner !== "object" || inner === null) return undefined;
	return inner as Record<string, unknown>;
}

let jwks: JWTVerifyGetKey | undefined;

async function verifyLocalToken(
	authHeader: string | undefined,
): Promise<AuthClaims> {
	const token = authHeader?.startsWith("Bearer ")
		? authHeader.slice("Bearer ".length).trim()
		: "";
	if (!token) throw unauthorized();

	jwks ??= createWorkosJwks(CLIENT_ID);
	let claims: WorkosTokenClaims;
	try {
		claims = await verifyWorkosToken(token, jwks, { clientId: CLIENT_ID });
	} catch {
		throw unauthorized();
	}
	return toAuthorizerContext(claims);
}

/**
 * Mirror the string-only context the deployed authorizer builds
 * (`authorizers/workos-jwt.ts`), including `urn:*` custom-claim forwarding.
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
 * throws a 401 ApiError otherwise. Applied per-domain in `routes/index.ts`
 * (the Hono equivalent of attaching the API Gateway authorizer to a route).
 */
export const requireAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
	const event = c.env?.event;

	if (event) {
		const requestContext = getRecord(event, "requestContext");
		const lambdaCtx = getRecord(
			getRecord(requestContext, "authorizer"),
			"lambda",
		);

		const claimsValid =
			lambdaCtx !== undefined &&
			typeof lambdaCtx.sub === "string" &&
			lambdaCtx.sub.length > 0 &&
			isNumericish(lambdaCtx.exp) &&
			isNumericish(lambdaCtx.iat);

		if (!lambdaCtx || !claimsValid) {
			const http = getRecord(requestContext, "http");
			// Fire-and-forget — never block the 401 response (drained by the
			// auditFlush middleware before the runtime can freeze).
			void logAudit({
				action: AUDIT_ACTIONS.ACCESS_DENIED,
				resourceType: AUDIT_RESOURCE_TYPES.USER,
				status: AUDIT_STATUS.FAILURE,
				ipAddress:
					typeof http?.sourceIp === "string" ? http.sourceIp : undefined,
				userAgent: c.req.header("user-agent"),
				requestId:
					typeof requestContext?.requestId === "string"
						? requestContext.requestId
						: c.get("requestId"),
				metadata: {
					reason: "missing_claims",
					path: c.req.path,
					method: c.req.method,
				},
			});
			throw unauthorized();
		}

		c.set("claims", lambdaCtx as AuthClaims);
	} else {
		// Local dev only — there is no API Gateway event at all. On Lambda the
		// branch above always runs, so this can never bypass the authorizer.
		c.set("claims", await verifyLocalToken(c.req.header("authorization")));
	}

	await next();
};
