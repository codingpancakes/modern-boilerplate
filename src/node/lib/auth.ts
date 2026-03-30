import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { authIdentities } from "../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "./audit";
import { getDb } from "./db";
import { errorMessage } from "./error-utils";
import { Errors } from "./errors";
import { createUserWithIdentity } from "./services/user-provisioning";

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
		const newUserId = await createUserWithIdentity(db, {
			providerSubject,
			email: claims.email || null,
		});

		void logAudit({
			userId: newUserId,
			action: AUDIT_ACTIONS.CREATE,
			resourceType: AUDIT_RESOURCE_TYPES.USER,
			resourceId: newUserId,
			status: AUDIT_STATUS.SUCCESS,
			metadata: { source: "jit_provisioning", providerSubject },
		});

		return newUserId;
	} catch (err) {
		// Unique-constraint violation means a concurrent request already provisioned
		const msg = errorMessage(err);
		const isUniqueViolation =
			msg.includes("unique") ||
			msg.includes("duplicate") ||
			msg.includes("23505");

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
