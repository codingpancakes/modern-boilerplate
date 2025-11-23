import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { withAuth, AuthenticatedEvent } from '../../../lib/middleware';
import { getDb } from '../../../lib/db';
import { sql } from 'drizzle-orm';
import type { Context } from 'aws-lambda';

const logger = new Logger({ serviceName: 'me-id' });
const tracer = new Tracer({ serviceName: 'me-id' });

/**
 * @swagger
 * /v1/members/me/id:
 *   get:
 *     tags: [Members]
 *     summary: Get current user's ID only
 *     description: Returns only the userId of the authenticated user
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User ID retrieved successfully
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
 *                     userId:
 *                       type: string
 *                       format: uuid
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */

type UserIdResponse = {
  userId: string;
};

const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  const claims = event.claims;
  const providerSubject = claims?.sub;

  if (!providerSubject) {
    logger.error('No provider subject found in claims');
    throw new Error('Unauthorized');
  }

  logger.info('Getting user ID', { providerSubject });

  try {
    const db = await getDb();
    const q = sql`
      SELECT u.id AS "userId"
      FROM auth_identities ai
      JOIN users u ON u.id = ai.user_id
      WHERE ai.provider_subject = ${providerSubject}
      ORDER BY ai.created_at DESC
      LIMIT 1;
    `;

    const results = await db.execute(q);
    
    if (results.rows.length === 0) {
      logger.warn('User not found', { providerSubject });
      throw new Error('User not found');
    }

    const result = results.rows[0] as UserIdResponse;
    
    logger.info('User ID retrieved successfully', { 
      userId: result.userId
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: { memberId: result.userId }
      }),
    };

  } catch (error) {
    logger.error('Error getting user ID', { error, providerSubject });
    throw error;
  }
};

// 5. ARCHITECTURE - Export with withAuth wrapper
export const handler = withAuth(handlerFn);
