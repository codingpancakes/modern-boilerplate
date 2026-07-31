import { and, eq } from "drizzle-orm";
import { authIdentities, users } from "../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "./audit";
import { getDb } from "./db";
import { isUniqueConstraintViolation } from "./error-utils";
import { Errors } from "./errors";
import { createUserWithIdentity } from "./services/user-provisioning";
import { RECORD_STATUS } from "./status";

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

/** A verified claims object (e.g. `AuthClaims` set by `requireAuth()`). */
export type ClaimsLike = { sub: string; [claim: string]: unknown };

export type ClaimsSource = ClaimsLike;

/**
 * Normalize a verified claims object into the canonical `Claims` shape
 * (numeric exp/iat, string iss). Claims must come from `requireAuth()`
 * (single source of auth trust) — never re-parse a token here
 * (invariant #10).
 */
export function getClaims(source: ClaimsSource): Claims {
	const claims: Record<string, unknown> = source;

	if (!claims?.sub || typeof claims.sub !== "string") {
		throw Errors.Unauthorized();
	}
	return {
		...claims,
		sub: claims.sub,
		iss: typeof claims.iss === "string" ? claims.iss : "",
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
	source: ClaimsSource,
): Promise<string> {
	const claims = getClaims(source);
	const providerSubject = claims.sub;

	const db = await getDb();

	const lookup = () =>
		db
			.select({ userId: authIdentities.userId, userStatus: users.status })
			.from(authIdentities)
			.leftJoin(users, eq(users.id, authIdentities.userId))
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, providerSubject),
				),
			)
			.limit(1);

	const authResult = await lookup();
	if (authResult[0]?.userId) {
		if (authResult[0].userStatus === RECORD_STATUS.DELETED) {
			throw Errors.Unauthorized();
		}
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
		if (isUniqueConstraintViolation(err)) {
			const retry = await lookup();
			if (retry[0]?.userId) {
				return retry[0].userId;
			}
			// The collision is on EMAIL, owned by a different provider subject —
			// the retry-by-subject can never find a row. Without a terminal
			// client error here, this subject would 500 on every request forever.
			throw Errors.Conflict(
				"An account with this email already exists for a different login identity",
			);
		}

		// Real DB errors should surface as 500, not masquerade as 401
		throw err;
	}
}
