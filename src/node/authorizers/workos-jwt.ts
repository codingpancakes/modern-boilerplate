import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayRequestAuthorizerEvent } from "aws-lambda";
import {
	createRemoteJWKSet,
	errors,
	type JWTVerifyResult,
	jwtVerify,
} from "jose";
import { errorMessage } from "../lib/error-utils";

const logger = new Logger({ serviceName: "workos-authorizer" });

const CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";
const AUTH_ISSUER = process.env.AUTH_ISSUER ?? "https://api.workos.com/";

const IS_LOCAL =
	process.env.NODE_ENV === "development" || process.env.STAGE === "development";
if (!CLIENT_ID && !IS_LOCAL) {
	throw new Error("WORKOS_CLIENT_ID is required in deployed environments");
}

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
	logger.error("Failed to create JWKS", {
		error: errorMessage(jwksError),
	});
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
			return { isAuthorized: false };
		}

		if (!JWKS) {
			logger.error("JWKS not initialized, rejecting");
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
				audience: CLIENT_ID || undefined,
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
				logger.error("JWT missing sub claim, rejecting");
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
			const reason =
				err instanceof errors.JWTExpired ? "token_expired" : "invalid_token";
			logger.warn("JWT verification failed", {
				reason,
				error: errorMessage(err),
			});
			return { isAuthorized: false };
		}
	} catch (globalErr) {
		logger.error("Authorizer error", {
			error: errorMessage(globalErr),
		});
		return { isAuthorized: false };
	}
};
