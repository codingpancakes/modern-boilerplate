import { describe, expect, it } from "vitest";
import { sanitizeObject } from "@/lib/sanitize";

describe("sanitizeObject", () => {
	it("HTML-escapes string values to prevent XSS", () => {
		const out = sanitizeObject({ name: "<script>alert(1)</script>" });
		expect(out.name).not.toContain("<script>");
		expect(out.name).toContain("&lt;");
	});

	it("treats URL-bearing keys as raw and blocks dangerous schemes", () => {
		const out = sanitizeObject({
			photoUrl: "javascript:alert(1)",
			website_url: "https://example.com/x",
			redirectUrl: "http://example.com/insecure",
		});
		// javascript: scheme is stripped to empty; valid https URL is preserved
		expect(out.photoUrl).toBe("");
		expect(out.website_url).toBe("https://example.com/x");
		expect(out.redirectUrl).toBe("");
	});

	it("recurses into nested objects and arrays", () => {
		const out = sanitizeObject({
			profile: { bio: "<b>x</b>" },
			tags: ["<i>a</i>", "b"],
		}) as { profile: { bio: string }; tags: string[] };
		expect(out.profile.bio).not.toContain("<b>");
		expect(out.tags[0]).not.toContain("<i>");
		expect(out.tags[1]).toBe("b");
	});

	it("preserves array structure for arrays-of-arrays", () => {
		const out = sanitizeObject({ matrix: [["<x>", "y"], ["z"]] }) as {
			matrix: string[][];
		};
		expect(Array.isArray(out.matrix)).toBe(true);
		expect(Array.isArray(out.matrix[0])).toBe(true);
		expect(out.matrix[0][0]).not.toContain("<x>");
		expect(out.matrix[1][0]).toBe("z");
	});

	it("is depth-bounded: deeply nested input does not blow the stack", () => {
		// Build a pathologically deep object well beyond the recursion cap.
		let deep: Record<string, unknown> = { value: "<script>x</script>" };
		for (let i = 0; i < 5000; i++) {
			deep = { nested: deep };
		}

		expect(() => sanitizeObject(deep)).not.toThrow();
	});

	it("still sanitizes within the depth cap", () => {
		const out = sanitizeObject({
			a: { b: { c: { evil: "<img src=x onerror=1>" } } },
		}) as { a: { b: { c: { evil: string } } } };
		expect(out.a.b.c.evil).not.toContain("<img");
	});
});
