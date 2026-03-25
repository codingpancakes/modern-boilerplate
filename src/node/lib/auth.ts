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
	const rc = evt.requestContext as typeof evt.requestContext & {
		authorizer?: {
			jwt?: { claims: Record<string, unknown> };
			lambda?: Record<string, unknown>;
		};
	};
	const authz = rc.authorizer || {};
	const jwtClaims = authz.jwt?.claims;
	const lambdaCtx = authz.lambda;
	const claims = jwtClaims || lambdaCtx;

	if (!claims?.sub || typeof claims.sub !== "string") {
		throw Errors.Unauthorized();
	}
	return {
		...claims,
		sub: claims.sub as string,
		iss: (claims.iss as string) ?? "",
		exp: Number(claims.exp) || 0,
		iat: Number(claims.iat) || 0,
	} as Claims;
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

		try {
			await db.insert(profiles).values({ userId: newUser.id });
			await db.insert(authIdentities).values({
				userId: newUser.id,
				providerType: "workos",
				providerSubject,
				emailAtProvider: claims.email || null,
			});
		} catch (insertErr) {
			// Compensate: remove the orphaned user row before re-throwing
			await db
				.delete(users)
				.where(eq(users.id, newUser.id))
				.catch(() => {});
			throw insertErr;
		}

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
