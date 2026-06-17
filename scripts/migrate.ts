// NOTE: This migration runner intentionally uses the `neon-http` driver.
// Unlike the application runtime (see src/node/lib/db.ts, which MUST use
// `neon-serverless` for interactive `db.transaction()` calls), drizzle's
// migrator runs each migration as its own statement batch and does not open an
// interactive transaction, so the lighter HTTP driver is correct here. Do NOT
// copy this import into application code.
import * as path from "node:path";
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

dotenv.config({ path: ".dev.vars" });

function getDbUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL must be configured");
	}
	return url;
}

async function runMigrations() {
	console.log("Starting database migrations...");

	try {
		// drizzle's neon-http adapter wants the widened NeonQueryFunction
		// generic; instantiate neon() with it directly (no casts).
		const sql = neon<boolean, boolean>(getDbUrl());
		const db = drizzle(sql);

		// The schema uses the `citext` type; enable it before migrating so a
		// brand-new database works without a separate setup step.
		await sql`CREATE EXTENSION IF NOT EXISTS citext`;

		await migrate(db, {
			migrationsFolder: path.join(__dirname, "../src/node/db/migrations"),
		});

		console.log("Migrations completed successfully");
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	}
}

runMigrations();
