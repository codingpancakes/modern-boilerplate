import type { APIGatewayRequestAuthorizerEvent } from "aws-lambda";
import {
	createRemoteJWKSet,
	errors,
	type JWTVerifyResult,
	jwtVerify,
} from "jose";

const CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";
const AUTH_ISSUER = process.env.AUTH_ISSUER ?? "https://api.workos.com/";
// WorkOS JWKS for your client - make it more defensive
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;
try {
	JWKS = createRemoteJWKSet(
		new URL(`https://api.workos.com/sso/jwks/${CLIENT_ID}`),
		{
			// Reduce blast radius on DDoS/JWKS abuse & network quirks
			cooldownDuration: 60_000, // 60s min interval between fetches
			timeoutDuration: 2_000, // 2s network timeout
		},
	);
} catch (jwksError) {
	console.error("Failed to create JWKS:", jwksError);
}

// HTTP API Lambda Authorizer (Simple response)
type SimpleAuthorizerResult = {
	isAuthorized: boolean;
	context?: Record<string, string>;
};

export const handler = async (
	event: APIGatewayRequestAuthorizerEvent,
): Promise<SimpleAuthorizerResult> => {
	try {
		const auth =
			event.headers?.authorization ?? event.headers?.Authorization ?? "";

		const token = auth.startsWith("Bearer ")
			? auth.slice("Bearer ".length).trim()
			: "";

		if (!token) {
			console.log("No token, rejecting");
			return { isAuthorized: false };
		}

		if (!JWKS) {
			console.error("JWKS not initialized, rejecting");
			return { isAuthorized: false };
		}

		try {
			// Add timeout to prevent hanging promises
			let timer: ReturnType<typeof setTimeout> | undefined;
			const verifyPromise = jwtVerify(token, JWKS, {
				issuer: [
					AUTH_ISSUER,
					`https://api.workos.com/user_management/${CLIENT_ID}`,
				],
				algorithms: ["RS256"],
				clockTolerance: 60,
			});

			const timeoutPromise = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("JWT verification timeout")),
					5000,
				);
			});

			let payload: JWTVerifyResult["payload"];
			try {
				const result = (await Promise.race([
					verifyPromise,
					timeoutPromise,
				])) as JWTVerifyResult;
				payload = result.payload;
			} finally {
				clearTimeout(timer);
			}

			// Reject tokens without a subject claim
			if (!payload.sub) {
				console.error("JWT missing sub claim, rejecting");
				return { isAuthorized: false };
			}

			// Construct a string-only context object for HTTP API simple authorizers
			const payloadData = payload as Record<string, unknown>;
			const ctx: Record<string, string> = {
				sub: String(payload.sub),
				sid: String(payloadData.sid ?? ""),
				iss: String(payload.iss ?? ""),
				email: String(payloadData.email ?? ""),
				org_id: String(payloadData.org_id ?? ""),
				role: String(payloadData.role ?? ""),
				permissions: JSON.stringify(payloadData.permissions ?? []),
				exp: payload.exp ? String(payload.exp) : "",
				iat: payload.iat ? String(payload.iat) : "",
			};

			// Forward custom claims (urn:* namespace) so handlers can access them via customClaim()
			for (const [key, val] of Object.entries(payloadData)) {
				if (key.startsWith("urn:") && val !== undefined) {
					ctx[key] = typeof val === "string" ? val : JSON.stringify(val);
				}
			}

			return { isAuthorized: true, context: ctx };
		} catch (err) {
			// Classify for observability
			const reason =
				err instanceof errors.JWTExpired ? "token_expired" : "invalid_token";
			console.error("JWT verification failed:", {
				reason,
				error: (err as Error).message,
			});
			return { isAuthorized: false };
		}
	} catch (globalErr) {
		console.error("Authorizer error:", (globalErr as Error).message);
		return { isAuthorized: false };
	}
};
