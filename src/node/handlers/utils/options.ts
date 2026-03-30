import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { createNoContentResponse } from "../../lib/response";
import { withPublicCors } from "../../lib/withPublicCors";

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
const optionsHandler = async (
	_event: APIGatewayProxyEventV2,
	_context: Context,
) => {
	return createNoContentResponse();
};

export const handler = withPublicCors(optionsHandler);
