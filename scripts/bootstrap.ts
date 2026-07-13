#!/usr/bin/env tsx
/**
 * Provision the Cloudflare (and optionally Neon) resources a new project needs
 * before its first deploy, reading the exact resource NAMES from wrangler.toml
 * so there's no drift. Covers the previously-manual steps except the two that
 * genuinely can't be automated here (WorkOS app/webhook setup, and DNS at your
 * registrar).
 *
 * What it does, per stage:
 *   - creates the webhook queue + its dead-letter queue   (deploy fails without them)
 *   - creates the R2 images bucket
 *   - [--neon <project-id>] creates a Neon branch and writes DATABASE_URL into .env.<stage>
 *   - [--deploy] chains: sync-secrets → migrate (the STAGE DB, using DATABASE_URL
 *     from .env.<stage>) → deploy:<stage>
 *
 * All resource creation is idempotent — an "already exists" from the CLI is
 * treated as success, so re-running is safe.
 *
 * Usage:
 *   pnpm bootstrap <staging|production> [--dry-run] [--neon <project-id>] [--deploy]
 *
 * Inspect first: `pnpm bootstrap staging --dry-run` prints every command it
 * would run without executing anything.
 *
 * Prereqs the caller sets up once (can't be bootstrapped — chicken-and-egg):
 *   - `wrangler login` (or CLOUDFLARE_API_TOKEN) with account access
 *   - for --neon: `neonctl` installed + authenticated (NEON_API_KEY)
 * Still manual by nature (printed at the end): the R2 S3 API token (mint in the
 * dashboard → paste into .env.<stage>), WorkOS app/webhook, and DNS.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

type Stage = "staging" | "production";
type Logger = Pick<Console, "log" | "error">;

export interface StageResources {
	queues: string[]; // main + dlq (deduped)
	bucket: string;
}

export interface PlannedCommand {
	label: string;
	cmd: string;
	args: string[];
	/** An "already exists" failure is success (idempotent create). */
	tolerateExisting: boolean;
}

function defaultRoot(): string {
	return path.join(__dirname, "..");
}

/**
 * Read the queue + R2 bucket names for a stage straight out of wrangler.toml.
 * Names carry the stage suffix (`-staging` / `-production`), set by
 * init-project, so filtering by suffix reliably excludes the local + other-env
 * resources. Pure — no I/O.
 */
export function parseStageResources(toml: string, stage: Stage): StageResources {
	const suffix = `-${stage}`;
	const queues = new Set<string>();
	let bucket: string | undefined;

	for (const raw of toml.split("\n")) {
		const line = raw.trim();
		const queueMatch = line.match(/^queue\s*=\s*"([^"]+)"/);
		if (queueMatch?.[1]?.endsWith(suffix) && queueMatch[1].includes("webhooks")) {
			queues.add(queueMatch[1]);
		}
		const bucketMatch = line.match(/^bucket_name\s*=\s*"([^"]+)"/);
		if (bucketMatch?.[1]?.endsWith(suffix) && bucketMatch[1].includes("images")) {
			bucket = bucketMatch[1];
		}
	}

	if (queues.size === 0) {
		throw new Error(`No queues found for env.${stage} in wrangler.toml.`);
	}
	if (!bucket) {
		throw new Error(`No R2 bucket found for env.${stage} in wrangler.toml.`);
	}
	return { queues: [...queues].sort(), bucket };
}

/** Build the idempotent resource-creation commands. Pure. */
export function planCommands(resources: StageResources): PlannedCommand[] {
	const plan: PlannedCommand[] = resources.queues.map((queue) => ({
		label: `queue: ${queue}`,
		cmd: "wrangler",
		args: ["queues", "create", queue],
		tolerateExisting: true,
	}));
	plan.push({
		label: `R2 bucket: ${resources.bucket}`,
		cmd: "wrangler",
		args: ["r2", "bucket", "create", resources.bucket],
		tolerateExisting: true,
	});
	return plan;
}

function looksLikeAlreadyExists(output: string): boolean {
	return /already exists|already created|conflict|duplicate/i.test(output);
}

function runCommand(
	{ label, cmd, args, tolerateExisting }: PlannedCommand,
	logger: Logger,
): void {
	logger.log(`→ ${label}  (${cmd} ${args.join(" ")})`);
	try {
		execFileSync(cmd, args, { stdio: "pipe", encoding: "utf-8" });
		logger.log(`  ✅ created`);
	} catch (error) {
		const out = `${(error as { stdout?: string }).stdout ?? ""}${
			(error as { stderr?: string }).stderr ?? ""
		}`;
		if (tolerateExisting && looksLikeAlreadyExists(out)) {
			logger.log(`  ↷ already exists — skipping`);
			return;
		}
		throw new Error(`Failed: ${label}\n${out || (error as Error).message}`);
	}
}

/** Create the Neon branch for the stage and write DATABASE_URL into .env.<stage>. */
function provisionNeon(
	projectId: string,
	stage: Stage,
	root: string,
	dryRun: boolean,
	logger: Logger,
): void {
	const branch = `${stage}`;
	const createArgs = [
		"branches",
		"create",
		"--project-id",
		projectId,
		"--name",
		branch,
	];
	const connArgs = [
		"connection-string",
		"--project-id",
		projectId,
		"--branch",
		branch,
	];
	logger.log(`→ Neon branch: ${branch}  (neonctl ${createArgs.join(" ")})`);
	if (dryRun) {
		logger.log(`  (dry-run) would create branch and write DATABASE_URL`);
		return;
	}
	// Branch create is idempotent-tolerant (a branch may already exist).
	try {
		execFileSync("neonctl", createArgs, { stdio: "pipe", encoding: "utf-8" });
	} catch (error) {
		const out = `${(error as { stderr?: string }).stderr ?? ""}`;
		if (!looksLikeAlreadyExists(out)) throw error;
		logger.log(`  ↷ branch exists — reusing`);
	}
	const url = execFileSync("neonctl", connArgs, {
		stdio: "pipe",
		encoding: "utf-8",
	}).trim();
	writeEnvVar(path.join(root, `.env.${stage}`), "DATABASE_URL", url, logger);
}

