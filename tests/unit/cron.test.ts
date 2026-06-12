import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spies must be hoisted so the vi.mock factories below can close over them
// (vi.mock calls are hoisted above imports).
const { cleanupExpiredKeysMock, cleanupExpiredAuditLogsMock } = vi.hoisted(
	() => ({
		cleanupExpiredKeysMock: vi.fn(() => Promise.resolve(0)),
		cleanupExpiredAuditLogsMock: vi.fn(() => Promise.resolve(0)),
	}),
);

vi.mock("@/lib/idempotency", () => ({
	cleanupExpiredKeys: cleanupExpiredKeysMock,
}));

vi.mock("@/lib/audit", () => ({
	cleanupExpiredAuditLogs: cleanupExpiredAuditLogsMock,
}));

import type { ExecutionContext } from "@cloudflare/workers-types";
import { cronRegistry } from "@/cron";
import type { WorkerEnv } from "@/worker";

/**
 * Guards the Cron Trigger registry (src/node/cron.ts):
 *
 *   1. Registry keys are byte-identical to wrangler.toml `[triggers].crons`
 *      — `worker.scheduled` dispatches by `controller.cron`, so any drift
 *      means a trigger fires with no handler (a thrown invocation).
 *   2. Each expression maps to a callable job that awaits its cleanup work
 *      and propagates failures (failed-invocation visibility replaces the
 *      old EventBridge/DLQ alarms).
 */

const JANITOR_CRON = "0 4 * * *";
const AUDIT_RETENTION_CRON = "0 5 * * *";

const env = {} as WorkerEnv;
const ctx = {} as ExecutionContext;

function wranglerCrons(): string[] {
	const toml = readFileSync(resolve(process.cwd(), "wrangler.toml"), "utf8");
	const cronsArray = toml.match(/^crons\s*=\s*\[([\s\S]*?)\]/m);
	if (!cronsArray?.[1]) {
		throw new Error("wrangler.toml has no [triggers] crons array");
	}
	return [...cronsArray[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("cronRegistry", () => {
	beforeEach(() => {
		// Silence the job loggers' JSON lines in test output.
		vi.spyOn(console, "info").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		cleanupExpiredKeysMock.mockReset();
		cleanupExpiredAuditLogsMock.mockReset();
	});

	it("registers exactly the cron expressions declared in wrangler.toml [triggers]", () => {
		const declared = wranglerCrons();
		expect(declared.length).toBeGreaterThan(0);
		expect(Object.keys(cronRegistry).sort()).toEqual([...declared].sort());
	});

	it("maps every expression to a callable job", () => {
		for (const job of Object.values(cronRegistry)) {
			expect(typeof job).toBe("function");
		}
	});

	it("runs the idempotency janitor for the 4am trigger", async () => {
		cleanupExpiredKeysMock.mockResolvedValueOnce(7);

		await expect(cronRegistry[JANITOR_CRON](env, ctx)).resolves.toBeUndefined();

		expect(cleanupExpiredKeysMock).toHaveBeenCalledTimes(1);
		expect(cleanupExpiredAuditLogsMock).not.toHaveBeenCalled();
	});

	it("runs audit-log retention pruning for the 5am trigger", async () => {
		cleanupExpiredAuditLogsMock.mockResolvedValueOnce(3);

		await expect(
			cronRegistry[AUDIT_RETENTION_CRON](env, ctx),
		).resolves.toBeUndefined();

		expect(cleanupExpiredAuditLogsMock).toHaveBeenCalledTimes(1);
		expect(cleanupExpiredKeysMock).not.toHaveBeenCalled();
	});

	it("propagates janitor failures so the invocation is recorded as failed", async () => {
		cleanupExpiredKeysMock.mockRejectedValueOnce(new Error("db down"));

		await expect(cronRegistry[JANITOR_CRON](env, ctx)).rejects.toThrow(
			"db down",
		);
	});

	it("propagates audit-retention failures so the invocation is recorded as failed", async () => {
		cleanupExpiredAuditLogsMock.mockRejectedValueOnce(new Error("db down"));

		await expect(cronRegistry[AUDIT_RETENTION_CRON](env, ctx)).rejects.toThrow(
			"db down",
		);
	});
});
