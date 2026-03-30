import { timingSafeEqual } from "node:crypto";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	Context,
} from "aws-lambda";
import { getCorsHeaders, handleOptionsRequest, securityHeaders } from "./cors";
import { Errors, formatError } from "./errors";
import type { SuccessResponse } from "./response";

export interface CustomHeaderConfig {
	headerName: string;
	expectedValue?: string;
	validateFn?: (headerValue: string) => boolean;
}

/**
 * Validate header value against config
 * @throws BadRequest if header is missing or invalid
 */
function validateHeader(
	event: APIGatewayProxyEventV2,
	config: CustomHeaderConfig,
): void {
	// Check for header (case-insensitive)
	const headerValue =
		event.headers[config.headerName] ||
		event.headers[config.headerName.toLowerCase()] ||
		event.headers[config.headerName.toUpperCase()];

	if (!headerValue) {
		throw Errors.BadRequest(`Missing required header: ${config.headerName}`);
	}

	// Validate header value
	let isValid = false;
	if (config.expectedValue !== undefined && config.expectedValue !== "") {
		// Constant-time comparison to prevent timing attacks on API keys / secret tokens
		const a = Buffer.from(headerValue);
		const b = Buffer.from(config.expectedValue);
		isValid = a.length === b.length && timingSafeEqual(a, b);
	} else if (config.validateFn) {
		isValid = config.validateFn(headerValue);
	} else if (config.expectedValue === "") {
		throw Errors.BadRequest(
			`${config.headerName} validation not configured — rejecting`,
		);
	} else {
		isValid = true;
	}

	if (!isValid) {
		throw Errors.BadRequest(`Invalid ${config.headerName} header value`);
	}
}

interface HandlerResult {
	statusCode: number;
	headers?: Record<string, string>;
	body: string;
}

function isHandlerResult(value: unknown): value is HandlerResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"statusCode" in value &&
		"body" in value
	);
}

/**
 * Wrap response with CORS headers
 */
function wrapResponse(
	response: HandlerResult | unknown,
	corsHeaders: Record<string, string>,
): HandlerResult {
	if (isHandlerResult(response)) {
		return {
			statusCode: response.statusCode,
			headers: {
				...(response.headers || {}),
				...corsHeaders,
			},
			body: response.body,
		};
	}

	return {
		statusCode: 200,
		headers: corsHeaders,
		body: JSON.stringify(response),
	};
}

/**
 * Middleware for open endpoints that require a custom header for security
 * Validates a specific header while providing CORS support
 * No JWT authentication required
 */
export const withCustomHeader = (
	config: CustomHeaderConfig,
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
			validateHeader(event, config);
			const response = await handlerFn(event, context);
			return wrapResponse(response, securityHeaders(getCorsHeaders(origin)));
		} catch (error: unknown) {
			const errorResponse = formatError(error, context.awsRequestId);
			return wrapResponse(
				errorResponse,
				securityHeaders(getCorsHeaders(origin)),
			);
		}
	};
};

/**
 * Convenience function for API key validation
 */
export const withApiKey = (
	expectedApiKey: string,
	handlerFn: (
		event: APIGatewayProxyEventV2,
		context: Context,
	) => Promise<SuccessResponse>,
): APIGatewayProxyHandlerV2 => {
	return withCustomHeader(
		{
			headerName: "X-API-Key",
			expectedValue: expectedApiKey,
		},
		handlerFn,
	);
};
