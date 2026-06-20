#!/usr/bin/env tsx
/**
 * Fail when the target database has not applied every checked-in Drizzle
 * migration. This is deliberately a preflight, not an auto-migration: deploy
 * rollback can revert Worker code, but it cannot undo a schema migration.
 */

import * as path from "node:path";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config({ path: ".dev.vars" });

type Journal = {
	entries?: Array<{ tag?: string }>;
};

function getDbUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL must be configured for migration preflight");
	}
	return url;
}

async function appliedMigrationCount(
	databaseUrl: string,
): Promise<number> {
	try {
		const query = neon(databaseUrl);
		const rows = (await query`
			SELECT count(*)::int AS count
			FROM drizzle.__drizzle_migrations
		`) as Array<{ count?: number | string }>;
		return Number((rows[0] as { count?: number | string } | undefined)?.count ?? 0);
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "42P01" || code === "3F000") {
			return 0;
		}
		throw error;
	}
}

async function main(): Promise<void> {
	const journalPath = path.join(
		__dirname,
		"../src/node/db/migrations/meta/_journal.json",
	);
	const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as Journal;
	const expected = journal.entries?.length ?? 0;
	const applied = await appliedMigrationCount(getDbUrl());

	if (applied !== expected) {
		const direction = applied < expected ? "pending" : "unexpected extra";
		throw new Error(
			`Migration preflight failed: ${applied}/${expected} migrations applied (${direction}). Run pnpm migrate against the target database before deploy.`,
		);
	}

	console.log(`Migration preflight passed: ${applied}/${expected} applied`);
}

main().catch((error) => {
	console.error((error as Error).message);
	process.exit(1);
});
