import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

async function nukeSchema() {
	const sql = neon(process.env.DATABASE_URL!);
	await sql`DROP SCHEMA public CASCADE`;
	await sql`CREATE SCHEMA public`;
	await sql`CREATE EXTENSION IF NOT EXISTS citext`;
	console.log("✅ Schema wiped, recreated clean, citext enabled");
}

nukeSchema().catch((e) => {
	console.error(e);
	process.exit(1);
});
