import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createNoContentResponse } from "../../lib/response";

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
const optionsHandler: APIGatewayProxyHandlerV2 = async (_event) => {
	return createNoContentResponse();
};

export const handler = optionsHandler;
