#!/usr/bin/env tsx
/**
 * Spin off a new project from this boilerplate.
 *
 * Generates secrets-only .env.staging / .env.production, sets the package.json
 * name, and rewrites wrangler.toml resource names (Worker, R2 buckets, queues,
 * PROJECT_NAME, CORS origins, image CDN placeholders). The stage env files feed
 * `pnpm sync-secrets <stage>` (which pushes secret values to Cloudflare via
 * `wrangler secret put`). Local secrets live in .dev.vars.
 *
 * Usage:
 *   pnpm init-project <project-name> <domain> [--force]
 *
 * Example:
 *   pnpm init-project acme-api acme.dev
 *
 * Options:
 *   --force   overwrite existing .env files
 *
 * Afterward, create the named Cloudflare resources and replace the image CDN
 * placeholders with your real R2 public/custom-domain URLs.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const hasFlag = (name: string) => args.includes(`--${name}`);

const [projectName, domain] = positional;

if (!projectName || !domain) {
	console.error("Usage: pnpm init-project <project-name> <domain> [options]");
	console.error("Example: pnpm init-project acme-api acme.dev");
	process.exit(1);
}

// Worker and R2 bucket names are derived from PROJECT_NAME — enforce a
// charset that is safe for both.
if (!/^[a-z][a-z0-9-]{2,29}$/.test(projectName)) {
	console.error(
		"❌ Project name must be 3-30 chars, lowercase letters/digits/hyphens, starting with a letter.",
	);
	process.exit(1);
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
	console.error("❌ Domain doesn't look valid (expected e.g. acme.dev)");
	process.exit(1);
}

const force = hasFlag("force");

const root = path.join(__dirname, "..");

function stageForSection(section: string): "local" | "staging" | "production" {
	if (section.includes("env.staging")) return "staging";
	if (section.includes("env.production")) return "production";
	return "local";
}

function imageCdnUrl(stage: "local" | "staging" | "production"): string {
	if (stage === "production") return `https://images.${domain}`;
	return `https://images-${stage}.${domain}`;
}

function corsExactOrigin(stage: "local" | "staging" | "production"): string {
	if (stage === "local") return "http://localhost:3000";
	if (stage === "staging") return `https://staging.${domain}`;
	return `https://${domain}`;
}

function setTomlString(line: string, value: string): string {
	const match = line.match(/^(\s*[^=\s]+\s*=\s*)"[^"]*"(\s*(?:#.*)?)$/);
	if (!match) return line;
	return `${match[1]}"${value}"${match[2] ?? ""}`;
}

function rewriteWranglerToml(input: string): string {
	let section = "";
	const workerName = `${projectName}-backend`;

	return input
		.split("\n")
		.map((line) => {
			const trimmed = line.trim();
			if (/^\[+[^\]]+\]+$/.test(trimmed)) {
				section = trimmed;
			}

			if (!section && /^\s*name\s*=/.test(line)) {
				return setTomlString(line, workerName);
			}

			const stage = stageForSection(section);
			if (/^\s*PROJECT_NAME\s*=/.test(line)) {
				return setTomlString(line, projectName);
			}
			if (/^\s*CORS_EXACT_ORIGINS\s*=/.test(line)) {
				return setTomlString(line, corsExactOrigin(stage));
			}
			if (/^\s*CORS_PARENT_DOMAINS\s*=/.test(line)) {
				return setTomlString(line, "");
			}
			if (/^\s*IMAGES_BUCKET\s*=/.test(line)) {
				return setTomlString(line, `${projectName}-images-${stage}`);
			}
			if (/^\s*IMAGES_CDN_URL\s*=/.test(line)) {
				return setTomlString(line, imageCdnUrl(stage));
			}
			if (/^\s*bucket_name\s*=/.test(line) && section.includes("r2_buckets")) {
				return setTomlString(line, `${projectName}-images-${stage}`);
			}
			if (/^\s*queue\s*=/.test(line) && section.includes("queues")) {
				const suffix = line.includes("dlq") ? "webhooks-dlq" : "webhooks";
				return setTomlString(line, `${projectName}-${suffix}-${stage}`);
			}
			if (
				/^\s*dead_letter_queue\s*=/.test(line) &&
				section.includes("queues")
			) {
				return setTomlString(line, `${projectName}-webhooks-dlq-${stage}`);
			}
			return line;
		})
		.join("\n");
}

function deployedEnv(stage: "staging" | "production"): string {
	// Secrets only. Non-secret config (CORS, PROJECT_NAME, buckets, CDN URL)
	// lives in wrangler.toml. Keys must match the registry in .dev.vars.example.
	return `# .env.${stage} — pushed to the ${stage} Worker via 'pnpm sync-secrets ${stage}'.
# Secrets only; non-secret config lives in wrangler.toml. Registry: .dev.vars.example

# Required
DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require
WORKOS_CLIENT_ID=client_xxx
WORKOS_WEBHOOK_SECRET=whsec_xxx

# Feature-dependent (empty = feature off / clear error)
SENTRY_DSN=
TEST_API_KEY=
WEBHOOK_SECRET=

# R2 media — Cloudflare R2 Account API token; unset = media returns 503
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
`;
}

const files: Array<[string, string]> = [
	[".env.staging", deployedEnv("staging")],
	[".env.production", deployedEnv("production")],
];

for (const [name, content] of files) {
	const target = path.join(root, name);
	if (fs.existsSync(target) && !force) {
		console.log(
			`⏭️  ${name} already exists — skipping (use --force to overwrite)`,
		);
		continue;
	}
	fs.writeFileSync(target, content);
	console.log(`✅ Wrote ${name}`);
}

// Set package.json name so the repo identifies as the new project.
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
if (pkg.name !== projectName) {
	pkg.name = projectName;
	fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
	console.log(`✅ package.json name → "${projectName}"`);
}

// Rewrite Cloudflare resource names so a fresh project has no source-project
// residue in wrangler.toml.
const wranglerPath = path.join(root, "wrangler.toml");
const rewrittenWrangler = rewriteWranglerToml(
	fs.readFileSync(wranglerPath, "utf-8"),
);
fs.writeFileSync(wranglerPath, rewrittenWrangler);
console.log("✅ wrangler.toml resource names updated");

console.log(`
🎉 Project "${projectName}" initialized for ${domain}.

Next steps:
  1. cp .dev.vars.example .dev.vars   # local secrets for wrangler dev
  2. Fill real values in .dev.vars and .env.staging / .env.production:
     DATABASE_URL, WORKOS_CLIENT_ID, WORKOS_WEBHOOK_SECRET, and (optional)
     SENTRY_DSN, TEST_API_KEY, WEBHOOK_SECRET, R2 credentials
  3. Review wrangler.toml, then create the named R2 buckets and queues
  4. pnpm migrate                     # apply schema to the DB
  5. pnpm dev                         # wrangler dev --local
  6. pnpm sync-secrets staging && pnpm deploy:staging
`);
