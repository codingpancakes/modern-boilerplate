import * as readline from "node:readline";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Guard for scripts that DROP SCHEMA public CASCADE.
 *
 * - Local databases (localhost et al.) proceed without confirmation.
 * - Remote databases require the operator to type the exact hostname,
 *   or set DB_DESTRUCTIVE_CONFIRM=<hostname> for non-interactive use.
 *
 * Exits the process (code 1) if confirmation fails.
 */
export async function confirmDestructiveDb(
	databaseUrl: string | undefined,
): Promise<void> {
	if (!databaseUrl) {
		console.error("❌ DATABASE_URL is not set");
		process.exit(1);
	}

	let host: string;
	let dbName: string;
	try {
		const url = new URL(databaseUrl);
		host = url.hostname;
		dbName = url.pathname.replace(/^\//, "") || "(default)";
	} catch {
		console.error(
			"❌ DATABASE_URL is not a parseable URL — refusing to run a destructive operation against it",
		);
		process.exit(1);
	}

	if (LOCAL_HOSTS.has(host)) return;

	if (process.env.DB_DESTRUCTIVE_CONFIRM === host) {
		console.log(`⚠️  DB_DESTRUCTIVE_CONFIRM matched host "${host}" — proceeding`);
		return;
	}

	if (!process.stdin.isTTY) {
		console.error(
			`❌ Refusing to drop schema on remote host "${host}" in a non-interactive shell.`,
		);
		console.error(`   To override: DB_DESTRUCTIVE_CONFIRM=${host} <command>`);
		process.exit(1);
	}

	console.log("⚠️  This will DROP SCHEMA public CASCADE on a REMOTE database:");
	console.log(`     host:     ${host}`);
	console.log(`     database: ${dbName}`);

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const answer = await new Promise<string>((resolve) =>
		rl.question("   Type the host name to confirm: ", resolve),
	);
	rl.close();

	if (answer.trim() !== host) {
		console.error("❌ Confirmation did not match host — aborting.");
		process.exit(1);
	}
}
