import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	Context,
} from "aws-lambda";
import {
	getCorsHeaders,
	getExternalCorsHeaders,
	getOpenCorsHeaders,
	handleExternalOptionsRequest,
	handleOpenOptionsRequest,
	handleOptionsRequest,
} from "./cors";
import { Errors, formatError } from "./errors";

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
	if (config.expectedValue) {
		isValid = headerValue === config.expectedValue;
	} else if (config.validateFn) {
		isValid = config.validateFn(headerValue);
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
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return async (event: APIGatewayProxyEventV2, context: Context) => {
		const origin = event.headers.origin || event.headers.Origin;

		// Handle preflight OPTIONS requests
		if (event.requestContext.http.method === "OPTIONS") {
			return handleOptionsRequest(origin);
		}

		try {
			validateHeader(event, config);
			const response = await handlerFn(event, context);
			const corsHeaders = getCorsHeaders(origin);
			return wrapResponse(response, corsHeaders);
		} catch (error: unknown) {
			const corsHeaders = getCorsHeaders(origin);
			const errorResponse = formatError(error, context.awsRequestId);
			return wrapResponse(errorResponse, corsHeaders);
		}
	};
};

/**
 * Convenience function for API key validation
 */
export const withApiKey = (
	expectedApiKey: string,
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return withCustomHeader(
		{
			headerName: "X-API-Key",
			expectedValue: expectedApiKey,
		},
		handlerFn,
	);
};

/**
 * Convenience function for secret token validation
 */
export const withSecretToken = (
	expectedToken: string,
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return withCustomHeader(
		{
			headerName: "X-Secret-Token",
			expectedValue: expectedToken,
		},
		handlerFn,
	);
};

/**
 * Convenience function for webhook signature validation
 */
export const withWebhookSignature = (
	validateSignature: (signature: string) => boolean,
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return withCustomHeader(
		{
			headerName: "X-Webhook-Signature",
			validateFn: validateSignature,
		},
		handlerFn,
	);
};

/**
 * Middleware for external service webhooks with relaxed CORS
 * Allows calls from known external services (Stripe, Twilio, etc.)
 */
export const withExternalHeader = (
	config: CustomHeaderConfig,
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return async (event: APIGatewayProxyEventV2, context: Context) => {
		const origin = event.headers.origin || event.headers.Origin;

		// Handle preflight OPTIONS requests with external CORS
		if (event.requestContext.http.method === "OPTIONS") {
			return handleExternalOptionsRequest(origin);
		}

		try {
			validateHeader(event, config);
			const response = await handlerFn(event, context);
			const corsHeaders = getExternalCorsHeaders(origin);
			return wrapResponse(response, corsHeaders);
		} catch (error: unknown) {
			const corsHeaders = getExternalCorsHeaders(origin);
			const errorResponse = formatError(error, context.awsRequestId);
			return wrapResponse(errorResponse, corsHeaders);
		}
	};
};

/**
 * Middleware for completely open webhooks (allows any origin)
 * Use only for public webhooks that don't expose sensitive data
 */
export const withOpenHeader = (
	config: CustomHeaderConfig,
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return async (event: APIGatewayProxyEventV2, context: Context) => {
		// Handle preflight OPTIONS requests with open CORS
		if (event.requestContext.http.method === "OPTIONS") {
			return handleOpenOptionsRequest();
		}

		try {
			validateHeader(event, config);
			const response = await handlerFn(event, context);
			const corsHeaders = getOpenCorsHeaders();
			return wrapResponse(response, corsHeaders);
		} catch (error: unknown) {
			const corsHeaders = getOpenCorsHeaders();
			const errorResponse = formatError(error, context.awsRequestId);
			return wrapResponse(errorResponse, corsHeaders);
		}
	};
};

/**
 * Convenience functions for external webhooks
 */
export const withExternalApiKey = (
	expectedApiKey: string,
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return withExternalHeader(
		{
			headerName: "X-API-Key",
			expectedValue: expectedApiKey,
		},
		handlerFn,
	);
};

export const withOpenApiKey = (
	expectedApiKey: string,
	handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>,
): APIGatewayProxyHandlerV2 => {
	return withOpenHeader(
		{
			headerName: "X-API-Key",
			expectedValue: expectedApiKey,
		},
		handlerFn,
	);
};
