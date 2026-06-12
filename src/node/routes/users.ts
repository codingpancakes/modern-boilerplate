import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { profiles, users as usersTable } from "../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "../lib/audit";
import { getUserIdFromClaims } from "../lib/auth";
import { getDb } from "../lib/db";
import { Errors } from "../lib/errors";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";
import { type StoredResponse, withIdempotency } from "../lib/idempotency";
import { createLogger } from "../lib/logger";
import { createSuccessResponse } from "../lib/response";
import { sanitizeObject } from "../lib/sanitize";
import { buildNestedUpdates } from "../lib/update-helper";
import { parseBody } from "../lib/validation/helpers";
import * as schemas from "../lib/validation/users";

/**
 * /v1/users/* — user profile routes (protected; `requireAuth()` is applied
 * by the barrel in `routes/index.ts`, so `c.get("claims")` is always set).
 *
 *   GET   /me — fetch the caller's user + profile
 *   PATCH /me — idempotent partial update of user/profile
 */
export const users = new Hono<AppEnv>();

const meLogger = createLogger({ serviceName: "users-me" });
const updateLogger = createLogger({ serviceName: "users-update" });

/**
 * Convert a stored/replayed idempotency result into the Response Hono
 * expects. `withIdempotency` both produces (via `createSuccessResponse`) and
 * replays (from the idempotency_keys table) `{ statusCode, headers, body }`
 * objects — the stored shape is part of its replay contract, so it is
 * preserved and adapted here instead of changing what gets persisted.
 * CORS + security headers are applied by the app-level middleware.
 */
function toResponse(result: StoredResponse): Response {
	const headers = new Headers();
	for (const [key, value] of Object.entries(result.headers ?? {})) {
		headers.set(key, value);
	}
	return new Response(result.body ?? null, {
		status: result.statusCode,
		headers,
	});
}

/**
 * @swagger
 * /v1/users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get current user profile
 *     description: Returns the authenticated user's complete profile including user and profile data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                     profile:
 *                       type: object
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
users.get("/me", async (c) => {
	// Get internal user ID from verified claims (lookup + JIT provisioning)
	const userId = await getUserIdFromClaims(c.get("claims"));

	meLogger.info("Getting user profile", { userId });

	const db = await getDb();

	// Fetch user and profile in parallel (independent queries)
	const [userResult, profileResult] = await Promise.all([
		db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1),
		db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
	]);

	if (userResult.length === 0) {
		meLogger.error("User record not found after auth lookup", { userId });
		throw Errors.Unauthorized();
	}

	const user = userResult[0];
	const profile = profileResult[0] || null;

	meLogger.info("User profile retrieved successfully", { userId: user.id });

	return sendSuccess(c, {
		user,
		profile,
	});
});

/**
 * @swagger
 * /v1/users/me:
 *   patch:
 *     tags: [Users]
 *     summary: Update current user profile
 *     description: Updates the authenticated user's profile. Only sends fields that need to be updated.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user:
 *                 type: object
 *                 properties:
 *                   firstName: { type: string }
 *                   lastName: { type: string }
 *                   phone: { type: string }
 *                   defaultTimezone: { type: string }
 *               profile:
 *                 type: object
 *                 properties:
 *                   preferredName: { type: string }
 *                   pronouns: { type: string }
 *                   location: { type: string }
 *                   countryCode: { type: string }
 *                   photoUrl: { type: string }
 *                   gender: { type: string }
 *                   lgbtq: { type: boolean }
 *                   ethnicity: { type: string }
 *                   languages: { type: array, items: { type: string } }
 *                   onboardingCompleted: { type: boolean }
 *     responses:
 *       200:
 *         description: User profile updated successfully
 *       400:
 *         description: Bad request - no fields to update
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
users.patch("/me", async (c) => {
	const claims = c.get("claims");
	const rawBody = await c.req.text();
	const queryParams = c.req.query();

	const result = await withIdempotency(
		{
			key: c.req.header("idempotency-key"),
			sub: claims.sub,
			method: c.req.method,
			path: c.req.path,
			// Hash parity with the Lambda-era events: bodyless requests hashed
			// `undefined` (never ""), and an empty query map hashed `undefined`.
			body: rawBody === "" ? undefined : rawBody,
			query: Object.keys(queryParams).length > 0 ? queryParams : undefined,
		},
		async () => {
			// Get internal user ID from verified claims (lookup + JIT provisioning)
			const userId = await getUserIdFromClaims(claims);

			// Validate request body with Zod
			const updateRequest = parseBody(rawBody, schemas.updateUserProfile);

			updateLogger.info("Updating user profile", {
				userId,
				fieldsProvided: {
					user: updateRequest.user ? Object.keys(updateRequest.user) : [],
					profile: updateRequest.profile
						? Object.keys(updateRequest.profile)
						: [],
				},
			});

			const db = await getDb();

			// Sanitize all string fields (XSS prevention) then build update objects
			const updates = buildNestedUpdates({
				user: updateRequest.user
					? sanitizeObject(updateRequest.user as Record<string, unknown>)
					: undefined,
				profile: updateRequest.profile
					? sanitizeObject(updateRequest.profile as Record<string, unknown>)
					: undefined,
			});

			const { currentUser, currentProfile, updatedUser, updatedProfile } =
				await db.transaction(async (tx) => {
					const [curUserRows, curProfileRows] = await Promise.all([
						tx
							.select()
							.from(usersTable)
							.where(eq(usersTable.id, userId))
							.limit(1),
						tx
							.select()
							.from(profiles)
							.where(eq(profiles.userId, userId))
							.limit(1),
					]);
					const curUser = curUserRows[0];
					const curProfile = curProfileRows[0];

					const newUser = updates.user
						? await tx
								.update(usersTable)
								.set(updates.user)
								.where(eq(usersTable.id, userId))
								.returning()
								.then((rows) => rows[0])
						: curUser;

					const newProfile = updates.profile
						? await tx
								.update(profiles)
								.set(updates.profile)
								.where(eq(profiles.userId, userId))
								.returning()
								.then((rows) => rows[0])
						: curProfile;

					return {
						currentUser: curUser,
						currentProfile: curProfile,
						updatedUser: newUser,
						updatedProfile: newProfile,
					};
				});

			if (!updatedUser) {
				throw Errors.NotFound("User");
			}

			const updatedUserFields = updates.user ? Object.keys(updates.user) : [];
			const updatedProfileFields = updates.profile
				? Object.keys(updates.profile)
				: [];

			void logAudit({
				userId,
				action: AUDIT_ACTIONS.UPDATE,
				resourceType:
					updatedUserFields.length > 0
						? AUDIT_RESOURCE_TYPES.USER
						: AUDIT_RESOURCE_TYPES.PROFILE,
				resourceId: userId,
				changes: {
					before: { user: currentUser, profile: currentProfile },
					after: { user: updatedUser, profile: updatedProfile },
				},
				ipAddress: c.req.header("cf-connecting-ip"),
				userAgent: c.req.header("user-agent"),
				requestId: c.get("requestId"),
				status: AUDIT_STATUS.SUCCESS,
				metadata: {
					updatedFields: {
						user: updatedUserFields,
						profile: updatedProfileFields,
					},
				},
			});

			return createSuccessResponse({
				user: updatedUser,
				profile: updatedProfile,
			});
		},
	);

	return toResponse(result);
});
