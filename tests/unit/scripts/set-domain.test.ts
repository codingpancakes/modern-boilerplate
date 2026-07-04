import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	apiHost,
	applyCustomDomains,
	validateDomain,
} from "../../../scripts/set-domain";

const repoRoot = path.resolve(__dirname, "../../..");
const baseToml = fs.readFileSync(
	path.join(repoRoot, "wrangler.toml"),
	"utf-8",
);

describe("apiHost", () => {
	it("uses <api>.<domain> for production and <api>-staging.<domain> for staging", () => {
		expect(apiHost("production", "acme.dev", "api")).toBe("api.acme.dev");
		expect(apiHost("staging", "acme.dev", "api")).toBe("api-staging.acme.dev");
		expect(apiHost("production", "acme.dev", "gateway")).toBe("gateway.acme.dev");
	});
});

describe("validateDomain", () => {
	it("accepts a plausible domain and rejects junk", () => {
		expect(() => validateDomain("acme.dev")).not.toThrow();
		expect(() => validateDomain("sub.acme.co.uk")).not.toThrow();
		expect(() => validateDomain("not a domain")).toThrow();
		expect(() => validateDomain("localhost")).toThrow();
	});
});

describe("applyCustomDomains", () => {
	it("adds a custom_domain route to BOTH envs with the right hosts", () => {
		const out = applyCustomDomains(baseToml, { domain: "acme.dev" });

		expect(out).toContain("[[env.staging.routes]]");
		expect(out).toContain('pattern = "api-staging.acme.dev"');
		expect(out).toContain("[[env.production.routes]]");
		expect(out).toContain('pattern = "api.acme.dev"');
		// custom_domain must accompany each pattern
		expect(out.match(/custom_domain = true/g)).toHaveLength(2);
	});

	it("honors a custom api subdomain", () => {
		const out = applyCustomDomains(baseToml, {
			domain: "acme.dev",
			apiSubdomain: "gateway",
		});
		expect(out).toContain('pattern = "gateway-staging.acme.dev"');
		expect(out).toContain('pattern = "gateway.acme.dev"');
	});

	it("is idempotent — re-running does not stack duplicate blocks", () => {
		const once = applyCustomDomains(baseToml, { domain: "acme.dev" });
		const twice = applyCustomDomains(once, { domain: "acme.dev" });
		expect(twice).toBe(once);
		expect(twice.match(/\[\[env\.staging\.routes\]\]/g)).toHaveLength(1);
		expect(twice.match(/\[\[env\.production\.routes\]\]/g)).toHaveLength(1);
	});

	it("replaces the host when re-run with a different domain", () => {
		const first = applyCustomDomains(baseToml, { domain: "acme.dev" });
		const second = applyCustomDomains(first, { domain: "beta.io" });
		expect(second).toContain('pattern = "api.beta.io"');
		expect(second).not.toContain("acme.dev");
		expect(second.match(/\[\[env\.production\.routes\]\]/g)).toHaveLength(1);
	});

	it("keeps the existing env blocks intact (rate limiter still present)", () => {
		const out = applyCustomDomains(baseToml, { domain: "acme.dev" });
		expect(out.match(/\[\[env\.staging\.ratelimits\]\]/g)).toHaveLength(1);
		expect(out.match(/\[\[env\.production\.ratelimits\]\]/g)).toHaveLength(1);
		expect(out).toContain("[[env.production.queues.producers]]");
	});
});
