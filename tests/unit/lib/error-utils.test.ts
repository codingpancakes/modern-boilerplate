import { describe, expect, it } from "vitest";
import { isUniqueConstraintViolation } from "@/lib/error-utils";

describe("isUniqueConstraintViolation", () => {
	it("detects direct Postgres 23505 errors", () => {
		expect(isUniqueConstraintViolation({ code: "23505" })).toBe(true);
	});

	it("detects Drizzle-wrapped Postgres unique violations through cause", () => {
		const wrapped = new Error("Failed query");
		wrapped.cause = Object.assign(new Error("duplicate key value"), {
			code: "23505",
		});

		expect(isUniqueConstraintViolation(wrapped)).toBe(true);
	});

	it("does not classify non-unique database failures as auth races", () => {
		const wrapped = new Error("Failed query");
		wrapped.cause = Object.assign(new Error("jit insert boom"), {
			code: "P0001",
		});

		expect(isUniqueConstraintViolation(wrapped)).toBe(false);
	});
});
