import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { getClaims } from "@/lib/auth";

describe("Auth Helpers - Claims Extraction", () => {
	describe("getClaims", () => {
		it("should extract claims from lambda authorizer context", () => {
			const event = {
				requestContext: {
					authorizer: {
						lambda: {
							sub: "user_01abc123",
							email: "test@example.com",
							org_id: "org_456",
							iss: "https://api.workos.com",
							exp: 1234567890,
							iat: 1234567890,
						},
					},
				},
			} as unknown as APIGatewayProxyEventV2;

			const claims = getClaims(event);

			expect(claims.sub).toBe("user_01abc123");
			expect(claims.email).toBe("test@example.com");
			expect(claims.org_id).toBe("org_456");
			expect(claims.iss).toBe("https://api.workos.com");
		});

		it("should return sub as user ID", () => {
			const event = {
				requestContext: {
					authorizer: {
						lambda: {
							sub: "user_01abc123",
							iss: "https://api.workos.com",
							exp: 1234567890,
							iat: 1234567890,
						},
					},
				},
			} as unknown as APIGatewayProxyEventV2;

			const claims = getClaims(event);
			expect(claims.sub).toBe("user_01abc123");
		});

		it("should return org_id when present", () => {
			const event = {
				requestContext: {
					authorizer: {
						lambda: {
							sub: "user_01abc123",
							org_id: "org_456",
							iss: "https://api.workos.com",
							exp: 1234567890,
							iat: 1234567890,
						},
					},
				},
			} as unknown as APIGatewayProxyEventV2;

			const claims = getClaims(event);
			expect(claims.org_id).toBe("org_456");
		});

		it("should return undefined org_id when not present", () => {
			const event = {
				requestContext: {
					authorizer: {
						lambda: {
							sub: "user_01abc123",
							iss: "https://api.workos.com",
							exp: 1234567890,
							iat: 1234567890,
						},
					},
				},
			} as unknown as APIGatewayProxyEventV2;

			const claims = getClaims(event);
			expect(claims.org_id).toBeUndefined();
		});

		it("reads only authorizer.lambda, ignoring any jwt block (invariant #10)", () => {
			// Production uses a custom Lambda authorizer (SIMPLE) → claims live under
			// `authorizer.lambda`. Guard against reintroducing a `jwt` fallback: even
			// if a `jwt` block is present, lambda must be the single source of trust.
			const event = {
				requestContext: {
					authorizer: {
						jwt: { claims: { sub: "spoofed_via_jwt" } },
						lambda: {
							sub: "user_real",
							iss: "https://api.workos.com",
							exp: 1234567890,
							iat: 1234567890,
						},
					},
				},
			} as unknown as APIGatewayProxyEventV2;

			const claims = getClaims(event);
			expect(claims.sub).toBe("user_real");
		});

		it("throws when only a jwt block is present (no lambda context)", () => {
			const event = {
				requestContext: {
					authorizer: {
						jwt: { claims: { sub: "user_01abc123" } },
					},
				},
			} as unknown as APIGatewayProxyEventV2;

			expect(() => getClaims(event)).toThrow();
		});

		it("should throw Unauthorized if sub is missing", () => {
			const event = {
				requestContext: {
					authorizer: {
						lambda: {
							email: "test@example.com",
						},
					},
				},
			} as unknown as APIGatewayProxyEventV2;

			expect(() => getClaims(event)).toThrow();
		});

		it("should throw Unauthorized if no claims exist", () => {
			const event = {
				requestContext: {},
			} as unknown as APIGatewayProxyEventV2;

			expect(() => getClaims(event)).toThrow();
		});
	});
});
