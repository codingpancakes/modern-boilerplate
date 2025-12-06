import { describe, it, expect } from "vitest";
import { z } from "zod";
import { uploadImageRequest, uploadImageDirectRequest, listImagesQuery } from "@/lib/validation/media";

describe("Media Validation Schemas", () => {
	describe("uploadImageRequest", () => {
		it("should validate correct upload image request", () => {
			const validData = {
				filename: "test-image.jpg",
				contentType: "image/jpeg",
				category: "avatars",
				fileSize: 1024000,
			};

			const result = uploadImageRequest.safeParse(validData);
			expect(result.success).toBe(true);
		});

		it("should reject invalid content type", () => {
			const invalidData = {
				filename: "test.exe",
				contentType: "application/exe",
			};

			const result = uploadImageRequest.safeParse(invalidData);
			expect(result.success).toBe(false);
		});

		it("should reject empty filename", () => {
			const invalidData = {
				filename: "",
				contentType: "image/jpeg",
			};

			const result = uploadImageRequest.safeParse(invalidData);
			expect(result.success).toBe(false);
		});

		it("should accept optional category", () => {
			const validData = {
				filename: "test.png",
				contentType: "image/png",
			};

			const result = uploadImageRequest.safeParse(validData);
			expect(result.success).toBe(true);
		});
	});

	describe("uploadImageDirectRequest", () => {
		it("should validate correct direct upload request", () => {
			const validData = {
				filename: "avatar.png",
				contentType: "image/png",
				imageData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
				category: "profiles",
			};

			const result = uploadImageDirectRequest.safeParse(validData);
			expect(result.success).toBe(true);
		});

		it("should reject empty image data", () => {
			const invalidData = {
				filename: "test.jpg",
				contentType: "image/jpeg",
				imageData: "",
			};

			const result = uploadImageDirectRequest.safeParse(invalidData);
			expect(result.success).toBe(false);
		});
	});

	describe("listImagesQuery", () => {
		it("should validate correct list query", () => {
			const validData = {
				limit: 20,
				prefix: "avatars",
			};

			const result = listImagesQuery.safeParse(validData);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.limit).toBe(20);
			}
		});

		it("should use default limit if not provided", () => {
			const validData = {};

			const result = listImagesQuery.safeParse(validData);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.limit).toBe(20);
			}
		});

		it("should reject limit over 100", () => {
			const invalidData = {
				limit: 150,
			};

			const result = listImagesQuery.safeParse(invalidData);
			expect(result.success).toBe(false);
		});

		it("should reject limit under 1", () => {
			const invalidData = {
				limit: 0,
			};

			const result = listImagesQuery.safeParse(invalidData);
			expect(result.success).toBe(false);
		});

		it("should coerce string limit to number", () => {
			const validData = {
				limit: "25",
			};

			const result = listImagesQuery.safeParse(validData);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.limit).toBe(25);
				expect(typeof result.data.limit).toBe("number");
			}
		});
	});
});
