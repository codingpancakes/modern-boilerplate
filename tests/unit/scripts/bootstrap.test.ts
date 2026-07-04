import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	parseStageResources,
	planCommands,
} from "../../../scripts/bootstrap";

const repoRoot = path.resolve(__dirname, "../../..");
const baseToml = fs.readFileSync(path.join(repoRoot, "wrangler.toml"), "utf-8");

describe("parseStageResources", () => {
	it("extracts the stage's webhook queue, its DLQ, and the images bucket", () => {
		const staging = parseStageResources(baseToml, "staging");
		// main + dlq, deduped and sorted; both carry the -staging suffix.
		expect(staging.queues).toEqual([
			"replace-me-webhooks-dlq-staging",
			"replace-me-webhooks-staging",
		]);
		expect(staging.bucket).toBe("replace-me-images-staging");
	});

	it("does not pick up local or other-env resources", () => {
		const prod = parseStageResources(baseToml, "production");
		expect(prod.queues.every((q) => q.endsWith("-production"))).toBe(true);
		expect(prod.bucket.endsWith("-production")).toBe(true);
		expect(prod.queues).not.toContain("replace-me-webhooks-staging");
		expect(prod.queues).not.toContain("replace-me-webhooks-local");
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
