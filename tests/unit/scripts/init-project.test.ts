import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initProject } from "../../../scripts/init-project";

const repoRoot = path.resolve(__dirname, "../../..");
const noopLogger = { log() {} };

let tempRoot: string | undefined;

function makeTempProject(): string {
	tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "init-project-test-"));
	fs.writeFileSync(
		path.join(tempRoot, "package.json"),
		fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"),
	);
	fs.writeFileSync(
		path.join(tempRoot, "wrangler.toml"),
		fs.readFileSync(path.join(repoRoot, "wrangler.toml"), "utf-8"),
	);
	return tempRoot;
}

function expectTomlShape(toml: string): void {
	let inMultilineArray = false;
	for (const [index, rawLine] of toml.split("\n").entries()) {
		const lineNumber = index + 1;
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		if (inMultilineArray) {
			if (line === "]") {
				inMultilineArray = false;
				continue;
			}
			expect(line, `line ${lineNumber}`).toMatch(
				/^"[^"]+"(?:,\s*(?:#.*)?)?$/,
			);
			continue;
		}

		if (/^\[\[?[A-Za-z0-9_.]+\]\]?$/.test(line)) continue;

		const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
		expect(assignment, `line ${lineNumber}`).not.toBeNull();
		if (!assignment) continue;

		const value = assignment[2].trim();
		if (value === "[") {
			inMultilineArray = true;
			continue;
		}
		expect(
			(value.match(/"/g) ?? []).length % 2,
			`line ${lineNumber} has balanced quotes`,
		).toBe(0);
	}
	expect(inMultilineArray).toBe(false);
}

afterEach(() => {
	if (tempRoot) {
		fs.rmSync(tempRoot, { recursive: true, force: true });
		tempRoot = undefined;
	}
});

describe("initProject", () => {
	it("rewrites boilerplate resource names without corrupting wrangler.toml", () => {
		const root = makeTempProject();

		initProject({
			projectName: "acme-api",
			domain: "acme.dev",
			force: true,
			root,
			logger: noopLogger,
		});

		const pkg = JSON.parse(
			fs.readFileSync(path.join(root, "package.json"), "utf-8"),
		);
		const wrangler = fs.readFileSync(
			path.join(root, "wrangler.toml"),
			"utf-8",
		);

		expect(pkg.name).toBe("acme-api");
		expect(`${JSON.stringify(pkg)}\n${wrangler}`).not.toContain("sidedoor");
		expectTomlShape(wrangler);

		expect(wrangler).toMatch(/^name = "acme-api-backend"$/m);
		expect(wrangler.match(/name = "RATE_LIMITER"/g)).toHaveLength(3);

		for (const expected of [
			'PROJECT_NAME = "acme-api"',
			'CORS_EXACT_ORIGINS = "http://localhost:3000"',
			'CORS_EXACT_ORIGINS = "https://staging.acme.dev"',
			'CORS_EXACT_ORIGINS = "https://acme.dev"',
			'IMAGES_BUCKET = "acme-api-images-local"',
			'IMAGES_BUCKET = "acme-api-images-staging"',
			'IMAGES_BUCKET = "acme-api-images-production"',
			'IMAGES_CDN_URL = "https://images-local.acme.dev"',
			'IMAGES_CDN_URL = "https://images-staging.acme.dev"',
			'IMAGES_CDN_URL = "https://images.acme.dev"',
			'bucket_name = "acme-api-images-local"',
			'bucket_name = "acme-api-images-staging"',
			'bucket_name = "acme-api-images-production"',
			'queue = "acme-api-webhooks-local"',
			'queue = "acme-api-webhooks-staging"',
			'queue = "acme-api-webhooks-production"',
			'queue = "acme-api-webhooks-dlq-staging"',
			'queue = "acme-api-webhooks-dlq-production"',
			'dead_letter_queue = "acme-api-webhooks-dlq-staging"',
			'dead_letter_queue = "acme-api-webhooks-dlq-production"',
		]) {
			expect(wrangler).toContain(expected);
		}

		expect(fs.existsSync(path.join(root, ".env.staging"))).toBe(true);
		expect(fs.existsSync(path.join(root, ".env.production"))).toBe(true);
	});

	it("does not overwrite stage secret files unless force is set", () => {
		const root = makeTempProject();
		fs.writeFileSync(path.join(root, ".env.staging"), "KEEP_ME=1\n");

		initProject({
			projectName: "acme-api",
			domain: "acme.dev",
			root,
			logger: noopLogger,
		});

		expect(fs.readFileSync(path.join(root, ".env.staging"), "utf-8")).toBe(
			"KEEP_ME=1\n",
		);
		expect(
			fs.readFileSync(path.join(root, ".env.production"), "utf-8"),
		).toContain("WORKOS_CLIENT_ID=client_xxx");
	});
});
