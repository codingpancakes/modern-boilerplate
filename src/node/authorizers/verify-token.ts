import {
	createRemoteJWKSet,
	type JWTPayload,
	type JWTVerifyGetKey,
	errors as joseErrors,
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

function defaultAuthIssuer(): string {
	return process.env.AUTH_ISSUER ?? "https://api.workos.com/";
}

/**
 * Verification failed because the signing keys could not be fetched or read —
 * a JWKS-endpoint outage, DNS/network failure, or timeout. This says NOTHING
 * about the token: callers must surface it as a 5xx (service unavailable),
 * never as a 401, or an auth outage masquerades as "everyone's token is
 * invalid" with zero operator signal.
 */
export class AuthVerificationUnavailableError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "AuthVerificationUnavailableError";
	}
}

/**
 * jose signals JWKS-endpoint problems with these two; anything that is not a
 * JOSEError at all escaped from the fetch layer itself (network/DNS/abort).
 * Every other JOSEError is a verdict on the token and must stay a 401.
 */
function isKeyFetchInfraError(error: unknown): boolean {
	if (error instanceof joseErrors.JWKSTimeout) return true;
	if (error instanceof joseErrors.JWKSInvalid) return true;
	return !(error instanceof joseErrors.JOSEError);
}

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
		authIssuer = defaultAuthIssuer(),
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
			() =>
				reject(
					new AuthVerificationUnavailableError("JWT verification timeout"),
				),
			timeoutMs,
		);
	});

	let payload: JWTPayload;
	try {
		const result = await Promise.race([verifyPromise, timeoutPromise]);
		payload = result.payload;
	} catch (error) {
		if (error instanceof AuthVerificationUnavailableError) throw error;
		if (isKeyFetchInfraError(error)) {
			throw new AuthVerificationUnavailableError(
				"Unable to fetch or read the JWKS signing keys",
				{ cause: error },
			);
		}
		throw error;
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
