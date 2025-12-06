import { describe, it, expect } from "vitest";
import { ApiError, Errors, formatError } from "@/lib/errors";

describe("Error Handling", () => {
	describe("ApiError", () => {
		it("should create error with correct properties", () => {
			const error = new ApiError(404, "NOT_FOUND", "Resource not found");

			expect(error.statusCode).toBe(404);
			expect(error.code).toBe("NOT_FOUND");
			expect(error.message).toBe("Resource not found");
			expect(error.name).toBe("ApiError");
		});

		it("should include details when provided", () => {
			const details = { resourceId: "123" };
			const error = new ApiError(400, "BAD_REQUEST", "Invalid input", details);

			expect(error.details).toEqual(details);
		});
	});

	describe("Errors factory", () => {
		it("should create Unauthorized error", () => {
			const error = Errors.Unauthorized();

			expect(error.statusCode).toBe(401);
			expect(error.code).toBe("UNAUTHORIZED");
		});

		it("should create NotFound error with resource name", () => {
			const error = Errors.NotFound("User");

			expect(error.statusCode).toBe(404);
			expect(error.message).toBe("User not found");
		});

		it("should create BadRequest error with details", () => {
			const details = { field: "email", reason: "invalid" };
			const error = Errors.BadRequest("Invalid email", details);

			expect(error.statusCode).toBe(400);
			expect(error.details).toEqual(details);
		});
	});

	describe("formatError", () => {
		it("should format ApiError correctly", () => {
			const error = new ApiError(404, "NOT_FOUND", "Resource not found");
			const requestId = "test-request-id";

			const response = formatError(error, requestId);

			expect(response.statusCode).toBe(404);
			expect(response.headers?.["Content-Type"]).toBe("application/json");

			const body = JSON.parse(response.body);
			expect(body.success).toBe(false);
			expect(body.error).toBe("Resource not found");
			expect(body.details.code).toBe("NOT_FOUND");
			expect(body.details.requestId).toBe(requestId);
		});

		it("should format unknown errors as 500", () => {
			const error = new Error("Something went wrong");
			const requestId = "test-request-id";

			const response = formatError(error, requestId);

			expect(response.statusCode).toBe(500);

			const body = JSON.parse(response.body);
			expect(body.success).toBe(false);
			expect(body.error).toBe("Internal server error");
			expect(body.details.code).toBe("INTERNAL_ERROR");
		});
	});
});
