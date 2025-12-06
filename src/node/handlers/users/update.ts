import { Logger } from "@aws-lambda-powertools/logger";
import type { Context } from "aws-lambda";
import { eq } from "drizzle-orm";
import { profiles, users } from "../../db/schema";
import { getUserIdFromClaims } from "../../lib/auth";
import { getDb } from "../../lib/db";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { buildNestedUpdates } from "../../lib/update-helper";
import { parseBody } from "../../lib/validation/helpers";
import * as schemas from "../../lib/validation/users";

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

	// Get internal user ID from JWT claims
	const userId = await getUserIdFromClaims(event);

	// Add persistent context to all logs
	logger.appendKeys({ userId });

	// Validate request body with Zod
	const updateRequest = parseBody(event, schemas.updateUserProfile);

	logger.info("Updating user profile", { updateRequest });

	const db = await getDb();

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
