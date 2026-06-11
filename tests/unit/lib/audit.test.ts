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

// The powertools Logger writes straight to stdout (not console.*), so mock it
// to keep the fallback error log out of test output.
vi.mock("@aws-lambda-powertools/logger", () => ({
	Logger: class {
		debug() {}
		info() {}
		warn() {}
		error() {}
	},
}));

import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, logAudit } from "@/lib/audit";

const sampleEntry = {
	userId: "user-1",
	organizationId: "org-1",
	action: AUDIT_ACTIONS.CREATE,
	resourceType: AUDIT_RESOURCE_TYPES.USER,
	resourceId: "user-2",
};

/** Parse every console.log line and return the EMF payloads among them. */
function emittedMetrics(spy: { mock: { calls: unknown[][] } }) {
	return spy.mock.calls
		.map(([line]) => {
			try {
				return JSON.parse(String(line)) as Record<string, unknown>;
			} catch {
				return null;
			}
		})
		.filter(
			(parsed): parsed is Record<string, unknown> =>
				parsed !== null && "_aws" in parsed,
		);
}

describe("audit write failure metric", () => {
	let consoleLogSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

	beforeEach(() => {
		vi.clearAllMocks();
		// The metric/logging branch is skipped under NODE_ENV=test (vitest's
		// default); exercise the real production path.
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("PROJECT_NAME", "test-project");
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		consoleLogSpy.mockRestore();
	});

	it("emits an EMF AuditWriteFailure metric when the DB write fails, without throwing", async () => {
		getDbMock.mockRejectedValue(new Error("connection refused"));

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();

		const metrics = emittedMetrics(consoleLogSpy);
		expect(metrics).toHaveLength(1);

		const metric = metrics[0];
		expect(metric.AuditWriteFailure).toBe(1);
		expect(metric.Service).toBe("audit");
		expect(metric._aws).toMatchObject({
			CloudWatchMetrics: [
				{
					Namespace: "test-project",
					Dimensions: [["Service"]],
					Metrics: [{ Name: "AuditWriteFailure", Unit: "Count" }],
				},
			],
		});
		expect(captureExceptionMock).toHaveBeenCalledOnce();
	});

	it("emits the metric when the insert itself rejects", async () => {
		getDbMock.mockResolvedValue({
			insert: () => ({
				values: () => Promise.reject(new Error("relation does not exist")),
			}),
		});

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();

		expect(emittedMetrics(consoleLogSpy)).toHaveLength(1);
	});

	it("does not emit the metric when the write succeeds", async () => {
		getDbMock.mockResolvedValue({
			insert: () => ({
				values: () => Promise.resolve(),
			}),
		});

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();

		expect(emittedMetrics(consoleLogSpy)).toHaveLength(0);
		expect(captureExceptionMock).not.toHaveBeenCalled();
	});

	it("stays silent (no metric, no Sentry) under NODE_ENV=test", async () => {
		vi.stubEnv("NODE_ENV", "test");
		getDbMock.mockRejectedValue(new Error("connection refused"));

		await expect(logAudit(sampleEntry)).resolves.toBeUndefined();

		expect(emittedMetrics(consoleLogSpy)).toHaveLength(0);
		expect(captureExceptionMock).not.toHaveBeenCalled();
	});
});
