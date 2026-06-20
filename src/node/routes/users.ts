import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { profiles, users as usersTable } from "../db/schema/index";
import { getUserIdFromClaims } from "../lib/auth";
import { getDb } from "../lib/db";
import { Errors } from "../lib/errors";
import { withIdempotentJson } from "../lib/hono/idempotent-response";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv } from "../lib/hono/types";
import { createLogger } from "../lib/logger";
import { updateMyAccount } from "../lib/services/user-account";
import { parseJsonBody } from "../lib/validation/helpers";

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

	return withIdempotentJson(
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

			const updateRequest = parseJsonBody(rawBody);

			updateLogger.info("Updating user profile", {
				userId,
				fieldsProvided: {
					user:
						typeof updateRequest === "object" &&
						updateRequest !== null &&
						"user" in updateRequest &&
						typeof updateRequest.user === "object" &&
						updateRequest.user !== null
							? Object.keys(updateRequest.user)
							: [],
					profile:
						typeof updateRequest === "object" &&
						updateRequest !== null &&
						"profile" in updateRequest &&
						typeof updateRequest.profile === "object" &&
						updateRequest.profile !== null
							? Object.keys(updateRequest.profile)
							: [],
				},
			});

			const db = await getDb();

			const result = await updateMyAccount({
				db,
				userId,
				input: updateRequest,
				source: "rest",
				auditContext: {
					ipAddress: c.req.header("cf-connecting-ip"),
					userAgent: c.req.header("user-agent"),
					requestId: c.get("requestId"),
				},
			});

			return result;
		},
	);
});
