import { Logger } from '@aws-lambda-powertools/logger';
import { withAuth, AuthenticatedEvent } from '../../lib/middleware';
import { getDb } from '../../lib/db';
import { Errors } from '../../lib/errors';
import { createSuccessResponse } from '../../lib/response';
import { authIdentities, users, profiles } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { Context } from 'aws-lambda';

const logger = new Logger({ serviceName: 'users-me' });

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

const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  logger.addContext(context);
  const claims = event.claims;
  const providerSubject = claims?.sub;

  // Add persistent context to all logs
  logger.appendKeys({ providerSubject });

  if (!providerSubject) {
    throw Errors.Unauthorized();
  }

  logger.info('Getting user profile');

  const db = await getDb();

  // Get user ID from auth_identities
  const authResult = await db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(eq(authIdentities.providerSubject, providerSubject))
    .limit(1);

  if (authResult.length === 0) {
    logger.warn('User not provisioned yet - valid JWT but no database record');
    throw Errors.Unauthorized();
  }

  const userId = authResult[0].userId;
  
  if (!userId) {
    logger.error('User ID is null in auth_identities');
    throw Errors.Unauthorized();
  }

  logger.appendKeys({ userId });

  // Get user data
  const userResult = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userResult.length === 0) {
    logger.error('User record not found after auth lookup');
    throw Errors.Unauthorized();
  }

  // Get profile data (may not exist yet)
  const profileResult = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  const user = userResult[0];
  const profile = profileResult[0] || null;

  logger.info('User profile retrieved successfully', { userId: user.id });

  return createSuccessResponse({
    user,
    profile,
  });
};

export const handler = withAuth(handlerFn);
