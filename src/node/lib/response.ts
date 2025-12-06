/**
 * Response Builder Helpers
 *
 * Centralized response creation with consistent format.
 * CORS headers are added by middleware - don't add them here.
 */

export interface SuccessResponse<_T = unknown> {
	statusCode: number;
	headers?: Record<string, string>;
	body: string;
}

export interface ErrorDetails {
	code: string;
	details?: unknown;
	requestId?: string;
	timestamp: string;
}

/**
 * Create a success response
 *
 * @param data - Response data
 * @param statusCode - HTTP status code (default: 200)
 * @param headers - Additional headers (CORS added by middleware)
 *
 * @example
 * return createSuccessResponse({ user: {...} });
 * return createSuccessResponse({ users: [...] }, 200);
 */
export function createSuccessResponse<T>(
	data: T,
	statusCode: number = 200,
	headers?: Record<string, string>,
): SuccessResponse {
	return {
		statusCode,
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		body: JSON.stringify({
			success: true,
			data,
		}),
	};
}

/**
 * Create an error response
 *
 * @param message - Error message
 * @param statusCode - HTTP status code
 * @param details - Additional error details
 * @param headers - Additional headers (CORS added by middleware)
 *
 * @example
 * return createErrorResponse('Not found', 404, { code: 'NOT_FOUND' });
 */
export function createErrorResponse(
	message: string,
	statusCode: number,
	details?: ErrorDetails,
	headers?: Record<string, string>,
): SuccessResponse {
	return {
		statusCode,
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		body: JSON.stringify({
			success: false,
			error: message,
			details: details || {
				code: "ERROR",
				timestamp: new Date().toISOString(),
			},
		}),
	};
}

/**
 * Create a paginated response
 *
 * @param items - Array of items
 * @param metadata - Pagination metadata
 * @param statusCode - HTTP status code (default: 200)
 *
 * @example
 * return createPaginatedResponse(
 *   users,
 *   { total: 100, cursor: 'next_token', hasMore: true }
 * );
 */
export function createPaginatedResponse<T>(
	items: T[],
	metadata: {
		total?: number;
		cursor?: string;
		hasMore?: boolean;
		limit?: number;
	},
	statusCode: number = 200,
): SuccessResponse {
	return {
		statusCode,
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			success: true,
			data: items,
			meta: {
				count: items.length,
				...metadata,
			},
		}),
	};
}

/**
 * Create a no-content response (204)
 *
 * @example
 * return createNoContentResponse();
 */
export function createNoContentResponse(): SuccessResponse {
	return {
		statusCode: 204,
		headers: {
			"Content-Type": "application/json",
		},
		body: "",
	};
}
