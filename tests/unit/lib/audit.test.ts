import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below can close over them (vi.mock calls
// are hoisted above imports).
const { getDbMock, captureExceptionMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	captureExceptionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	getDb: getDbMock,
}));

vi.mock("@/lib/sentry", () => ({
	captureException: captureExceptionMock,
}));

// Silence the structured logger (it emits JSON lines via console.<level>) to
// keep the fallback error log out of test output.
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug() {},
		info() {},
		warn() {},
		error() {},
	}),
}));

import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	flushAudits,
	logAudit,
	runWithAuditScope,
} from "@/lib/audit";

const sampleEntry = {
	userId: "user-1",
	organizationId: "org-1",
	action: AUDIT_ACTIONS.CREATE,
	resourceType: AUDIT_RESOURCE_TYPES.USER,
	resourceId: "user-2",
};

describe("audit write failure signaling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// The failure-signal branch is skipped under NODE_ENV=test (vitest's
		// default); exercise the real production path.
		vi.stubEnv("NODE_ENV", "production");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("reports to Sentry when the DB write fails, without throwing", async () => {
		getDbMock.mockRejectedValue(new Error("connection refused"));

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();

		expect(captureExceptionMock).toHaveBeenCalledOnce();
	});

	it("reports to Sentry when the insert itself rejects", async () => {
		getDbMock.mockResolvedValue({
			insert: () => ({
				values: () => Promise.reject(new Error("relation does not exist")),
			}),
		});

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();

		expect(captureExceptionMock).toHaveBeenCalledOnce();
	});

	it("does not report when the write succeeds", async () => {
		getDbMock.mockResolvedValue({
			insert: () => ({
				values: () => Promise.resolve(),
			}),
		});

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();

		expect(captureExceptionMock).not.toHaveBeenCalled();
	});

	it("stays silent (no Sentry) under NODE_ENV=test", async () => {
		vi.stubEnv("NODE_ENV", "test");
		getDbMock.mockRejectedValue(new Error("connection refused"));

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();

		expect(captureExceptionMock).not.toHaveBeenCalled();
	});
});

/**
 * Regression: the audit buffer must be PER-REQUEST (AsyncLocalStorage), not a
 * module-global set. A module-global buffer on Workers couples concurrent
 * requests — one request's flush awaits (and head-of-line-blocks on) another's
 * audit writes. These lock in the scoped behavior.
 */
describe("per-request audit scope", () => {
	beforeEach(() => vi.clearAllMocks());

	/** A getDb whose insert resolves only when the returned trigger is called. */
	function deferredDb() {
		let resolve!: () => void;
		const gate = new Promise<void>((r) => {
			resolve = r;
		});
		getDbMock.mockResolvedValue({
			insert: () => ({ values: () => gate }),
		});
		return resolve;
	}

	it("flushAudits awaits writes started in the same scope", async () => {
		const completeWrite = deferredDb();

		await runWithAuditScope(async () => {
			void logAudit(sampleEntry); // fire-and-forget into this scope's buffer
			let flushed = false;
			const flush = flushAudits().then(() => {
				flushed = true;
			});
			await Promise.resolve(); // let microtasks settle
			expect(flushed).toBe(false); // still waiting on the pending write
			completeWrite();
			await flush;
			expect(flushed).toBe(true);
		});
	});

	it("one scope's flush does NOT wait on another scope's pending write", async () => {
		const completeA = deferredDb();

		// Scope A starts a write but never flushes; the write stays pending.
		await runWithAuditScope(async () => {
			void logAudit(sampleEntry);
		});

		// Scope B has no writes — its flush must return immediately, not block
		// on A's still-pending write (the head-of-line-blocking we fixed).
		await runWithAuditScope(async () => {
			await expect(flushAudits()).resolves.toBeUndefined();
		});

		completeA(); // cleanup the dangling write
	});

	it("outside any scope, logAudit awaits inline and flushAudits is a no-op", async () => {
		getDbMock.mockResolvedValue({
			insert: () => ({ values: () => Promise.resolve() }),
		});

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();
		await expect(flushAudits()).resolves.toBeUndefined();
	});
});
