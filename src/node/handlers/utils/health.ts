/**
 * Thin Lambda adapter — the route logic lives on the shared Hono app
 * (`src/node/routes/utils.ts`, GET /health relative to the /v1 mount).
 * The @swagger block stays here because `scripts/generate-openapi.js`
 * only globs `src/node/handlers/**`.
 */

/**
 * @swagger
 * /v1/health:
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
export { handler } from "../../lambda";
