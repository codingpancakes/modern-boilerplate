import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLContext } from "@/handlers/graphql/context";
import { userResolvers as resolvers } from "@/handlers/graphql/resolvers/users";

type MockFn = ReturnType<typeof vi.fn>;

type MockDb = {
	query: {
		users: {
			findFirst: MockFn;
		};
		profiles: {
			findFirst: MockFn;
		};
		organizationMembers: {
			findFirst: MockFn;
			findMany: MockFn;
		};
	};
	select: MockFn;
	update: MockFn;
	transaction: MockFn;
};

type MockLoaders = {
	userById: { load: MockFn };
	profileByUserId: { load: MockFn };
	orgById: { load: MockFn };
	membershipsByUserId: { load: MockFn };
	membershipsByOrgId: { load: MockFn };
};

type MockGraphQLContext = GraphQLContext & {
	db: GraphQLContext["db"] & MockDb;
	loaders: GraphQLContext["loaders"] & MockLoaders;
};

// Mock database with Drizzle query API structure
const createMockDb = (): MockDb => {
	const db = {
		query: {
			users: {
				findFirst: vi.fn(),
			},
			profiles: {
				findFirst: vi.fn(),
			},
			organizationMembers: {
				findFirst: vi.fn(),
				findMany: vi.fn(),
			},
		},
		select: vi.fn(),
		update: vi.fn(),
		transaction: vi.fn(),
	} satisfies MockDb;
	// Faithfully models neon-serverless interactive transactions: the callback
	// runs against a tx handle that behaves like the connection. (The real
	// neon-serverless driver supports this; neon-http would throw — see
	// tests/unit/lib/db.test.ts for the driver regression guard.)
	db.transaction = vi.fn((fn: (tx: MockDb) => Promise<unknown>) => fn(db));
	return db;
};

// Mock loaders
const createMockLoaders = (): MockLoaders => ({
	userById: { load: vi.fn() },
	profileByUserId: { load: vi.fn() },
	orgById: { load: vi.fn() },
	membershipsByUserId: { load: vi.fn() },
	membershipsByOrgId: { load: vi.fn() },
});

