#!/usr/bin/env tsx
/**
 * Spin off a new project from this boilerplate.
 *
 * Generates .env.local / .env.staging / .env.production from the canonical
 * template (docs/BOILERPLATE_SETUP.md §5) and sets the package.json name.
 * PROJECT_NAME drives ALL AWS resource naming ({PROJECT_NAME}-{STAGE}-*),
 * so this one command is the whole rename.
 *
 * Usage:
 *   pnpm init-project <project-name> <domain> [options]
 *
 * Example:
 *   pnpm init-project acme-api acme.dev --region us-east-1 --email ops@acme.dev
 *
 * Options:
 *   --region <aws-region>     default: us-east-1
 *   --account <aws-account>   12-digit AWS account id (placeholder if omitted)
 *   --email <alert-email>     CloudWatch alarm destination
 *   --github-owner <owner>    GitHub user/org for the CI pipeline
 *   --github-repo <repo>      GitHub repo name (default: <project-name>)
 *   --force                   overwrite existing .env files
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
	console.error("Example: pnpm init-project acme-api acme.dev --email ops@acme.dev");
	process.exit(1);
}

// S3 bucket and CloudFormation stack names are derived from PROJECT_NAME —
// enforce a charset that is safe for both.
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

const region = flag("region") ?? "us-east-1";
const account = flag("account") ?? "YOUR_12_DIGIT_AWS_ACCOUNT_ID";
const email = flag("email") ?? `you@${domain}`;
const githubOwner = flag("github-owner") ?? "your-github-username";
const githubRepo = flag("github-repo") ?? projectName;
const force = hasFlag("force");

const root = path.join(__dirname, "..");

function deployedEnv(stage: "staging" | "production"): string {
	const apiHost = stage === "production" ? `api.${domain}` : `api-staging.${domain}`;
	const imagesHost =
		stage === "production" ? `images.${domain}` : `images-staging.${domain}`;
	const branch = stage === "production" ? "main" : "develop";
	return `# Identity
PROJECT_NAME=${projectName}
STAGE=${stage}

# AWS
AWS_REGION=${region}
CDK_DEFAULT_ACCOUNT=${account}

# Domain
HOSTED_ZONE_NAME=${domain}
HOSTED_ZONE_ID=Z0123456789YOURID
API_DOMAIN=${apiHost}

# Media / Storage
IMAGES_BUCKET=${projectName}-${stage}-images
IMAGES_CDN_URL=https://${imagesHost}

# CORS
CORS_DOMAIN_PATTERNS=*.${domain},localhost:*

# Auth (WorkOS)
WORKOS_CLIENT_ID=client_${stage}_xxx
WORKOS_WEBHOOK_SECRET=whsec_xxx

# Database (Neon)
DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require

# Security — CloudFront origin verification (generate: openssl rand -hex 32)
ORIGIN_VERIFY_SECRET=

# Monitoring
ALERT_EMAIL=${email}
SENTRY_DSN=
SENTRY_ENVIRONMENT=${stage}

# GitHub (required for CDK to synthesize the pipeline stack)
GITHUB_OWNER=${githubOwner}
GITHUB_REPO=${githubRepo}
GITHUB_BRANCH=${branch}
`;
}

const localEnv = `# Identity
PROJECT_NAME=${projectName}
STAGE=development

# AWS
AWS_REGION=${region}

# Local Postgres (docker compose up -d postgres)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/serverless_db

# Auth (WorkOS) — required by local-dev/server.ts
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
		console.log(`⏭️  ${name} already exists — skipping (use --force to overwrite)`);
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

Next steps (full guide: docs/BOILERPLATE_SETUP.md):
  1. Fill in the real values in .env.staging / .env.production:
     WORKOS_CLIENT_ID, WORKOS_WEBHOOK_SECRET, DATABASE_URL, HOSTED_ZONE_ID,
     CDK_DEFAULT_ACCOUNT, SENTRY_DSN, and ORIGIN_VERIFY_SECRET (openssl rand -hex 32)
  2. cdk bootstrap aws://<account>/${region}
  3. pnpm sync-secrets staging
  4. pnpm deploy:staging
  5. pnpm migrate
`);
