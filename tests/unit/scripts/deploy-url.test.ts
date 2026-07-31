import { describe, expect, it } from "vitest";
import {
	customDomainForStage,
	normalizePublicHttpsBase,
} from "../../../scripts/lib/deploy-url";

describe("customDomainForStage", () => {
	it("selects only the requested Wrangler environment", () => {
		const toml = `
[[env.staging.routes]]
pattern = "api-staging.example.com"
custom_domain = true

[[env.production.routes]]
pattern = "api.example.com"
custom_domain = true
`;
		expect(customDomainForStage(toml, "staging")).toBe(
			"api-staging.example.com",
		);
		expect(customDomainForStage(toml, "production")).toBe("api.example.com");
	});
});

describe("normalizePublicHttpsBase", () => {
	it("normalizes a public HTTPS origin", () => {
		expect(normalizePublicHttpsBase("https://API.Example.com/")).toBe(
			"https://api.example.com",
		);
	});

	it.each([
		"http://api.example.com",
		"https://user:pass@api.example.com",
		"https://api.example.com:8443",
		"https://api.example.com/v1/health",
		"https://localhost",
		"https://127.0.0.1",
		"not a URL",
	])("rejects unsafe deployment origins: %s", (url) => {
		expect(() => normalizePublicHttpsBase(url)).toThrow();
	});
});
