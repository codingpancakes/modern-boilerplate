import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayRequestAuthorizerEvent } from "aws-lambda";
import { errors, type JWTVerifyGetKey } from "jose";
import { errorMessage } from "../lib/error-utils";
import { verifyOriginHeader } from "../lib/origin-verify";
import { createWorkosJwks, verifyWorkosToken } from "./verify-token";

const logger = new Logger({ serviceName: "workos-authorizer" });

const CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";

const IS_LOCAL =
	process.env.NODE_ENV === "development" || process.env.STAGE === "development";
if (!CLIENT_ID && !IS_LOCAL) {
	throw new Error("WORKOS_CLIENT_ID is required in deployed environments");
}

let JWKS: JWTVerifyGetKey | undefined;
try {
	JWKS = createWorkosJwks(CLIENT_ID);
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
		if (!verifyOriginHeader(event.headers ?? {})) {
			logger.warn("Rejected request — missing or invalid origin verify header");
			return { isAuthorized: false };
		}

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
			// Verification (signature + issuer + sub + client_id binding) lives in
			// the shared verifier so this authorizer and the local dev server can
			// never drift apart.
			const payload = await verifyWorkosToken(token, JWKS, {
				clientId: CLIENT_ID,
			});

			// Construct a string-only context object for HTTP API simple authorizers
			const payloadData = payload as Record<string, unknown>;
			const ctx: Record<string, string> = {
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
