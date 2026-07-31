import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		env: {
			NODE_ENV: "test",
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/", "tests/", "**/*.d.ts", "**/*.config.ts"],
			// Regression RATCHET, not a quality target. These floors sit just below
			// current UNIT-only coverage; much of the codebase (services, routes,
			// idempotency) is exercised by the real-Postgres INTEGRATION suite,
			// which this run does not count — so true coverage is materially higher.
			// The point is structural: a PR that drops unit coverage fails CI
			// (`pnpm test:coverage`) instead of silently eroding it. Ratchet these
			// UP as coverage improves; never down without a note.
			thresholds: {
				statements: 45,
				branches: 40,
				functions: 43,
				lines: 45,
			},
		},
		include: ["tests/unit/**/*.test.ts"],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src/node"),
			// graphql ships dual CJS/ESM builds with no exports map. Vite-processed
			// app code loads the ESM build while externalized CJS deps (graphql-tools,
			// envelop) require() the CJS build — graphql-js then throws "Cannot use X
			// from another module or realm". Pin everything to one build under test.
			graphql: path.resolve(__dirname, "./node_modules/graphql/index.js"),
		},
	},
});
