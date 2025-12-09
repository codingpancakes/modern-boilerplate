import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { eq } from "drizzle-orm";
import { authIdentities } from "../db/schema/index";
import { getDb } from "./db";
import { Errors } from "./errors";

export type Claims = {
	sub: string;
	email?: string;
	org_id?: string;
	iss: string;
	aud?: string;
	exp: number;
	iat: number;
	[k: string]: unknown;
};

export function getClaims(evt: APIGatewayProxyEventV2): Claims {
	const rc = (evt.requestContext as any) || {};
	const authz = rc.authorizer || {};
	const jwtClaims = authz.jwt?.claims;
	const lambdaCtx = authz.lambda; // HTTP API SIMPLE Lambda authorizer context
	const claims = jwtClaims || lambdaCtx;
	if (!claims?.sub) {
		throw Errors.Unauthorized();
	}
	return claims as Claims;
}

export function getUserId(evt: APIGatewayProxyEventV2): string {
	const claims = getClaims(evt);
	return claims.sub;
}

export function getOrgId(evt: APIGatewayProxyEventV2): string | undefined {
	const claims = getClaims(evt);
	return claims.org_id;
}

/**
 * Get the internal user ID from JWT claims by looking up authIdentities
 *
 * IMPORTANT: claims.sub is the WorkOS provider subject, NOT the internal user ID.
 * This function queries the authIdentities table to get the actual users.id.
 *
 * @param evt - API Gateway event with JWT claims
 * @returns Internal user ID from users table
 * @throws Unauthorized if user not found in authIdentities
 *
 * @example
 * const userId = await getUserIdFromClaims(event);
 * // userId is now the internal UUID from users.id
 */
export async function getUserIdFromClaims(
	evt: APIGatewayProxyEventV2,
): Promise<string> {
	const claims = getClaims(evt);
	const providerSubject = claims.sub;

	const db = await getDb();

	// Look up internal user ID from provider subject
	const authResult = await db
		.select({ userId: authIdentities.userId })
		.from(authIdentities)
		.where(eq(authIdentities.providerSubject, providerSubject))
		.limit(1);

	if (!authResult || authResult.length === 0 || !authResult[0].userId) {
		throw Errors.Unauthorized();
	}

	return authResult[0].userId;
}
