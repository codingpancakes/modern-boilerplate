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
	console.log("🔐 Authorizer started");
	console.log("📋 Event:", JSON.stringify(event, null, 2));

	try {
		const auth =
			event.headers?.authorization ?? event.headers?.Authorization ?? "";

		console.log(
			"🔑 Auth header:",
			auth ? `Bearer ${auth.slice(0, 20)}...` : "missing",
		);

		const token = auth.startsWith("Bearer ")
			? auth.slice("Bearer ".length).trim()
			: "";

		console.log(
			"Extracted token:",
			token ? `${token.slice(0, 20)}...${token.slice(-20)}` : "missing",
		);

		if (!token) {
			console.log("No token found, rejecting");
			return { isAuthorized: false };
		}

		if (!JWKS) {
			console.error("JWKS not initialized, rejecting");
			return { isAuthorized: false };
		}

		try {
			console.log("🔍 Starting JWT verification...");
			console.log("🏢 CLIENT_ID:", CLIENT_ID);
			console.log("🌐 AUTH_ISSUER:", AUTH_ISSUER);

			// Add timeout to prevent hanging promises
			const verifyPromise = jwtVerify(token, JWKS, {
				issuer: [
					AUTH_ISSUER,
					`https://api.workos.com/user_management/${CLIENT_ID}`,
				], // Accept both issuers like local
				algorithms: ["RS256"], // pin the alg
				clockTolerance: 60, // seconds of skew tolerance
			});

			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error("JWT verification timeout")), 5000);
			});

			console.log("⏱️ Starting Promise.race for JWT verification...");
			const { payload } = (await Promise.race([
				verifyPromise,
				timeoutPromise,
			])) as JWTVerifyResult;
			console.log("✅ JWT verification successful");

			// Debug logging
			console.log("JWT payload:", JSON.stringify(payload, null, 2));

			// Construct a string-only context object for HTTP API simple authorizers
			const payloadData = payload as Record<string, unknown>;
			const ctx: Record<string, string> = {
				sub: String(payload.sub ?? ""),
				sid: String(payloadData.sid ?? ""),
				iss: String(payload.iss ?? ""),
				org_id: String(payloadData.org_id ?? ""),
				role: String(payloadData.role ?? ""),
				permissions: JSON.stringify(payloadData.permissions ?? []),
				exp: payload.exp ? String(payload.exp) : "",
				iat: payload.iat ? String(payload.iat) : "",
			};

			console.log("🎉 Authorization successful, returning context");
			return { isAuthorized: true, context: ctx };
		} catch (err) {
			// Classify for observability (these do not change the 401 body)
			const reason =
				err instanceof errors.JWTExpired ? "token_expired" : "invalid_token";
			console.error("❌ JWT verification failed:", {
				reason,
				error: (err as Error).message,
				clientId: CLIENT_ID,
				issuer: AUTH_ISSUER,
			});
			return { isAuthorized: false };
		}
	} catch (globalErr) {
		// Catch any other errors to prevent unsettled promises
		console.error("💥 Authorizer global error:", (globalErr as Error).message);
		console.error("💥 Stack trace:", (globalErr as Error).stack);
		return { isAuthorized: false };
	}
};
