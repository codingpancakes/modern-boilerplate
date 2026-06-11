/**
 * GET /v1/media/images — Lambda entry point.
 *
 * The route logic lives on the shared Hono app (`src/node/routes/media.ts`);
 * this file stays so CDK/RouteBuilder wiring is untouched. The @swagger block
 * below must remain here: `scripts/generate-openapi.js` only globs
 * `src/node/handlers/**`.
 */

/**
 * @swagger
 * /v1/media/images:
 *   get:
 *     summary: List user images
 *     description: Retrieves a list of images uploaded by the authenticated user
 *     tags:
 *       - Media
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *         description: Filter images by category prefix
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Maximum number of images to return
 *       - in: query
 *         name: continuationToken
 *         schema:
 *           type: string
 *         description: Token for pagination
 *     responses:
 *       200:
 *         description: List of user images
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
 *                     images:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           key:
 *                             type: string
 *                           url:
 *                             type: string
 *                           size:
 *                             type: number
 *                           lastModified:
 *                             type: string
 *                             format: date-time
 *                           category:
 *                             type: string
 *                     continuationToken:
 *                       type: string
 *                       description: Token for retrieving next page
 *                     hasMore:
 *                       type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export { handler } from "../../lambda";
