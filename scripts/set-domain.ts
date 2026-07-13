#!/usr/bin/env tsx
/**
 * Wire the API's custom domains into wrangler.toml for staging + production.
 *
 * Adds a Cloudflare Workers Custom Domain route to each deployed env so
 * `wrangler deploy --env <stage>` binds the Worker to a real hostname instead
 * of only *.workers.dev. Re-runnable and idempotent: it manages a single
 * sentinel-delimited block per env, so running it again (or with a new domain)
 * replaces the previous block rather than stacking duplicates.
 *
 * Convention:
 *   production → <api>.<domain>          (default api.<domain>)
 *   staging    → <api>-staging.<domain>  (default api-staging.<domain>)
 *
 * What this does NOT do (deliberately manual — usually a different DNS
 * provider): pointing DNS at Cloudflare. Custom Domains require the zone to be
 * on Cloudflare; once it is, wrangler manages the in-zone DNS record itself.
 *
 * Usage:
 *   pnpm set-domain <domain> [api-subdomain]
 * Example:
 *   pnpm set-domain acme.dev            → api.acme.dev / api-staging.acme.dev
 *   pnpm set-domain acme.dev gateway    → gateway.acme.dev / gateway-staging.acme.dev
 */

import * as fs from "node:fs";
import * as path from "node:path";

type Logger = Pick<Console, "log">;

const BEGIN = "# >>> set-domain (managed by scripts/set-domain.ts)";
const END = "# <<< set-domain";

export interface SetDomainOptions {
	domain: string;
	apiSubdomain?: string;
	root?: string;
	logger?: Logger;
}

function defaultRoot(): string {
	return path.join(__dirname, "..");
}

export function validateDomain(domain: string): void {
	if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
		throw new Error("❌ Domain doesn't look valid (expected e.g. acme.dev)");
	}
}

export function apiHost(
	stage: "staging" | "production",
	domain: string,
	apiSubdomain: string,
): string {
	return stage === "production"
		? `${apiSubdomain}.${domain}`
		: `${apiSubdomain}-staging.${domain}`;
}

function managedBlock(
	stage: "staging" | "production",
	host: string,
): string {
	return [
		`${BEGIN} — ${stage} API custom domain`,
		`[[env.${stage}.routes]]`,
		`pattern = "${host}"`,
		"custom_domain = true",
		END,
	].join("\n");
}

/**
 * Insert/replace the managed custom-domain block for one stage. The block is
 * anchored immediately after that stage's `[[env.<stage>.ratelimits]]` block
 * (the last block in each env section). Pure and idempotent.
 */
export function applyCustomDomains(
	input: string,
	{ domain, apiSubdomain = "api" }: { domain: string; apiSubdomain?: string },
): string {
	// 1. Strip any previously-managed blocks, normalizing surrounding blank
	//    lines to exactly one so re-runs are byte-identical (idempotent).
	let output = input.replace(
		new RegExp(`\\n*${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n*`, "g"),
		"\n\n",
	);

	// 2. Re-insert a fresh block per stage after its ratelimits block.
	for (const stage of ["staging", "production"] as const) {
		const host = apiHost(stage, domain, apiSubdomain);
		const ratelimits = new RegExp(
			`(\\[\\[env\\.${stage}\\.ratelimits\\]\\][\\s\\S]*?simple = \\{[^}]*\\}\\n)`,
		);
		if (!ratelimits.test(output)) {
			throw new Error(
				`❌ Could not find [[env.${stage}.ratelimits]] in wrangler.toml to anchor the routes block.`,
			);
		}
		output = output.replace(
			ratelimits,
			`$1\n${managedBlock(stage, host)}\n`,
		);
	}

	// Normalize EOF to exactly one trailing newline so a re-run (where the
	// production block sits at EOF) is byte-identical.
	return `${output.replace(/\n+$/, "")}\n`;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function setDomain(options: SetDomainOptions): void {
	const {
		domain,
		apiSubdomain = "api",
		root = defaultRoot(),
		logger = console,
	} = options;

	validateDomain(domain);

	const wranglerPath = path.join(root, "wrangler.toml");
	const rewritten = applyCustomDomains(fs.readFileSync(wranglerPath, "utf-8"), {
		domain,
		apiSubdomain,
	});
	fs.writeFileSync(wranglerPath, rewritten);

	const stagingHost = apiHost("staging", domain, apiSubdomain);
	const prodHost = apiHost("production", domain, apiSubdomain);

	logger.log(`✅ wrangler.toml custom domains set:
   staging    → ${stagingHost}
   production → ${prodHost}

Manual step (different DNS provider → not automated):
  1. Add "${domain}" as a zone in Cloudflare and point your registrar's
     nameservers (or a CNAME per Cloudflare's partial-zone setup) at it.
     Custom Domains require the zone to be on Cloudflare; wrangler then manages
     the in-zone DNS record for the hostnames above automatically.
  2. Deploy — the routes bind on deploy:
       pnpm deploy:staging
       pnpm deploy:production
  3. Health checks probe the custom domain automatically (scripts/deploy.ts
     reads it from wrangler.toml); override with HEALTH_URL if needed.

Note: once these routes exist, \`wrangler deploy\` expects the zone to be on
Cloudflare — run this when you're ready to wire the domain, not before.`);
}

export function main(args = process.argv.slice(2), root = defaultRoot()): void {
	const [domain, apiSubdomain] = args.filter((a) => !a.startsWith("--"));
	if (!domain) {
		console.error("Usage: pnpm set-domain <domain> [api-subdomain]");
		console.error("Example: pnpm set-domain acme.dev");
		process.exit(1);
	}
	try {
		setDomain({ domain, apiSubdomain, root });
	} catch (error) {
		console.error((error as Error).message);
		process.exit(1);
	}
}

if (path.basename(process.argv[1] ?? "") === "set-domain.ts") {
	main();
}
