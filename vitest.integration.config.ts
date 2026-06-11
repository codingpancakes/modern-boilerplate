import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a REAL Postgres and are kept separate from the
 * fast unit suite (vitest.config.ts) so `pnpm check` / CI stay DB-free.
 *
 * Run locally with:
 *   pnpm test:integration:local   (starts the disposable postgres-test service)
 * Or, if the test DB is already up:
 *   pnpm test:integration
 * Or point at any Postgres via TEST_DATABASE_URL.
 */
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["tests/integration/**/*.test.ts"],
		// A real DB + migrations need more headroom than unit tests, and the
		// suites share tables, so don't run files in parallel.
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src/node"),
		},
	},
});