/** Read a KEY's value from a .env file, or undefined if absent. */
function readEnvVar(file: string, key: string): string | undefined {
	if (!fs.existsSync(file)) return undefined;
	const line = fs
		.readFileSync(file, "utf-8")
		.split("\n")
		.find((l) => l.startsWith(`${key}=`));
	return line?.slice(key.length + 1).replace(/^["']|["']$/g, "") || undefined;
}

/** Replace (or note the absence of) a KEY=... line in a .env file. */
function writeEnvVar(
	file: string,
	key: string,
	value: string,
	logger: Logger,
): void {
	if (!fs.existsSync(file)) {
		logger.log(`  ⚠️  ${path.basename(file)} not found — set ${key} manually`);
		return;
	}
	const contents = fs.readFileSync(file, "utf-8");
	const re = new RegExp(`^${key}=.*$`, "m");
	const next = re.test(contents)
		? contents.replace(re, `${key}=${value}`)
		: `${contents.trimEnd()}\n${key}=${value}\n`;
	fs.writeFileSync(file, next);
	logger.log(`  ✅ wrote ${key} to ${path.basename(file)}`);
}

export interface BootstrapOptions {
	stage: Stage;
	dryRun?: boolean;
	neonProjectId?: string;
	deploy?: boolean;
	root?: string;
	logger?: Logger;
}

export function bootstrap(options: BootstrapOptions): void {
	const {
		stage,
		dryRun = false,
		neonProjectId,
		deploy = false,
		root = defaultRoot(),
		logger = console,
	} = options;

	const toml = fs.readFileSync(path.join(root, "wrangler.toml"), "utf-8");
	const resources = parseStageResources(toml, stage);
	const plan = planCommands(resources);

	logger.log(
		`Bootstrapping ${stage}${dryRun ? " (dry-run — nothing will run)" : ""}:\n`,
	);
	for (const command of plan) {
		if (dryRun) {
			logger.log(`→ ${command.label}  (${command.cmd} ${command.args.join(" ")})`);
		} else {
			runCommand(command, logger);
		}
	}

	if (neonProjectId) {
		provisionNeon(neonProjectId, stage, root, dryRun, logger);
	}

	if (deploy && !dryRun) {
		logger.log(`\n→ sync-secrets + migrate + deploy (${stage})`);
		execFileSync("pnpm", ["sync-secrets", stage], { stdio: "inherit" });

		// migrate the STAGE database, not local. `pnpm migrate` reads .dev.vars by
		// default; force the stage's DATABASE_URL (from .env.<stage>, which --neon
		// may have just written) so we never migrate the wrong DB.
		const stageDbUrl = readEnvVar(path.join(root, `.env.${stage}`), "DATABASE_URL");
		if (stageDbUrl) {
			execFileSync("pnpm", ["migrate"], {
				stdio: "inherit",
				env: { ...process.env, DATABASE_URL: stageDbUrl },
			});
		} else {
			logger.log(
				`  ⚠️  no DATABASE_URL in .env.${stage} — skipping migrate; run it manually against the ${stage} DB before serving traffic`,
			);
		}

		execFileSync("pnpm", [`deploy:${stage}`], { stdio: "inherit" });
	}

	logger.log(`
Done. Still manual (by nature):
  • R2 S3 API token — Cloudflare dashboard → R2 → Manage API Tokens → create,
    then put R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in .env.${stage}
    (credential-minting, so left manual on purpose).${
			neonProjectId
				? ""
				: "\n  • DATABASE_URL — create a Neon branch (or pass --neon <project-id>)."
		}
  • WorkOS app + webhook endpoint/secret.
  • DNS — point your registrar at Cloudflare (see docs/CLOUDFLARE_SETUP.md §7f).
${deploy ? "" : `\nNext: pnpm sync-secrets ${stage} && pnpm migrate && pnpm deploy:${stage}`}`);
}

export function main(args = process.argv.slice(2), root = defaultRoot()): void {
	const positional = args.filter((a) => !a.startsWith("--"));
	const stage = positional[0] as Stage;
	if (stage !== "staging" && stage !== "production") {
		console.error(
			"Usage: pnpm bootstrap <staging|production> [--dry-run] [--neon <project-id>] [--deploy]",
		);
		process.exit(1);
	}
	const neonIndex = args.indexOf("--neon");
	const neonProjectId = neonIndex >= 0 ? args[neonIndex + 1] : undefined;
	if (neonIndex >= 0 && !neonProjectId) {
		console.error("--neon requires a Neon project id.");
		process.exit(1);
	}

	try {
		bootstrap({
			stage,
			dryRun: args.includes("--dry-run"),
			neonProjectId,
			deploy: args.includes("--deploy"),
			root,
		});
	} catch (error) {
		console.error((error as Error).message);
		process.exit(1);
	}
}

if (path.basename(process.argv[1] ?? "") === "bootstrap.ts") {
	main();
}
