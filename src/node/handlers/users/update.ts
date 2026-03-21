import { Logger } from "@aws-lambda-powertools/logger";
import type { Context } from "aws-lambda";
import { eq } from "drizzle-orm";
import { profiles, users } from "../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "../../lib/audit";
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

	// Fetch current snapshots in parallel (for audit "before")
	const [currentResults] = await Promise.all([
		Promise.all([
			db.select().from(users).where(eq(users.id, userId)).limit(1),
			db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
		]),
	]);
	const [currentUserRows, currentProfileRows] = currentResults;
	const currentUser = currentUserRows[0];
	const currentProfile = currentProfileRows[0];

	// Run updates in parallel, using RETURNING to get the "after" state in one round-trip
	const [updatedUser, updatedProfile] = await Promise.all([
		updates.user
			? db
					.update(users)
					.set(updates.user)
					.where(eq(users.id, userId))
					.returning()
					.then((rows) => {
						logger.info("User updated", {
							userId,
							fields: Object.keys(updates.user ?? {}),
						});
						return rows[0];
					})
			: Promise.resolve(currentUser),
		updates.profile
			? db
					.update(profiles)
					.set(updates.profile)
					.where(eq(profiles.userId, userId))
					.returning()
					.then((rows) => {
						logger.info("Profile updated", {
							userId,
							fields: Object.keys(updates.profile ?? {}),
						});
						return rows[0];
					})
			: Promise.resolve(currentProfile),
	]);

	// Fire-and-forget audit log -- don't block the response
	void logAudit({
		userId,
		action: AUDIT_ACTIONS.UPDATE,
		resourceType: AUDIT_RESOURCE_TYPES.PROFILE,
		resourceId: userId,
		changes: {
			before: { user: currentUser, profile: currentProfile },
			after: { user: updatedUser, profile: updatedProfile },
		},
		ipAddress: event.requestContext?.http?.sourceIp,
		userAgent: event.headers?.["user-agent"],
		requestId: event.requestContext?.requestId,
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			updatedFields: {
				user: updates.user ? Object.keys(updates.user) : [],
				profile: updates.profile ? Object.keys(updates.profile) : [],
			},
		},
	});

	return createSuccessResponse({
		user: updatedUser,
		profile: updatedProfile,
	});
};

export const handler = withAuth(handlerFn);
