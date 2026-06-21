import { afterEach, describe, expect, it, vi } from "vitest";
import { getCorsHeaders, isAllowedOrigin } from "@/lib/cors";

describe("cors", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("reads exact origins at request time", () => {
		const origin = "https://api.example.com";

		vi.stubEnv("STAGE", "production");
		vi.stubEnv("CORS_EXACT_ORIGINS", origin);

		expect(isAllowedOrigin(origin)).toBe(true);
		expect(getCorsHeaders(origin)["Access-Control-Allow-Origin"]).toBe(origin);
	});

	it("keys dev-origin access on STAGE instead of NODE_ENV", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("STAGE", "production");

		expect(isAllowedOrigin("http://localhost:3000")).toBe(false);

		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("STAGE", "local");

		expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
	});
});
