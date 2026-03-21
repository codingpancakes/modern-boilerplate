/**
 * Response Builder Helpers
 *
 * Centralized response creation with consistent format.
 * CORS headers are added by middleware -- don't add them here.
 */

export interface SuccessResponse {
	statusCode: number;
	headers?: Record<string, string>;
	body: string;
}

/**
 * Create a success response
 */
export function createSuccessResponse<T>(
	data: T,
	statusCode = 200,
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
 * Create a no-content response (204)
 */
export function createNoContentResponse(): SuccessResponse {
	return {
		statusCode: 204,
		body: "",
	};
}
