import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getClaims, getUserId, getOrgId } from "@/lib/auth";

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

	describe("getUserId", () => {
		it("should return WorkOS subject from claims", () => {
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

			const userId = getUserId(event);

			expect(userId).toBe("user_01abc123");
		});
	});

	describe("getOrgId", () => {
		it("should return org_id from claims", () => {
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

			const orgId = getOrgId(event);

			expect(orgId).toBe("org_456");
		});

		it("should return undefined if org_id not present", () => {
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

			const orgId = getOrgId(event);

			expect(orgId).toBeUndefined();
		});
	});
});
