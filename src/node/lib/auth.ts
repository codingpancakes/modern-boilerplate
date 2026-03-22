import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { authIdentities, profiles, users } from "../db/schema/index";
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
	// const authHeader = evt.headers?.authorization || evt.headers?.Authorization;
	// console.log("🔐 RAW TOKEN:", authHeader);

	const rc = (evt.requestContext as any) || {};
	const authz = rc.authorizer || {};
	const jwtClaims = authz.jwt?.claims;
	const lambdaCtx = authz.lambda; // HTTP API SIMPLE Lambda authorizer context
	const claims = jwtClaims || lambdaCtx;

	// console.log("PARSED CLAIMS:", JSON.stringify(claims, null, 2));

	if (!claims?.sub) {
		throw Errors.Unauthorized();
	}
	return claims as Claims;
}

/**
 * Get the internal user ID from JWT claims by looking up authIdentities.
 * If no record exists (race condition on first login before webhook fires),
 * provisions the user JIT from JWT claims.
 *
 * IMPORTANT: claims.sub is the WorkOS provider subject, NOT the internal user ID.
 */
export async function getUserIdFromClaims(
	evt: APIGatewayProxyEventV2,
): Promise<string> {
	const claims = getClaims(evt);
	const providerSubject = claims.sub;

	const db = await getDb();

	const lookup = () =>
		db
			.select({ userId: authIdentities.userId })
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, providerSubject),
				),
			)
			.limit(1);

	const authResult = await lookup();
	if (authResult[0]?.userId) {
		return authResult[0].userId;
	}

	// First login race condition: webhook hasn't fired yet — provision JIT
	try {
		const [newUser] = await db
			.insert(users)
			.values({
				email: claims.email || null,
				type: "MEMBER",
			})
			.returning({ id: users.id });

		await db.insert(profiles).values({ userId: newUser.id });

		await db.insert(authIdentities).values({
			userId: newUser.id,
			providerType: "workos",
			providerSubject,
			emailAtProvider: claims.email || null,
		});

		return newUser.id;
	} catch (err) {
		// Unique-constraint violation means a concurrent request already provisioned
		const message = err instanceof Error ? err.message : String(err);
		const isUniqueViolation =
			message.includes("unique") ||
			message.includes("duplicate") ||
			message.includes("23505");

		if (isUniqueViolation) {
			const retry = await lookup();
			if (retry[0]?.userId) {
				return retry[0].userId;
			}
		}

		// Real DB errors should surface as 500, not masquerade as 401
		throw err;
	}
}
