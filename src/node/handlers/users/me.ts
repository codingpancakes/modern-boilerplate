/**
 * Thin Lambda adapter — the route logic lives on the shared Hono app
 * (`src/node/routes/users.ts`, GET /me relative to the /v1/users mount).
 * The @swagger block stays here because `scripts/generate-openapi.js`
 * only globs `src/node/handlers/**`.
 */

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
export { handler } from "../../lambda";
