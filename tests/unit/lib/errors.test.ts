import { describe, expect, it } from "vitest";
import { ApiError, Errors, formatError } from "@/lib/errors";

describe("Error Handling", () => {
	describe("ApiError", () => {
		it("should create an error with statusCode, code, and message", () => {
			const error = new ApiError(404, "NOT_FOUND", "Resource not found");

			expect(error.statusCode).toBe(404);
			expect(error.code).toBe("NOT_FOUND");
			expect(error.message).toBe("Resource not found");
			expect(error.name).toBe("ApiError");
		});

		it("should include optional details", () => {
			const details = { field: "email", issue: "invalid format" };
			const error = new ApiError(
				400,
				"VALIDATION_ERROR",
				"Invalid input",
				details,
			);

			expect(error.details).toEqual(details);
		});
	});

	describe("Errors factory", () => {
		it("should create Unauthorized error", () => {
			const error = Errors.Unauthorized();
			expect(error.statusCode).toBe(401);
			expect(error.code).toBe("UNAUTHORIZED");
			expect(error.message).toBe("Authentication required");
		});

		it("should create Forbidden error", () => {
			const error = Errors.Forbidden();
			expect(error.statusCode).toBe(403);
			expect(error.code).toBe("FORBIDDEN");
			expect(error.message).toBe("Access denied");
		});

		it("should create NotFound error with resource name", () => {
			const error = Errors.NotFound("User");
			expect(error.statusCode).toBe(404);
			expect(error.code).toBe("NOT_FOUND");
			expect(error.message).toBe("User not found");
		});

		it("should create BadRequest error with custom message", () => {
			const error = Errors.BadRequest("Invalid email format");
			expect(error.statusCode).toBe(400);
			expect(error.code).toBe("BAD_REQUEST");
			expect(error.message).toBe("Invalid email format");
		});

		it("should create ValidationError with details", () => {
			const details = { errors: [{ field: "email", message: "required" }] };
			const error = Errors.ValidationError(details);
			expect(error.statusCode).toBe(400);
			expect(error.code).toBe("VALIDATION_ERROR");
			expect(error.message).toBe("Validation failed");
			expect(error.details).toEqual(details);
		});

		it("should create RateLimited error", () => {
			const error = Errors.RateLimited();
			expect(error.statusCode).toBe(429);
			expect(error.code).toBe("RATE_LIMITED");
			expect(error.message).toBe("Too many requests");
		});

		it("should create InternalServerError", () => {
			const error = Errors.InternalServerError("Database connection failed");
			expect(error.statusCode).toBe(500);
			expect(error.code).toBe("INTERNAL_ERROR");
			expect(error.message).toBe("Database connection failed");
		});
	});

	describe("formatError", () => {
		it("should format ApiError correctly", () => {
			const error = new ApiError(404, "NOT_FOUND", "User not found");
			const formatted = formatError(error, "req-123");

			expect(formatted.statusCode).toBe(404);
			expect(formatted.headers["Content-Type"]).toBe("application/json");

			const body = JSON.parse(formatted.body);
			expect(body.success).toBe(false);
			expect(body.error).toBe("User not found");
			expect(body.details.code).toBe("NOT_FOUND");
			expect(body.details.requestId).toBe("req-123");
			expect(body.details.timestamp).toBeDefined();
		});

		it("should format unknown errors as internal server error", () => {
			const error = new Error("Something went wrong");
			const formatted = formatError(error, "req-456");

			expect(formatted.statusCode).toBe(500);
			const body = JSON.parse(formatted.body);
			expect(body.error).toBe("Internal server error");
			expect(body.details.code).toBe("INTERNAL_ERROR");
			expect(body.details.requestId).toBe("req-456");
		});

		it("should include timestamp in error response", () => {
			const error = Errors.BadRequest("Test error");
			const formatted = formatError(error);

			const body = JSON.parse(formatted.body);
			expect(body.details.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});
	});
});
