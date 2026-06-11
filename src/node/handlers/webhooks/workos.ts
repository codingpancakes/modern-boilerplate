/**
 * Thin Lambda adapter — the route logic lives on the shared Hono app
 * (`src/node/routes/webhooks.ts`, POST /workos relative to the /v1/webhooks
 * mount), including raw-body HMAC verification, the 1MB payload cap, the
 * replay-window check, and the DB-backed idempotency lock flow.
 * The @swagger block stays here because `scripts/generate-openapi.js`
 * only globs `src/node/handlers/**`.
 */

/**
 * @swagger
 * /v1/webhooks/workos:
 *   post:
 *     tags: [Webhooks]
 *     summary: WorkOS webhook handler
 *     description: |
 *       Handles WorkOS webhook events for user and organization lifecycle management.
 *       Verifies webhook signature and processes events idempotently.
 *
 *       **Supported Events:**
 *       - `user.created` - Creates new user and auth identity
 *       - `user.updated` - Updates existing user data
 *       - `user.deleted` - Removes user and auth identity
 *       - `organization.created` - Creates new organization
 *       - `organization.updated` - Updates organization data
 *       - `organization.deleted` - Removes organization
 *
 *       **Security:** Requires valid WorkOS webhook signature in headers.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 description: Unique event ID
 *                 example: "evt_01H1234567890ABCDEFGHIJK"
 *               event:
 *                 type: string
 *                 description: Event type
 *                 enum: [user.created, user.updated, user.deleted, organization.created, organization.updated, organization.deleted]
 *                 example: "user.created"
 *               data:
 *                 type: object
 *                 description: Event payload (varies by event type)
 *     responses:
 *       200:
 *         description: Webhook processed successfully
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
 *                       enum: [processed, already_processed]
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
export { handler } from "../../lambda";
