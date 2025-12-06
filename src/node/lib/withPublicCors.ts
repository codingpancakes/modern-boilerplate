import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	Context,
} from "aws-lambda";
import { getCorsHeaders, handleOptionsRequest } from "./cors";
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
			const corsHeaders = getCorsHeaders(origin);

			// Ensure response has headers
			if (typeof response === "object" && response !== null) {
				return {
					...response,
					headers: {
						...(response.headers || {}),
						...corsHeaders,
					},
				};
			}

			// For simple responses
			return {
				statusCode: 200,
				headers: corsHeaders,
				body: JSON.stringify(response),
			};
		} catch (error: any) {
			const corsHeaders = getCorsHeaders(origin);
			const errorResponse = formatError(error, context.awsRequestId);

			return {
				...errorResponse,
				headers: {
					...(errorResponse.headers || {}),
					...corsHeaders,
				},
			};
		}
	};
};
