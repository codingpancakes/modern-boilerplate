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
