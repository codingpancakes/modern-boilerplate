import { describe, it, expect, vi, beforeEach } from "vitest";
import { userResolvers as resolvers } from "@/handlers/graphql/resolvers/users";
import type { GraphQLContext } from "@/handlers/graphql/context";

// Mock database
const mockDb = {
	select: vi.fn(),
	update: vi.fn(),
};

// Mock context
const createMockContext = (overrides = {}): GraphQLContext => ({
	userId: "test-user-id",
	orgId: "test-org-id",
	role: "MEMBER",
	email: "test@example.com",
	providerSubject: "workos-123",
	claims: {},
	db: mockDb as any,
	...overrides,
});

describe("User Resolvers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Query.me", () => {
		it("should return current user", async () => {
			const mockUser = {
				id: "test-user-id",
				email: "test@example.com",
				firstName: "Test",
				lastName: "User",
				type: "MEMBER",
			};

			mockDb.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([mockUser]),
					}),
				}),
			});

			const context = createMockContext();
			const result = await resolvers.Query.me(null, {}, context);

			expect(result).toEqual(mockUser);
			expect(mockDb.select).toHaveBeenCalled();
		});

		it("should throw error if user not found", async () => {
			mockDb.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([]),
					}),
				}),
			});

			const context = createMockContext();

			await expect(resolvers.Query.me(null, {}, context)).rejects.toThrow();
		});
	});

	describe("Mutation.updateMe", () => {
		it("should update user fields", async () => {
			const updatedUser = {
				id: "test-user-id",
				email: "test@example.com",
				firstName: "Updated",
				lastName: "User",
			};

			mockDb.update.mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedUser]),
					}),
				}),
			});

			const context = createMockContext();
			const input = { firstName: "Updated" };

			const result = await resolvers.Mutation.updateMe(null, { input }, context);

			expect(result.firstName).toBe("Updated");
			expect(mockDb.update).toHaveBeenCalled();
		});

		it("should sanitize input data", async () => {
			const updatedUser = {
				id: "test-user-id",
				firstName: "Clean",
			};

			const mockSet = vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([updatedUser]),
				}),
			});

			mockDb.update.mockReturnValue({
				set: mockSet,
			});

			const context = createMockContext();
			const input = {
				firstName: "Clean",
				// @ts-ignore - testing sanitization
				__proto__: { malicious: true },
			};

			await resolvers.Mutation.updateMe(null, { input }, context);

			// Verify sanitization removed __proto__
			const setCall = mockSet.mock.calls[0][0];
			expect(setCall).not.toHaveProperty("__proto__");
		});
	});

	describe("Mutation.updateProfile", () => {
		it("should update profile fields", async () => {
			const updatedProfile = {
				userId: "test-user-id",
				preferredName: "TestNick",
			};

			mockDb.update.mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedProfile]),
					}),
				}),
			});

			const context = createMockContext();
			const input = { preferredName: "TestNick" };

			const result = await resolvers.Mutation.updateProfile(
				null,
				{ input },
				context,
			);

			expect(result.preferredName).toBe("TestNick");
		});
	});

	describe("Mutation.updateMyAccount", () => {
		it("should update both user and profile", async () => {
			const updatedUser = {
				id: "test-user-id",
				firstName: "UpdatedFirst",
			};

			const updatedProfile = {
				userId: "test-user-id",
				preferredName: "UpdatedNick",
			};

			// Mock user update
			mockDb.update.mockReturnValueOnce({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedUser]),
					}),
				}),
			});

			// Mock profile update
			mockDb.update.mockReturnValueOnce({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedProfile]),
					}),
				}),
			});

			const context = createMockContext();
			const args = {
				user: { firstName: "UpdatedFirst" },
				profile: { preferredName: "UpdatedNick" },
			};

			const result = await resolvers.Mutation.updateMyAccount(
				null,
				args,
				context,
			);

			expect(result.user.firstName).toBe("UpdatedFirst");
			expect(result.profile.preferredName).toBe("UpdatedNick");
		});

		it("should update only user if profile not provided", async () => {
			const updatedUser = {
				id: "test-user-id",
				firstName: "UpdatedFirst",
			};

			const existingProfile = {
				userId: "test-user-id",
				preferredName: "Existing",
			};

			// Mock user update
			mockDb.update.mockReturnValueOnce({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedUser]),
					}),
				}),
			});

			// Mock profile fetch (not update)
			mockDb.select.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([existingProfile]),
					}),
				}),
			});

			const context = createMockContext();
			const args = {
				user: { firstName: "UpdatedFirst" },
			};

			const result = await resolvers.Mutation.updateMyAccount(
				null,
				args,
				context,
			);

			expect(result.user.firstName).toBe("UpdatedFirst");
			expect(result.profile.preferredName).toBe("Existing");
		});
	});

	describe("User.profile", () => {
		it("should resolve user profile", async () => {
			const mockProfile = {
				userId: "test-user-id",
				preferredName: "TestNick",
				photoUrl: "https://example.com/photo.jpg",
			};

			mockDb.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([mockProfile]),
					}),
				}),
			});

			const parent = { id: "test-user-id" };
			const context = createMockContext();

			const result = await resolvers.User.profile(parent, {}, context);

			expect(result).toEqual(mockProfile);
		});
	});

	describe("User.organizations", () => {
		it("should resolve user organizations", async () => {
			const mockOrgs = [
				{
					role: "MEMBER",
					organizationId: "org-1",
					organization: { id: "org-1", name: "Org 1" },
				},
				{
					role: "ADMIN",
					organizationId: "org-2",
					organization: { id: "org-2", name: "Org 2" },
				},
			];

			mockDb.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					leftJoin: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue(mockOrgs),
					}),
				}),
			});

			const parent = { id: "test-user-id" };
			const context = createMockContext();

			const result = await resolvers.User.organizations(parent, {}, context);

			expect(result).toHaveLength(2);
			expect(result[0].role).toBe("MEMBER");
			expect(result[1].role).toBe("ADMIN");
		});
	});
});
