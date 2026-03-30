import { Logger } from "@aws-lambda-powertools/logger";
import { errorMessage } from "./error-utils";

const logger = new Logger({ serviceName: "api" });

const isDeployed =
	process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";

export class ApiError extends Error {
	constructor(
		public statusCode: number,
		public code: string,
		message: string,
		public details?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export function formatError(error: unknown, requestId?: string) {
	const timestamp = new Date().toISOString();

	if (error instanceof ApiError) {
		// In production, mask internal details for server errors
		const safeMessage =
			isDeployed && error.statusCode >= 500
				? "Internal server error"
				: error.message;

		return {
			statusCode: error.statusCode,
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				success: false,
				error: safeMessage,
				details: {
					code: error.code,
					extra: isDeployed ? undefined : error.details,
					requestId,
					timestamp,
				},
			}),
		};
	}

	// Log unexpected errors
	logger.error("Unexpected error", {
		error: errorMessage(error),
		requestId,
	});

	return {
		statusCode: 500,
		headers: {
			"Content-Type": "application/json",
			// CORS headers added by middleware
		},
		body: JSON.stringify({
			success: false,
			error: "Internal server error",
			details: {
				code: "INTERNAL_ERROR",
				requestId,
				timestamp,
			},
		}),
	};
}

// Common error types
export const Errors = {
	Unauthorized: () =>
		new ApiError(401, "UNAUTHORIZED", "Authentication required"),
	Forbidden: () => new ApiError(403, "FORBIDDEN", "Access denied"),
	NotFound: (resource: string) =>
		new ApiError(404, "NOT_FOUND", `${resource} not found`),
	BadRequest: (message: string, details?: unknown) =>
		new ApiError(400, "BAD_REQUEST", message, details),
	Conflict: (message: string) => new ApiError(409, "CONFLICT", message),
	ValidationError: (details: unknown) =>
		new ApiError(400, "VALIDATION_ERROR", "Validation failed", details),
	RateLimited: () => new ApiError(429, "RATE_LIMITED", "Too many requests"),
	InternalServerError: (message?: string) =>
		new ApiError(500, "INTERNAL_ERROR", message || "Internal server error"),
};
