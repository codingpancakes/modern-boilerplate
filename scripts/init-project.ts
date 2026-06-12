#!/usr/bin/env tsx
/**
 * Spin off a new project from this boilerplate.
 *
 * Generates .env.local / .env.staging / .env.production and sets the
 * package.json name. PROJECT_NAME drives resource naming and the generated
 * API docs; the stage env files feed `pnpm sync-secrets <stage>` (which
 * pushes secret values to Cloudflare via `wrangler secret put`).
 *
 * Usage:
 *   pnpm init-project <project-name> <domain> [options]
 *
 * Example:
 *   pnpm init-project acme-api acme.dev --github-owner acme
 *
 * Options:
 *   --github-owner <owner>    GitHub user/org for CI
 *   --github-repo <repo>      GitHub repo name (default: <project-name>)
 *   --force                   overwrite existing .env files
 *
 * Remember to also update wrangler.toml: worker names, [vars] placeholders
 * (CORS origins, IMAGES_CDN_URL), and the R2 bucket bindings.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flag = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
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

const githubOwner = flag("github-owner") ?? "your-github-username";
const githubRepo = flag("github-repo") ?? projectName;
const force = hasFlag("force");

const root = path.join(__dirname, "..");

function deployedEnv(stage: "staging" | "production"): string {
	const imagesHost =
		stage === "production" ? `images.${domain}` : `images-staging.${domain}`;
	const branch = stage === "production" ? "main" : "develop";
	return `# Identity
PROJECT_NAME=${projectName}
STAGE=${stage}

# Domain (drives the generated API docs)
HOSTED_ZONE_NAME=${domain}

# Media / Storage (Cloudflare R2)
IMAGES_BUCKET=${projectName}-${stage}-images
IMAGES_CDN_URL=https://${imagesHost}
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

# Auth (WorkOS)
WORKOS_CLIENT_ID=client_${stage}_xxx
WORKOS_WEBHOOK_SECRET=whsec_xxx

# Database (Neon)
DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require

# Monitoring
SENTRY_DSN=
SENTRY_ENVIRONMENT=${stage}

# GitHub (CI)
GITHUB_OWNER=${githubOwner}
GITHUB_REPO=${githubRepo}
GITHUB_BRANCH=${branch}
`;
}

const localEnv = `# Identity
PROJECT_NAME=${projectName}
STAGE=development

# Local Postgres (docker compose up -d postgres)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/serverless_db

# Auth (WorkOS)
WORKOS_CLIENT_ID=client_staging_xxx
`;

const files: Array<[string, string]> = [
	[".env.local", localEnv],
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

console.log(`
🎉 Project "${projectName}" initialized for ${domain}.

Next steps:
  1. Fill in the real values in .env.staging / .env.production:
     WORKOS_CLIENT_ID, WORKOS_WEBHOOK_SECRET, DATABASE_URL, SENTRY_DSN,
     and the R2 credentials
  2. Update wrangler.toml (worker names, [vars] placeholders, R2 buckets)
  3. cp .dev.vars.example .dev.vars  # local secrets for wrangler dev
  4. pnpm sync-secrets staging
  5. pnpm deploy:staging
  6. pnpm migrate
`);
