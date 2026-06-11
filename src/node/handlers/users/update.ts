/**
 * Thin Lambda adapter — the route logic lives on the shared Hono app
 * (`src/node/routes/users.ts`, PATCH /me relative to the /v1/users mount,
 * including the withIdempotency wrapper and the read-update transaction).
 * The @swagger block stays here because `scripts/generate-openapi.js`
 * only globs `src/node/handlers/**`.
 */

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
export { handler } from "../../lambda";
