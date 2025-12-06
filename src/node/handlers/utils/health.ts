import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { withPublicCors } from '../../lib/withPublicCors';
import { createSuccessResponse } from '../../lib/response';

/**
 * @swagger
 * /v1/utils/health:
 *   get:
 *     tags: [Utils]
 *     summary: Health check endpoint
 *     description: Returns API health status, version, and environment information. No authentication required.
 *     security: []
 *     responses:
 *       200:
 *         description: API is healthy
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
 *                     status:
 *                       type: string
 *                       example: ok
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-12-05T20:00:00.000Z"
 *                     version:
 *                       type: string
 *                       example: v1
 *                     stage:
 *                       type: string
 *                       example: production
 */
const healthHandler = async (event: APIGatewayProxyEventV2, context: Context) => {
  return createSuccessResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || 'v1',
    stage: process.env.STAGE || 'dev',
  });
};

export const handler = withPublicCors(healthHandler);
