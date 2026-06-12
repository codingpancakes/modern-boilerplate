import { describe, expect, it } from "vitest";
import { type ClaimsLike, getClaims } from "@/lib/auth";

/**
 * getClaims normalizes the verified claims object set by `requireAuth()`
 * (`c.get("claims")`) into the canonical `Claims` shape. It is the single
 * choke point between token verification and user lookup — these tests
 * guard that no unverified/garbage shape sneaks through (invariant #10:
 * auth comes only from the shared verifier, never re-parsed locally).
 */
describe("Auth Helpers - Claims Extraction", () => {
	describe("getClaims", () => {
		it("should extract claims from a verified claims object", () => {
			const claims = getClaims({
				sub: "user_01abc123",
				email: "test@example.com",
				org_id: "org_456",
				iss: "https://api.workos.com",
				exp: 1234567890,
				iat: 1234567890,
			});

			expect(claims.sub).toBe("user_01abc123");
			expect(claims.email).toBe("test@example.com");
			expect(claims.org_id).toBe("org_456");
			expect(claims.iss).toBe("https://api.workos.com");
		});

		it("should return sub as user ID", () => {
			const claims = getClaims({
				sub: "user_01abc123",
				iss: "https://api.workos.com",
				exp: 1234567890,
				iat: 1234567890,
			});
			expect(claims.sub).toBe("user_01abc123");
		});

		it("should return org_id when present", () => {
			const claims = getClaims({
				sub: "user_01abc123",
				org_id: "org_456",
				iss: "https://api.workos.com",
				exp: 1234567890,
				iat: 1234567890,
			});
			expect(claims.org_id).toBe("org_456");
		});

		it("should return undefined org_id when not present", () => {
			const claims = getClaims({
				sub: "user_01abc123",
				iss: "https://api.workos.com",
				exp: 1234567890,
				iat: 1234567890,
			});
			expect(claims.org_id).toBeUndefined();
		});

		it("normalizes string exp/iat to numbers (JWT claims may arrive stringly)", () => {
			const claims = getClaims({
				sub: "user_01abc123",
				iss: "https://api.workos.com",
				exp: "1234567890",
				iat: "1234567891",
			});
			expect(claims.exp).toBe(1234567890);
			expect(claims.iat).toBe(1234567891);
		});

		it("defaults iss to empty string and exp/iat to 0 when absent", () => {
			const claims = getClaims({ sub: "user_01abc123" });
			expect(claims.iss).toBe("");
			expect(claims.exp).toBe(0);
			expect(claims.iat).toBe(0);
		});

		it("should throw Unauthorized if sub is missing", () => {
			expect(() =>
				getClaims({ email: "test@example.com" } as unknown as ClaimsLike),
			).toThrow();
		});

		it("should throw Unauthorized if sub is not a string", () => {
			expect(() => getClaims({ sub: 42 } as unknown as ClaimsLike)).toThrow();
		});

		it("should throw Unauthorized for an empty claims object", () => {
			expect(() => getClaims({} as unknown as ClaimsLike)).toThrow();
		});
	});
});
