import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import { confirmDestructiveDb } from "./lib/destructive-db-guard";

// Load environment variables
dotenv.config({ path: ".dev.vars" });

async function resetDatabase() {
	await confirmDestructiveDb(process.env.DATABASE_URL);
	const sql = neon(process.env.DATABASE_URL!);

	console.log("🗑️  Dropping public schema...");

	try {
		// Drop and recreate schema
		await sql`DROP SCHEMA public CASCADE`;
		console.log("✅ Dropped public schema");

		await sql`CREATE SCHEMA public`;
		console.log("✅ Created new public schema");

		// Enable required extensions
		await sql`CREATE EXTENSION IF NOT EXISTS "citext"`;
		console.log("✅ Enabled citext extension");

		// Note: tstzrange is a built-in PostgreSQL type, no extension needed

		// Restore basic permissions (skip postgres role since it doesn't exist in Neon)
		await sql`GRANT ALL ON SCHEMA public TO public`;
		await sql`GRANT USAGE ON SCHEMA public TO public`;
		console.log("✅ Restored schema permissions");

		console.log("🎉 Database reset complete!");
	} catch (error) {
		console.error("❌ Database reset failed:", error);
		process.exit(1);
	}
}

resetDatabase();
