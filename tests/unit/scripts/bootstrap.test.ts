import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseStageResources, planCommands } from "../../../scripts/bootstrap";

const repoRoot = path.resolve(__dirname, "../../..");
const baseToml = fs.readFileSync(path.join(repoRoot, "wrangler.toml"), "utf-8");

describe("parseStageResources", () => {
	it("extracts the stage's webhook queue, its DLQ, and the images bucket", () => {
		const staging = parseStageResources(baseToml, "staging");
		// Keep this project-name agnostic: init-project intentionally rewrites all
		// resource prefixes, while the stage/resource contracts remain stable.
		expect(staging.queues).toHaveLength(2);
		expect(staging.queues.every((q) => q.endsWith("-staging"))).toBe(true);
		expect(staging.queues.some((q) => q.includes("-webhooks-dlq-"))).toBe(true);
		expect(staging.queues.some((q) => q.includes("-webhooks-staging"))).toBe(
			true,
		);
		expect(staging.bucket).toMatch(/-images-staging$/);
	});

	it("does not pick up local or other-env resources", () => {
		const prod = parseStageResources(baseToml, "production");
		expect(prod.queues.every((q) => q.endsWith("-production"))).toBe(true);
		expect(prod.bucket.endsWith("-production")).toBe(true);
		expect(prod.queues.some((q) => q.endsWith("-staging"))).toBe(false);
		expect(prod.queues.some((q) => q.endsWith("-local"))).toBe(false);
	});
});

describe("planCommands", () => {
	it("plans idempotent wrangler creates for every queue + the bucket", () => {
		const plan = planCommands({
			queues: ["p-webhooks-dlq-staging", "p-webhooks-staging"],
			bucket: "p-images-staging",
		});

		expect(plan).toHaveLength(3);
		expect(plan.every((c) => c.cmd === "wrangler" && c.tolerateExisting)).toBe(
			true,
		);
		expect(plan.map((c) => c.args.join(" "))).toEqual([
			"queues create p-webhooks-dlq-staging",
			"queues create p-webhooks-staging",
			"r2 bucket create p-images-staging",
		]);
	});
});
