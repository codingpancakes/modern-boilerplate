import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors";
import {
	getMediaConfig,
	getR2S3Config,
	requireR2S3Config,
	validateContentTypeExtension,
	validateImageMagicBytes,
} from "@/lib/media";

const R2_ENV = {
	IMAGES_BUCKET: "sidedoor-images-test",
	IMAGES_CDN_URL: "https://cdn.example.test",
	R2_ACCOUNT_ID: "acct123",
	R2_ACCESS_KEY_ID: "ak123",
	R2_SECRET_ACCESS_KEY: "sk123",
};

function stub(env: Record<string, string | undefined>) {
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined) vi.stubEnv(k, "");
		else vi.stubEnv(k, v);
	}
}

beforeEach(() => {
	// Start each test from a clean slate (no media env set).
	for (const k of Object.keys(R2_ENV)) vi.stubEnv(k, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("getMediaConfig", () => {
	it("returns bucket + cdn URL when both are set", () => {
		stub({ IMAGES_BUCKET: "b", IMAGES_CDN_URL: "https://cdn" });
		expect(getMediaConfig()).toEqual({
			bucketName: "b",
			cdnUrl: "https://cdn",
		});
	});

	// Regression: IMAGES_CDN_URL being unset used to surface as an opaque 503 on
	// every media call (the bug that made the first staging upload test fail).
	it("throws 503 MEDIA_STORAGE_NOT_CONFIGURED when IMAGES_CDN_URL is missing", () => {
		stub({ IMAGES_BUCKET: "b", IMAGES_CDN_URL: undefined });
		try {
			getMediaConfig();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			expect((err as ApiError).statusCode).toBe(503);
			expect((err as ApiError).code).toBe("MEDIA_STORAGE_NOT_CONFIGURED");
		}
	});

	it("throws when IMAGES_BUCKET is missing", () => {
		stub({ IMAGES_BUCKET: undefined, IMAGES_CDN_URL: "https://cdn" });
		expect(() => getMediaConfig()).toThrow(ApiError);
	});
});

describe("getR2S3Config", () => {
	it("returns null when any R2 credential is missing", () => {
		stub({ ...R2_ENV, R2_SECRET_ACCESS_KEY: undefined });
		expect(getR2S3Config()).toBeNull();
	});

	it("returns the full config when all credentials are set", () => {
		stub(R2_ENV);
		expect(getR2S3Config()).toEqual({
			accountId: "acct123",
			accessKeyId: "ak123",
			secretAccessKey: "sk123",
			bucket: "sidedoor-images-test",
		});
	});

	it("falls back to IMAGES_BUCKET when R2_BUCKET is unset", () => {
		stub({ ...R2_ENV, IMAGES_BUCKET: "fallback-bucket" });
		expect(getR2S3Config()?.bucket).toBe("fallback-bucket");
	});

	it("requireR2S3Config throws 503 when unconfigured", () => {
		expect(() => requireR2S3Config()).toThrow(ApiError);
	});
});

describe("image content validation", () => {
	it("accepts a matching content-type/extension pair", () => {
		expect(validateContentTypeExtension("image/png", "png")).toBe(true);
	});

	it("rejects a mismatched extension (spoofing guard)", () => {
		expect(validateContentTypeExtension("image/png", "exe")).toBe(false);
	});

	it("validates PNG magic bytes and rejects a spoofed buffer", () => {
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(validateImageMagicBytes(png, "image/png")).toBe(true);
		expect(
			validateImageMagicBytes(Buffer.from("not an image"), "image/png"),
		).toBe(false);
	});
});
