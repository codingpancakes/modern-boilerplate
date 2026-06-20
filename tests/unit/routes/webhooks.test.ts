import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	WEBHOOK_TIMESTAMP_TOLERANCE_MS,
	verifyWorkosSignature,
} from "@/routes/webhooks";

const SECRET = "whsec_test_secret";
const NOW = 1_766_256_000_000;

function signatureFor(payload: string, timestamp = NOW): string {
	return createHmac("sha256", SECRET)
		.update(`${timestamp}.${payload}`)
		.digest("hex");
}

function headerFor(payload: string, timestamp = NOW): string {
	const signature = signatureFor(payload, timestamp);
	return `v1=${signature}, t=${timestamp}`;
}

describe("verifyWorkosSignature", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("accepts a valid WorkOS signature by key regardless of header order", () => {
		const payload = JSON.stringify({
			id: "evt_valid",
			event: "user.created",
			data: { id: "user_1" },
		});

		expect(verifyWorkosSignature(payload, headerFor(payload), SECRET)).toBe(true);
	});

	it("rejects when the raw payload bytes are mutated after signing", () => {
		const payload = '{"id":"evt_valid","event":"user.created","data":{}}';
		const mutatedPayload =
			'{"event":"user.created","id":"evt_valid","data":{}}';

		expect(
			verifyWorkosSignature(mutatedPayload, headerFor(payload), SECRET),
		).toBe(false);
	});

	it("rejects signatures outside the replay tolerance window", () => {
		const payload = JSON.stringify({ id: "evt_old", event: "user.created" });
		const expiredTimestamp = NOW - WEBHOOK_TIMESTAMP_TOLERANCE_MS - 1;

		expect(
			verifyWorkosSignature(
				payload,
				headerFor(payload, expiredTimestamp),
				SECRET,
			),
		).toBe(false);
	});

	it("rejects malformed headers", () => {
		const payload = JSON.stringify({ id: "evt_bad", event: "user.created" });

		for (const header of [
			"",
			`t=${NOW}`,
			`v1=${signatureFor(payload)}`,
			`t=${NOW}, v1=not-hex`,
			`${NOW}.${signatureFor(payload)}`,
		]) {
			expect(verifyWorkosSignature(payload, header, SECRET)).toBe(false);
		}
	});
});
