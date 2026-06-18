import {
	createRemoteJWKSet,
	type JWTPayload,
	type JWTVerifyGetKey,
	jwtVerify,
} from "jose";

/**
 * Shared WorkOS access-token verification.
 *
 * This is the SINGLE source of truth for how a WorkOS token is validated —
 * `requireAuth()` (lib/hono/auth.ts) is its only consumer, and the same code
 * runs locally (`wrangler dev --local`) and deployed. One implementation
 * prevents the local/deploy divergence that previously let an auth
 * regression ship undetected.
 */

export type WorkosTokenClaims = JWTPayload & {
	client_id?: string;
	sid?: string;
	email?: string;
	org_id?: string;
	role?: string;
	permissions?: unknown;
};

const DEFAULT_AUTH_ISSUER =
	process.env.AUTH_ISSUER ?? "https://api.workos.com/";

/** Build the remote JWKS key set for a WorkOS client. */
export function createWorkosJwks(clientId: string): JWTVerifyGetKey {
	return createRemoteJWKSet(
		new URL(`https://api.workos.com/sso/jwks/${clientId}`),
		{
			// Min interval between key-set refetches (e.g. on unknown `kid`).
			cooldownDuration: 60_000,
			// Network timeout for the JWKS fetch. Kept generous because a COLD
			// START must fetch keys over DNS+TLS+WorkOS latency on the first
			// request; a too-tight timeout aborts that fetch and rejects an
			// otherwise valid token. The verifier runs inline in the Worker
			// request, so this only bounds that slow first fetch. Subsequent
			// requests reuse the in-memory cache (no fetch).
			timeoutDuration: 6_000,
		},
	);
}

export interface VerifyWorkosTokenOptions {
	/** WorkOS client id; the token's `client_id` claim must match this. */
	clientId: string;
	/** Accepted issuer (defaults to `AUTH_ISSUER` env / WorkOS). */
	authIssuer?: string;
	/** Hard timeout (ms) guarding against a hung JWKS fetch. */
	timeoutMs?: number;
}

/**
 * Verify a WorkOS access token and return its claims, or throw.
 *
 * Validation contract:
 *  - RS256 signature against the provided key set
 *  - issuer is WorkOS (or the configured `authIssuer`)
 *  - a `sub` claim is present
 *  - the `client_id` claim equals `clientId` (this is the audience equivalent —
 *    WorkOS access tokens do NOT carry an `aud` claim, so we must NOT pass
 *    `audience` to jwtVerify or it rejects every real token)
 *
 * `clientId === ""` disables the client binding (local dev without a configured
 * WORKOS_CLIENT_ID); signature + issuer + sub are still enforced.
 */
export async function verifyWorkosToken(
	token: string,
	key: JWTVerifyGetKey,
	options: VerifyWorkosTokenOptions,
): Promise<WorkosTokenClaims> {
	const {
		clientId,
		authIssuer = DEFAULT_AUTH_ISSUER,
		// Outer guard against a hung verify. Must sit ABOVE the JWKS fetch
		// timeout (6s) so it never cuts off a legitimate cold-start fetch.
		timeoutMs = 10_000,
	} = options;

	const verifyPromise = jwtVerify(token, key, {
		issuer: [authIssuer, `https://api.workos.com/user_management/${clientId}`],
		algorithms: ["RS256"],
		clockTolerance: 60,
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error("JWT verification timeout")),
			timeoutMs,
		);
	});

	let payload: JWTPayload;
	try {
		const result = await Promise.race([verifyPromise, timeoutPromise]);
		payload = result.payload;
	} finally {
		clearTimeout(timer);
	}

	if (!payload.sub) {
		throw new Error('JWT missing required "sub" claim');
	}

	const claims = payload as WorkosTokenClaims;
	if (clientId && claims.client_id !== clientId) {
		throw new Error("JWT client_id mismatch");
	}

	return claims;
}
