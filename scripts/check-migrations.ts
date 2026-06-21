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
	entries?: Array<{ tag?: string; when?: number }>;
};

function getDbUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL must be configured for migration preflight");
	}
	return url;
}

async function appliedMigrationTimestamps(databaseUrl: string): Promise<Set<string>> {
	try {
		const query = neon(databaseUrl);
		const rows = (await query`
			SELECT created_at::text AS created_at
			FROM drizzle.__drizzle_migrations
			ORDER BY created_at
		`) as Array<{ created_at?: string }>;
		return new Set(rows.map((row) => String(row.created_at)));
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "42P01" || code === "3F000") {
			return new Set();
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
	const expected = (journal.entries ?? []).map((entry) => {
		if (!entry.tag || !entry.when) {
			throw new Error("Migration journal entries must include tag and when");
		}
		return {
			tag: entry.tag,
			timestamp: String(entry.when),
		};
	});
	const appliedTimestamps = await appliedMigrationTimestamps(getDbUrl());
	const missing = expected.filter(
		(entry) => !appliedTimestamps.has(entry.timestamp),
	);

	if (missing.length > 0) {
		throw new Error(
			`Migration preflight failed: missing ${missing.length}/${expected.length} checked-in migrations (${missing.map((entry) => entry.tag).join(", ")}). Run pnpm migrate against the target database before deploy.`,
		);
	}

	console.log(
		`Migration preflight passed: ${expected.length}/${expected.length} checked-in migrations present (${appliedTimestamps.size} total applied rows)`,
	);
}

main().catch((error) => {
	console.error((error as Error).message);
	process.exit(1);
});
