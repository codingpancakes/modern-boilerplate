import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { createSuccessResponse } from "../../lib/response";
import { withApiKey } from "../../lib/withCustomHeader";

const logger = new Logger({ serviceName: "test-api-key" });

/**
 * @swagger
 * /v1/test/api-key:
 *   get:
 *     summary: Test API key authentication
 *     description: Tests the withApiKey middleware
 *     tags:
 *       - Test
 *     parameters:
 *       - in: header
 *         name: X-API-Key
 *         required: true
 *         schema:
 *           type: string
 *         description: API key for authentication
 *     responses:
 *       200:
 *         description: API key valid
 *       401:
 *         description: Invalid or missing API key
 */
const handlerFn = async (_event: APIGatewayProxyEventV2, _context: Context) => {
	logger.addContext(_context);
	logger.info("API key endpoint accessed");

	return createSuccessResponse({
		message: "API key authentication successful",
		timestamp: new Date().toISOString(),
	});
};

const EXPECTED_API_KEY = process.env.TEST_API_KEY || "";
if (!EXPECTED_API_KEY) {
	logger.warn(
		"TEST_API_KEY not set — /v1/test/api-key endpoint will reject all requests",
	);
}
export const handler = withApiKey(EXPECTED_API_KEY, handlerFn);
