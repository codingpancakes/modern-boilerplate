import { Logger } from "@aws-lambda-powertools/logger";
import type { Context } from "aws-lambda";
import { eq } from "drizzle-orm";
import { authIdentities, profiles, users } from "../../db/schema";
import { getDb } from "../../lib/db";
import { Errors } from "../../lib/errors";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { buildNestedUpdates } from "../../lib/update-helper";
import { parseBody, schemas } from "../../lib/validation";

const logger = new Logger({ serviceName: "users-update" });

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

const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
	logger.addContext(context);
	const claims = event.claims;
	const providerSubject = claims?.sub;

	// Add persistent context to all logs
	logger.appendKeys({ providerSubject });

	if (!providerSubject) {
		throw Errors.Unauthorized();
	}

	// Validate request body with Zod
	const updateRequest = parseBody(event, schemas.updateUserProfile);

	logger.info("Updating user profile", { updateRequest });

	const db = await getDb();

	// First, get the user ID from auth_identities
	const authResult = await db
		.select({ userId: authIdentities.userId })
		.from(authIdentities)
		.where(eq(authIdentities.providerSubject, providerSubject))
		.limit(1);

	if (!authResult || authResult.length === 0) {
		logger.warn("User not provisioned yet - valid JWT but no database record");
		throw Errors.Unauthorized();
	}

	const userId = authResult[0].userId;

	if (!userId) {
		logger.warn("User ID is null - user not provisioned yet");
		throw Errors.Unauthorized();
	}

	// Build update objects automatically (only includes provided fields + updatedAt)
	const updates = buildNestedUpdates(updateRequest);

	// Update user table if user fields provided
	if (updates.user) {
		await db.update(users).set(updates.user).where(eq(users.id, userId));

		logger.info("User updated", { userId, fields: Object.keys(updates.user) });
	}

	// Update profile table if profile fields provided
	if (updates.profile) {
		await db
			.update(profiles)
			.set(updates.profile)
			.where(eq(profiles.userId, userId));

		logger.info("Profile updated", {
			userId,
			fields: Object.keys(updates.profile),
		});
	}

	// Fetch updated user and profile
	const [updatedUser] = await db
		.select()
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	const [updatedProfile] = await db
		.select()
		.from(profiles)
		.where(eq(profiles.userId, userId))
		.limit(1);

	return createSuccessResponse({
		user: updatedUser,
		profile: updatedProfile,
	});
};

export const handler = withAuth(handlerFn);
