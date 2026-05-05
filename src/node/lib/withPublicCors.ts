import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	Context,
} from "aws-lambda";
import { getCorsHeaders, handleOptionsRequest, securityHeaders } from "./cors";
import { Errors, formatError } from "./errors";
import { verifyOriginHeader } from "./origin-verify";
import type { SuccessResponse } from "./response";

/**
 * Middleware for public endpoints that only adds CORS headers
 * No authentication required
 */
export const withPublicCors = (
	handlerFn: (
		event: APIGatewayProxyEventV2,
		context: Context,
	) => Promise<SuccessResponse>,
): APIGatewayProxyHandlerV2 => {
	return async (event: APIGatewayProxyEventV2, context: Context) => {
		const origin = event.headers.origin || event.headers.Origin;

		if (event.requestContext.http.method === "OPTIONS") {
			return handleOptionsRequest(
				origin,
				event.headers as Record<string, string>,
			);
		}

		try {
			if (!verifyOriginHeader(event.headers)) {
				throw Errors.Forbidden();
			}

			const response = await handlerFn(event, context);
			const corsHeaders = securityHeaders(getCorsHeaders(origin));
			return {
				statusCode: response.statusCode,
				headers: { ...(response.headers || {}), ...corsHeaders },
				body: response.body,
			};
		} catch (error: unknown) {
			const corsHeaders = securityHeaders(getCorsHeaders(origin));
			const errorResponse = formatError(error, context.awsRequestId);
			return {
				statusCode: errorResponse.statusCode,
				headers: { ...(errorResponse.headers || {}), ...corsHeaders },
				body: errorResponse.body,
			};
		}
	};
};
