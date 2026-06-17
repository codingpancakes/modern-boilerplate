#!/usr/bin/env tsx
/**
 * Health-gated gradual deploy with automatic rollback for Cloudflare Workers.
 *
 * Replaces the old AWS CodeDeploy blue-green canary (the one piece of deploy
 * safety the platform doesn't give us out of the box). Flow:
 *
 *   1. Record the currently-active version  (the rollback target)
 *   2. Upload the new version at 0% traffic  (`wrangler versions upload`)
 *   3. Canary: route CANARY_PERCENT of traffic to it, soak, probe health
 *   4. Promote to 100% and probe health again (the decisive, deterministic gate)
 *   5. Any health failure → redeploy the recorded version at 100% and exit 1
 *
 * First deploy (no prior version) skips the canary/rollback and just deploys 100%.
 *
 * Usage:  tsx scripts/deploy.ts <staging|production>
 * Wired:  pnpm deploy:staging | pnpm deploy:production
 *
 * Env overrides:
 *   HEALTH_URL        full health-check URL (default: derived per stage below)
 *   CANARY_PERCENT    canary traffic share, 1-99 (default 10)
 *   SOAK_SECONDS      seconds to hold the canary before promoting (default 20)
 *   HEALTH_ATTEMPTS   health probes per gate (default 5)
 */

import { execFileSync } from "node:child_process";

const stage = process.argv[2];
if (stage !== "staging" && stage !== "production") {
	console.error("Usage: tsx scripts/deploy.ts <staging|production>");
	process.exit(1);
}

// Default public health URLs per stage. Override with HEALTH_URL for custom
// domains. Keep in sync with the worker names/subdomain in wrangler.toml.
const DEFAULT_HEALTH_URL: Record<string, string> = {
	staging: "https://sidedoor-backend-staging.jon-e59.workers.dev",
	production: "https://sidedoor-backend-production.jon-e59.workers.dev",
};
const healthUrl = `${(process.env.HEALTH_URL || DEFAULT_HEALTH_URL[stage]).replace(/\/$/, "")}/v1/health/detailed`;
const canaryPercent = Number(process.env.CANARY_PERCENT || 10);
const soakSeconds = Number(process.env.SOAK_SECONDS || 20);
const healthAttempts = Number(process.env.HEALTH_ATTEMPTS || 5);

function wrangler(args: string[], capture = true): string {
	return execFileSync("npx", ["wrangler", ...args, "--env", stage], {
		encoding: "utf-8",
		stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
	});
}

/** Version ID currently serving 100% (or the first active split), or null on first deploy. */
function activeVersionId(): string | null {
	try {
		const out = wrangler(["deployments", "status", "--json"]);
		const json = JSON.parse(out);
		const versions: Array<{ version_id: string; percentage: number }> =
			json.versions ?? [];
		if (versions.length === 0) return null;
		// Prefer the highest-traffic version as the rollback target.
		versions.sort((a, b) => b.percentage - a.percentage);
		return versions[0].version_id;
	} catch {
		return null; // no prior deployment
	}
}

/**
 * Upload the new version (0% traffic) and return its ID. `versions upload`
 * has no --json mode, so parse the "Worker Version ID: <uuid>" line it prints.
 */
function uploadNewVersion(): string {
	const out = wrangler(["versions", "upload"]);
	const m = out.match(
		/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
	);
	if (!m) throw new Error("Could not determine uploaded version ID");
	return m[0];
}

function deploySplit(specs: string[]): void {
	wrangler(["versions", "deploy", ...specs, "--yes"], false);
}

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function healthy(): Promise<boolean> {
	for (let i = 1; i <= healthAttempts; i++) {
		try {
			const res = await fetch(healthUrl, {
				signal: AbortSignal.timeout(10_000),
			});
			const body = (await res.json()) as { data?: { status?: string } };
			if (res.status === 200 && body.data?.status === "healthy") {
				console.log(`   ✓ health probe ${i}/${healthAttempts} ok`);
				if (i >= 2) return true; // two consecutive successes
			} else {
				console.log(
					`   ✗ health probe ${i}: status ${res.status} / ${body.data?.status}`,
				);
				return false;
			}
		} catch (err) {
			console.log(`   ✗ health probe ${i}: ${(err as Error).message}`);
			if (i === healthAttempts) return false;
		}
		await sleep(2);
	}
	return true;
}

async function main() {
	console.log(`🚀 Deploying to ${stage} (health: ${healthUrl})`);

	const oldVersion = activeVersionId();
	console.log(`   current version: ${oldVersion ?? "(none — first deploy)"}`);

	console.log("📦 Uploading new version...");
	const newVersion = uploadNewVersion();
	console.log(`   new version: ${newVersion}`);

	// First deploy: nothing to roll back to — go straight to 100%.
	if (!oldVersion) {
		deploySplit([`${newVersion}@100`]);
		if (!(await healthy())) {
			console.error(
				"❌ First deploy is unhealthy. No prior version to roll back to — investigate manually.",
			);
			process.exit(1);
		}
		console.log("✅ First deploy healthy at 100%.");
		return;
	}

	// Canary: split traffic and soak.
	console.log(
		`🐤 Canary: ${newVersion}@${canaryPercent} / ${oldVersion}@${100 - canaryPercent}`,
	);
	deploySplit([
		`${newVersion}@${canaryPercent}`,
		`${oldVersion}@${100 - canaryPercent}`,
	]);
	console.log(`   soaking ${soakSeconds}s...`);
	await sleep(soakSeconds);

	if (!(await healthy())) {
		console.error("❌ Canary unhealthy — rolling back.");
		deploySplit([`${oldVersion}@100`]);
		console.error(`↩️  Rolled back to ${oldVersion}.`);
		process.exit(1);
	}

	// Promote to 100% and re-check (deterministic: every probe hits the new version).
	console.log("⬆️  Promoting to 100%...");
	deploySplit([`${newVersion}@100`]);

	if (!(await healthy())) {
		console.error("❌ Unhealthy at 100% — rolling back.");
		deploySplit([`${oldVersion}@100`]);
		console.error(`↩️  Rolled back to ${oldVersion}.`);
		process.exit(1);
	}

	console.log(
		`✅ Deployed ${newVersion} to ${stage} at 100% (rollback target was ${oldVersion}).`,
	);
}

main().catch((err) => {
	console.error("❌ Deploy failed:", (err as Error).message);
	process.exit(1);
});
