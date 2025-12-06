import { describe, it, expect } from "vitest";
import { validate, parseBody } from "@/lib/validation";
import { userSchemas } from "@/lib/validation/users";
import { Errors } from "@/lib/errors";
import { z } from "zod";

describe("Validation", () => {
	describe("validate", () => {
		it("should validate correct data", () => {
			const schema = z.object({
				email: z.string().email(),
				name: z.string(),
			});

			const data = {
				email: "test@example.com",
				name: "Test User",
			};

			const result = validate(schema, data);
			expect(result).toEqual(data);
		});

		it("should throw ValidationError for invalid data", () => {
			const schema = z.object({
				email: z.string().email(),
			});

			const data = {
				email: "invalid-email",
			};

			expect(() => validate(schema, data)).toThrow();
		});
	});

	describe("parseBody", () => {
		it("should parse valid JSON body", () => {
			const event = {
				body: JSON.stringify({
					email: "test@example.com",
					firstName: "Test",
					lastName: "User",
				}),
			} as any;

			const result = parseBody(event, userSchemas.create);
			expect(result.email).toBe("test@example.com");
			expect(result.firstName).toBe("Test");
		});

		it("should throw BadRequest for missing body", () => {
			const event = {} as any;

			expect(() => parseBody(event, userSchemas.create)).toThrow();
		});

		it("should throw BadRequest for invalid JSON", () => {
			const event = {
				body: "invalid json{",
			} as any;

			expect(() => parseBody(event, userSchemas.create)).toThrow();
		});
	});
});
