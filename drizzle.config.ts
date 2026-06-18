import * as dotenv from "dotenv";
import type { Config } from "drizzle-kit";

dotenv.config({ path: ".dev.vars" });

export default {
	schema: "./src/node/db/schema/index.ts",
	out: "./src/node/db/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL || "",
	},
	verbose: true,
	strict: true,
} satisfies Config;
