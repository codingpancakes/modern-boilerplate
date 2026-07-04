import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeObject, sanitizeString } from "@/lib/sanitize";

describe("sanitizeObject", () => {
	it("strips HTML tags (script blocks lose their contents) without entity-escaping", () => {
		const out = sanitizeObject({
			name: "Ada <script>alert(1)</script>",
			bio: "likes <img src=x onerror=alert(1)> pictures",
		});
		expect(out.name).toBe("Ada");
		expect(out.bio).toBe("likes  pictures");
	});

	it("stores benign text EXACTLY as written — escaping is a render-time concern", () => {
		const input = {
			name: "O'Brien",
			company: "A & B Co",
			note: 'said "hi", 1 < 2',
		};
		expect(sanitizeObject(input)).toEqual(input);
	});

	it("is idempotent: a read-modify-write round-trip never mutates the value again", () => {
		const once = sanitizeObject({ name: "O'Brien & Sons <b>Ltd</b>" });
		expect(sanitizeObject(once)).toEqual(once);
	});

	it("removes NUL and control characters", () => {
		const out = sanitizeObject({ name: "Ada\0 Love\x08lace" });
		expect(out.name).toBe("Ada Lovelace");
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

describe("sanitizeString (allowHtml)", () => {
	it("keeps whitelisted formatting tags but drops event handlers and unsafe tags", () => {
		const out = sanitizeString(
			'<b onclick="x()">bold</b> <script>alert(1)</script> <em>em</em>',
			{ allowHtml: true },
		);
		expect(out).toContain("<b");
		expect(out).toContain("<em>em</em>");
		expect(out).not.toContain("onclick");
		expect(out).not.toContain("<script>");
	});
});

describe("escapeHtml (render-time)", () => {
	it("escapes HTML special characters for interpolation into markup", () => {
		expect(escapeHtml("O'Brien & <script>")).toBe(
			"O&#x27;Brien &amp; &lt;script&gt;",
		);
	});
});