// Mock context
const createMockContext = (
	overrides: Partial<GraphQLContext> = {},
): MockGraphQLContext => {
	const mockDb = createMockDb();
	return {
		userId: "test-user-id",
		organizationId: "test-org-id",
		role: "MEMBER",
		email: "test@example.com",
		providerSubject: "workos-123",
		claims: {},
		requestId: "test-request-id",
		db: mockDb as unknown as MockGraphQLContext["db"],
		loaders: createMockLoaders() as unknown as MockGraphQLContext["loaders"],
		...overrides,
	} as MockGraphQLContext;
};

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

			const context = createMockContext();
			context.db.query.users.findFirst.mockResolvedValue(mockUser);

			const result = await resolvers.Query.me(null, {}, context);

			expect(result).toEqual(mockUser);
			expect(context.db.query.users.findFirst).toHaveBeenCalled();
		});

		it("should throw error if user not found", async () => {
			const context = createMockContext();
			context.db.query.users.findFirst.mockResolvedValue(undefined);

			await expect(resolvers.Query.me(null, {}, context)).rejects.toThrow();
		});
	});

	describe("Mutation.updateMe", () => {
		it("should update user fields", async () => {
			const existingUser = { id: "test-user-id", firstName: "Old" };
			const existingProfile = {
				userId: "test-user-id",
				preferredName: "Existing",
			};
			const updatedUser = {
				id: "test-user-id",
				email: "test@example.com",
				firstName: "Updated",
				lastName: "User",
			};

			const context = createMockContext();
			const selectChain = {
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi
							.fn()
							.mockResolvedValueOnce([existingUser])
							.mockResolvedValueOnce([existingProfile]),
					}),
				}),
			};
			context.db.select.mockReturnValue(selectChain);
			context.db.update.mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedUser]),
					}),
				}),
			});

			const input = { firstName: "Updated" };

			const result = await resolvers.Mutation.updateMe(
				null,
				{ input },
				context,
			);

			expect(result.firstName).toBe("Updated");
			expect(context.db.update).toHaveBeenCalled();
			expect(context.db.transaction).toHaveBeenCalled();
		});

		it("should sanitize input data", async () => {
			const existingUser = { id: "test-user-id", firstName: "Old" };
			const existingProfile = {
				userId: "test-user-id",
				preferredName: "Existing",
			};
			const updatedUser = {
				id: "test-user-id",
				firstName: "Clean",
			};

			const mockSet = vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([updatedUser]),
				}),
			});

			const context = createMockContext();
			const selectChain = {
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi
							.fn()
							.mockResolvedValueOnce([existingUser])
							.mockResolvedValueOnce([existingProfile]),
					}),
				}),
			};
			context.db.select.mockReturnValue(selectChain);
			context.db.update.mockReturnValue({
				set: mockSet,
			});

			const input = {
				firstName: "Clean",
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
			const existingUser = { id: "test-user-id", firstName: "Existing" };
			const existingProfile = {
				userId: "test-user-id",
				preferredName: "OldNick",
			};
			const updatedProfile = {
				userId: "test-user-id",
				preferredName: "TestNick",
			};

			const context = createMockContext();
			const selectChain = {
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi
							.fn()
							.mockResolvedValueOnce([existingUser])
							.mockResolvedValueOnce([existingProfile]),
					}),
				}),
			};
			context.db.select.mockReturnValue(selectChain);
			context.db.update.mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedProfile]),
					}),
				}),
			});

			const input = { preferredName: "TestNick" };

			const result = await resolvers.Mutation.updateProfile(
				null,
				{ input },
				context,
			);

			expect(result.preferredName).toBe("TestNick");
			expect(context.db.transaction).toHaveBeenCalled();
		});
	});

	describe("Mutation.updateMyAccount", () => {
		it("should update both user and profile", async () => {
			const existingUser = { id: "test-user-id", firstName: "OldFirst" };
			const existingProfile = {
				userId: "test-user-id",
				preferredName: "OldNick",
			};

			const updatedUser = {
				id: "test-user-id",
				firstName: "UpdatedFirst",
			};

			const updatedProfile = {
				userId: "test-user-id",
				preferredName: "UpdatedNick",
			};

			const context = createMockContext();

			// Transaction reads before-state for user + profile, then updates both.
			const selectChain = {
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi
							.fn()
							.mockResolvedValueOnce([existingUser])
							.mockResolvedValueOnce([existingProfile]),
					}),
				}),
			};
			context.db.select.mockReturnValue(selectChain);

			// Mock user update
			context.db.update.mockReturnValueOnce({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedUser]),
					}),
				}),
			});

			// Mock profile update
			context.db.update.mockReturnValueOnce({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedProfile]),
					}),
				}),
			});
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
			const existingUser = {
				id: "test-user-id",
				firstName: "OldFirst",
			};

			const updatedUser = {
				id: "test-user-id",
				firstName: "UpdatedFirst",
			};

			const existingProfile = {
				userId: "test-user-id",
				preferredName: "Existing",
			};

			const context = createMockContext();

			// Transaction calls tx.select() twice (users + profiles), then tx.update() once
			const selectChain = {
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi
							.fn()
							.mockResolvedValueOnce([existingUser])
							.mockResolvedValueOnce([existingProfile]),
					}),
				}),
			};
			context.db.select.mockReturnValue(selectChain);

			context.db.update.mockReturnValueOnce({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedUser]),
					}),
				}),
			});

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

			const parent = { id: "test-user-id" };
			const context = createMockContext();
			context.loaders.profileByUserId.load.mockResolvedValue(mockProfile);

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

			const parent = { id: "test-user-id" };
			const context = createMockContext();
			context.loaders.membershipsByUserId.load.mockResolvedValue(mockOrgs);

			const result = await resolvers.User.organizations(parent, {}, context);

			expect(result).toHaveLength(2);
			expect(result[0].role).toBe("MEMBER");
			expect(result[1].role).toBe("ADMIN");
		});
	});
});
