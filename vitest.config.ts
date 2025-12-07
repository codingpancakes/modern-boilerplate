import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/",
				"tests/",
				"infrastructure/",
				"cdk.out/",
				"**/*.d.ts",
				"**/*.config.ts",
			],
		},
		include: ["tests/unit/**/*.test.ts"],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src/node"),
		},
	},
});
