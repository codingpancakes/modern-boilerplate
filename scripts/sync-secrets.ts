#!/usr/bin/env tsx
/**
 * Push secrets to Cloudflare Workers via `wrangler secret put`.
 *
 * The secret NAMES come from `.dev.vars.example` (the single checked-in
 * registry of every secret the Worker reads); the VALUES come from the
 * stage's env file (`.env.staging` / `.env.production`, both gitignored).
 *
 * Usage:
 *   pnpm sync-secrets staging
 *   pnpm sync-secrets production
 *
 * Values are piped to wrangler over stdin so they never appear in argv,
 * `ps` output, or this script's logs. Non-secret config lives in
 * wrangler.toml [vars] and is deployed with the Worker, not synced here.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const stage = process.argv[2];

if (!stage || !["staging", "production"].includes(stage)) {
	console.error("❌ Usage: pnpm sync-secrets <staging|production>");
	process.exit(1);
}

/** Parse KEY=VALUE lines (ignoring comments/blanks) from an env-style file. */
function parseEnvFile(filePath: string): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const rawLine of fs.readFileSync(filePath, "utf-8").split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		// Strip a single layer of surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		vars[key] = value;
	}
	return vars;
}

const exampleFile = path.join(process.cwd(), ".dev.vars.example");
if (!fs.existsSync(exampleFile)) {
	console.error("❌ .dev.vars.example not found — it is the secret registry");
	process.exit(1);
}

const envFile = path.join(process.cwd(), `.env.${stage}`);
if (!fs.existsSync(envFile)) {
	console.error(`❌ File not found: ${envFile}`);
	process.exit(1);
}

// Every uncommented KEY in .dev.vars.example is a secret the Worker may read.
const secretNames = Object.keys(parseEnvFile(exampleFile));
const values = parseEnvFile(envFile);

console.log(
	`🔄 Syncing ${secretNames.length} secret(s) to Cloudflare (--env ${stage})...\n`,
);

let pushed = 0;
let skipped = 0;
let failed = 0;

for (const name of secretNames) {
	const value = values[name];
	if (!value) {
		console.log(`   ⏭️  ${name} — no value in .env.${stage}, skipped`);
		skipped++;
		continue;
	}

	// Value goes over stdin; only the NAME is on the command line.
	const result = spawnSync(
		"npx",
		["wrangler", "secret", "put", name, "--env", stage],
		{ input: value, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" },
	);

	if (result.status === 0) {
		console.log(`   ✅ ${name}`);
		pushed++;
	} else {
		// wrangler's stderr does not echo the piped secret value
		console.error(`   ❌ ${name} failed:\n${result.stderr}`);
		failed++;
	}
}

console.log("\n📋 Summary:");
console.log(`   Stage:   ${stage}`);
console.log(`   Pushed:  ${pushed}`);
console.log(`   Skipped: ${skipped}`);
console.log(`   Failed:  ${failed}`);
console.log("\n🔍 Verify with:");
console.log(`   npx wrangler secret list --env ${stage}`);

if (failed > 0) {
	process.exit(1);
}
