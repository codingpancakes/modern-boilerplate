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
import { Errors } from "../../lib/errors";
import { withIdempotency } from "../../lib/idempotency";
import {
	type AuthenticatedEvent,
	type HandlerResponse,
	withAuth,
} from "../../lib/middleware";
import { createSuccessResponse } from "../../lib/response";
import { sanitizeObject } from "../../lib/sanitize";
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

	return withIdempotency(event, async () => {
		// Get internal user ID from JWT claims
		const userId = await getUserIdFromClaims(event);

		// Add persistent context to all logs
		logger.appendKeys({ userId });

		// Validate request body with Zod
		const updateRequest = parseBody(event, schemas.updateUserProfile);

		logger.info("Updating user profile", {
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
					tx.select().from(users).where(eq(users.id, userId)).limit(1),
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
							.update(users)
							.set(updates.user)
							.where(eq(users.id, userId))
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
			ipAddress: event.requestContext?.http?.sourceIp,
			userAgent: event.headers?.["user-agent"],
			requestId: event.requestContext?.requestId,
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
	}) as unknown as HandlerResponse;
};

export const handler = withAuth(handlerFn);
