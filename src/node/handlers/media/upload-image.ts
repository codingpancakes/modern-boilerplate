/**
 * POST /v1/media/upload-image — Lambda entry point.
 *
 * The route logic lives on the shared Hono app (`src/node/routes/media.ts`);
 * this file stays so CDK/RouteBuilder wiring is untouched. The @swagger block
 * below must remain here: `scripts/generate-openapi.js` only globs
 * `src/node/handlers/**`.
 */

/**
 * @swagger
 * /v1/media/upload-image:
 *   post:
 *     summary: Generate presigned URL for image upload
 *     description: Creates a presigned S3 URL for uploading user images
 *     tags:
 *       - Media
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filename
 *               - contentType
 *             properties:
 *               filename:
 *                 type: string
 *                 description: Original filename of the image
 *                 example: "profile-photo.jpg"
 *               contentType:
 *                 type: string
 *                 description: MIME type of the image
 *                 enum: ["image/jpeg", "image/png", "image/gif", "image/webp"]
 *                 example: "image/jpeg"
 *               category:
 *                 type: string
 *                 description: Category of the image (profile, document, etc.)
 *                 example: "profile"
 *     responses:
 *       200:
 *         description: Presigned upload URL generated successfully
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
 *                     uploadUrl:
 *                       type: string
 *                       description: Presigned URL for uploading the image
 *                     imageKey:
 *                       type: string
 *                       description: S3 key where the image will be stored
 *                     expiresIn:
 *                       type: number
 *                       description: URL expiry time in seconds
 *       400:
 *         description: Invalid request parameters
 *         schema: { $ref: '#/definitions/StandardErrorResponse' }
 *       401:
 *         description: Unauthorized
 *         schema: { $ref: '#/definitions/StandardErrorResponse' }
 */
export { handler } from "../../lambda";
