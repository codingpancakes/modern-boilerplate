import type {
	ExecutionContext,
	Message,
	MessageBatch,
} from "@cloudflare/workers-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below can close over them (vi.mock calls
// are hoisted above imports).
const {
	processWorkosEventMock,
	runWithDbScopeMock,
	runWithAuditScopeMock,
	flushAuditsMock,
	captureExceptionMock,
	logAuditStrictMock,
} = vi.hoisted(() => ({
	processWorkosEventMock: vi.fn(),
	// Pass-through: invoke the wrapped fn so the real call path is exercised.
	runWithDbScopeMock: vi.fn((fn: () => Promise<unknown>) => fn()),
	runWithAuditScopeMock: vi.fn((fn: () => Promise<unknown>) => fn()),
	flushAuditsMock: vi.fn(() => Promise.resolve()),
	captureExceptionMock: vi.fn(),
	logAuditStrictMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/services/webhook-processor", () => ({
	processWorkosEvent: processWorkosEventMock,
}));

vi.mock("@/lib/db", () => ({
	runWithDbScope: runWithDbScopeMock,
}));

vi.mock("@/lib/sentry", () => ({
	captureException: captureExceptionMock,
}));

// The audit module is consumed both for `logAudit` and for the AUDIT_* enums
// the dead-letter handler references; keep the real enums, mock only the write.
vi.mock("@/lib/audit", () => ({
	logAuditStrict: logAuditStrictMock,
	runWithAuditScope: runWithAuditScopeMock,
	flushAudits: flushAuditsMock,
	AUDIT_ACTIONS: { WEBHOOK_FAILED: "WEBHOOK_FAILED" },
	AUDIT_RESOURCE_TYPES: { WEBHOOK: "WEBHOOK" },
	AUDIT_STATUS: { FAILURE: "FAILURE" },
}));

// Silence the structured logger (it emits JSON lines via console.<level>).
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug() {},
		info() {},
		warn() {},
		error() {},
	}),
}));

import type { WorkOSWebhookEvent } from "@/lib/validation/webhooks";
import { handleQueueBatch } from "@/queue";

const env = {} as Parameters<typeof handleQueueBatch>[1];
const ctx = {} as ExecutionContext;

function event(id: string): WorkOSWebhookEvent {
	return {
		id,
		event: "user.created",
		data: { id: "user_x", email: "x@example.com" },
		created_at: "2026-06-14T00:00:00Z",
	};
}

/** A queue Message with spy ack()/retry() and a fixed body. */
function fakeMessage(body: WorkOSWebhookEvent): Message<WorkOSWebhookEvent> {
	return {
		id: `msg-${body.id}`,
		timestamp: new Date(),
		body,
		attempts: 1,
		ack: vi.fn(),
		retry: vi.fn(),
	} as unknown as Message<WorkOSWebhookEvent>;
}

/** A MessageBatch with a given queue name and messages. */
function fakeBatch(
	queue: string,
	messages: Message<WorkOSWebhookEvent>[],
): MessageBatch<WorkOSWebhookEvent> {
	return {
		queue,
		messages,
		ackAll: vi.fn(),
		retryAll: vi.fn(),
	} as unknown as MessageBatch<WorkOSWebhookEvent>;
}

beforeEach(() => {
	vi.clearAllMocks();
	runWithDbScopeMock.mockImplementation((fn: () => Promise<unknown>) => fn());
	runWithAuditScopeMock.mockImplementation((fn: () => Promise<unknown>) =>
		fn(),
	);
	flushAuditsMock.mockResolvedValue(undefined);
	logAuditStrictMock.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("handleQueueBatch — main webhook queue", () => {
	it("acks a message whose processWorkosEvent resolves (no retry)", async () => {
		processWorkosEventMock.mockResolvedValue(undefined);
		const message = fakeMessage(event("evt_ok"));
		const batch = fakeBatch("sidedoor-webhooks-staging", [message]);

		await handleQueueBatch(batch, env, ctx);

		expect(processWorkosEventMock).toHaveBeenCalledOnce();
		expect(runWithAuditScopeMock).toHaveBeenCalledOnce();
		expect(flushAuditsMock).toHaveBeenCalledOnce();
		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
	});

	it("does not ack until the queue audit scope has flushed", async () => {
		processWorkosEventMock.mockResolvedValue(undefined);
		let completeFlush!: () => void;
		flushAuditsMock.mockReturnValue(
			new Promise<void>((resolve) => {
				completeFlush = resolve;
			}),
		);
		const message = fakeMessage(event("evt_waits_for_audit"));
		const batch = fakeBatch("sidedoor-webhooks-staging", [message]);

		const handling = handleQueueBatch(batch, env, ctx);
		await Promise.resolve();

		expect(processWorkosEventMock).toHaveBeenCalledOnce();
		expect(flushAuditsMock).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();

		completeFlush();
		await handling;

		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
	});

	it("retries a message whose processWorkosEvent rejects (no ack)", async () => {
		processWorkosEventMock.mockRejectedValue(new Error("transient db error"));
		const message = fakeMessage(event("evt_fail"));
		const batch = fakeBatch("sidedoor-webhooks-staging", [message]);

		await handleQueueBatch(batch, env, ctx);

		expect(message.retry).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();
	});

	it("isolates per-message failures: a throw on the first still processes the second", async () => {
		processWorkosEventMock
			.mockRejectedValueOnce(new Error("boom on first"))
			.mockResolvedValueOnce(undefined);

		const first = fakeMessage(event("evt_first"));
		const second = fakeMessage(event("evt_second"));
		const batch = fakeBatch("sidedoor-webhooks-staging", [first, second]);

		await handleQueueBatch(batch, env, ctx);

		// First failed: retried, not acked.
		expect(first.retry).toHaveBeenCalledOnce();
		expect(first.ack).not.toHaveBeenCalled();
		// Second still ran and was acked.
		expect(processWorkosEventMock).toHaveBeenCalledTimes(2);
		expect(second.ack).toHaveBeenCalledOnce();
		expect(second.retry).not.toHaveBeenCalled();
	});
});

describe("handleQueueBatch — dead-letter queue", () => {
	it("captures, audits, then acks a permanently failed message", async () => {
		const message = fakeMessage(event("evt_dead"));
		const batch = fakeBatch("sidedoor-webhooks-dlq-staging", [message]);

		await handleQueueBatch(batch, env, ctx);

		// Permanent failures are NOT reprocessed through processWorkosEvent.
		expect(processWorkosEventMock).not.toHaveBeenCalled();
		expect(captureExceptionMock).toHaveBeenCalledOnce();
		expect(logAuditStrictMock).toHaveBeenCalledOnce();
		expect(logAuditStrictMock).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "WEBHOOK_FAILED",
				resourceType: "WEBHOOK",
				resourceId: "evt_dead",
				status: "FAILURE",
			}),
		);
		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
	});

	it("retries (does NOT silently ack) when the dead-letter audit write throws", async () => {
		// A DB blip on the audit write must not drop the compliance record.
		logAuditStrictMock.mockRejectedValue(new Error("audit write failed"));
		const message = fakeMessage(event("evt_dead_fail"));
		const batch = fakeBatch("sidedoor-webhooks-dlq-staging", [message]);

		await handleQueueBatch(batch, env, ctx);

		expect(message.retry).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();
	});
});
