import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "@/lib/constant-time";

/**
 * Direct tests for the timing-safe comparison used by webhook HMAC and
 * shared-secret header checks. The security-relevant contract: correct
 * equality, length-mismatch returns false (never throws, unlike
 * crypto.timingSafeEqual), and string vs Buffer inputs compare consistently.
 */
describe("constantTimeEqual", () => {
	it("returns true for equal strings", () => {
		expect(constantTimeEqual("secret-value", "secret-value")).toBe(true);
	});

	it("returns false for different equal-length strings", () => {
		expect(constantTimeEqual("secret-value", "secret-valuX")).toBe(false);
	});

	it("returns false (does not throw) on length mismatch", () => {
		expect(constantTimeEqual("short", "a-much-longer-secret")).toBe(false);
		expect(constantTimeEqual("", "x")).toBe(false);
	});

	it("returns true for two empty strings", () => {
		expect(constantTimeEqual("", "")).toBe(true);
	});

	it("compares equal Buffers (e.g. hex-decoded signatures)", () => {
		const a = Buffer.from("deadbeef", "hex");
		const b = Buffer.from("deadbeef", "hex");
		expect(constantTimeEqual(a, b)).toBe(true);
	});

	it("returns false for differing Buffers of equal length", () => {
		expect(
			constantTimeEqual(
				Buffer.from("deadbeef", "hex"),
				Buffer.from("deadbeff", "hex"),
			),
		).toBe(false);
	});

	it("compares a string and a Buffer of the same UTF-8 bytes as equal", () => {
		expect(constantTimeEqual("abc", Buffer.from("abc"))).toBe(true);
	});
});
