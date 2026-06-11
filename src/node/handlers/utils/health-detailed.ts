/**
 * Thin Lambda adapter — the route logic lives on the shared Hono app
 * (`src/node/routes/utils.ts`, GET /health/detailed relative to the /v1
 * mount). The @swagger block stays here because
 * `scripts/generate-openapi.js` only globs `src/node/handlers/**`.
 */

/**
 * @swagger
 * /v1/health/detailed:
 *   get:
 *     tags: [Utils]
 *     summary: Detailed health check endpoint
 *     description: Returns comprehensive health status including database connectivity and external service checks. No authentication required.
 *     security: []
 *     responses:
 *       200:
 *         description: Health check results
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
 *                       enum: [healthy, degraded, unhealthy]
 *                       example: healthy
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     version:
 *                       type: string
 *                       example: v1
 *                     stage:
 *                       type: string
 *                       example: production
 *                     checks:
 *                       type: object
 *                       properties:
 *                         database:
 *                           type: object
 *                           properties:
 *                             status:
 *                               type: string
 *                               enum: [ok, error]
 *                             responseTime:
 *                               type: number
 *                               description: Response time in milliseconds
 *                             message:
 *                               type: string
 *                         workos:
 *                           type: object
 *                           properties:
 *                             status:
 *                               type: string
 *                               enum: [ok, error, skipped]
 *                             configured:
 *                               type: boolean
 *                         s3:
 *                           type: object
 *                           properties:
 *                             status:
 *                               type: string
 *                               enum: [ok, error, skipped]
 *                             configured:
 *                               type: boolean
 */
export { handler } from "../../lambda";
