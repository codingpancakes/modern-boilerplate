/**
 * Thin Lambda adapter — OPTIONS preflight (incl. API GW's
 * OPTIONS /v1/{proxy+}) is answered globally by the CORS middleware in
 * `src/node/lib/hono/middleware.ts`, so there is no dedicated route.
 * The @swagger block stays here because `scripts/generate-openapi.js`
 * only globs `src/node/handlers/**`.
 */

/**
 * @swagger
 * /v1/utils/options:
 *   options:
 *     tags: [Utils]
 *     summary: CORS preflight handler
 *     description: Handles OPTIONS preflight requests for CORS. Returns 204 No Content with proper CORS headers.
 *     security: []
 *     responses:
 *       204:
 *         description: No content - CORS preflight successful
 */
export { handler } from "../../lambda";
