import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	Context,
} from "aws-lambda";
import { getCorsHeaders, handleOptionsRequest, securityHeaders } from "./cors";
import { formatError } from "./errors";

/**
 * Middleware for public endpoints that only adds CORS headers
 * No authentication required
 */
export const withPublicCors = (
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return async (event: APIGatewayProxyEventV2, context: Context) => {
		const origin = event.headers.origin || event.headers.Origin;

		// Handle preflight OPTIONS requests
		if (event.requestContext.http.method === "OPTIONS") {
			return handleOptionsRequest(origin);
		}

		try {
			const response = await handlerFn(event, context);
			const headers = securityHeaders(getCorsHeaders(origin));

			if (typeof response === "object" && response !== null) {
				return {
					...response,
					headers: { ...(response.headers || {}), ...headers },
				};
			}

			return { statusCode: 200, headers, body: JSON.stringify(response) };
		} catch (error: any) {
			const headers = securityHeaders(getCorsHeaders(origin));
			const errorResponse = formatError(error, context.awsRequestId);
			return {
				...errorResponse,
				headers: { ...(errorResponse.headers || {}), ...headers },
			};
		}
	};
};
