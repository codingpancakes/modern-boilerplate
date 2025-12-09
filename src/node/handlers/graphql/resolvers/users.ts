import { and, eq } from "drizzle-orm";
import {
	organizationMembers,
	organizations,
	profiles,
	users,
} from "../../../db/schema/index";
import { sanitizeObject } from "../../../lib/sanitize";
import { userSchemas } from "../../../lib/validation";
import type { GraphQLContext } from "../context";

export const userResolvers = {
	Query: {
		// Get current user
		me: async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
			const user = await context.db.query.users.findFirst({
				where: eq(users.id, context.userId),
			});

			if (!user) {
				throw new Error("User not found");
			}

			return user;
		},

		// Get user by ID (must be in same org)
		user: async (
			_parent: unknown,
			{ id }: { id: string },
			context: GraphQLContext,
		) => {
			// Verify user is in same organization
			const membership = await context.db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.userId, id),
					eq(organizationMembers.organizationId, context.orgId),
				),
			});

			if (!membership) {
				throw new Error("User not found or not in your organization");
			}

			const user = await context.db.query.users.findFirst({
				where: eq(users.id, id),
			});

			return user;
		},

		// Get current user's organizations
		myOrganizations: async (
			_parent: unknown,
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.organizationMembers.findMany({
				where: eq(organizationMembers.userId, context.userId),
			});
		},

		// Get organization by ID (must be member)
		organization: async (
			_parent: unknown,
			{ id }: { id: string },
			context: GraphQLContext,
		) => {
			// Verify user is member of this organization
			const membership = await context.db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.userId, context.userId),
					eq(organizationMembers.organizationId, id),
				),
			});

			if (!membership) {
				throw new Error("Organization not found or you are not a member");
			}

			const org = await context.db.query.organizations.findFirst({
				where: eq(organizations.id, id),
			});

			return org;
		},
	},

	Mutation: {
		// Update current user
		updateMe: async (
			_parent: unknown,
			{ input }: { input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			// Validate input
			const validated = userSchemas.update.parse(input);
			const sanitized = sanitizeObject(validated);

			// Update user
			const [updated] = await context.db
				.update(users)
				.set({
					...sanitized,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(users.id, context.userId))
				.returning();

			return updated;
		},

		// Update profile
		updateProfile: async (
			_parent: unknown,
			{ input }: { input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const sanitized = sanitizeObject(input);

			const [updated] = await context.db
				.update(profiles)
				.set({
					...sanitized,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(profiles.userId, context.userId))
				.returning();

			return updated;
		},

		// Update both user and profile in one mutation
		updateMyAccount: async (
			_parent: unknown,
			args: {
				user?: Record<string, unknown>;
				profile?: Record<string, unknown>;
			},
			context: GraphQLContext,
		) => {
			// Update user if provided
			let updatedUser = null;
			if (args.user && Object.keys(args.user).length > 0) {
				const validated = userSchemas.update.parse(args.user);
				const sanitized = sanitizeObject(validated);

				[updatedUser] = await context.db
					.update(users)
					.set({
						...sanitized,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(users.id, context.userId))
					.returning();
			}

			// Update profile if provided
			let updatedProfile = null;
			if (args.profile && Object.keys(args.profile).length > 0) {
				const sanitized = sanitizeObject(args.profile);

				[updatedProfile] = await context.db
					.update(profiles)
					.set({
						...sanitized,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(profiles.userId, context.userId))
					.returning();
			}

			// Fetch current data if not updated
			if (!updatedUser) {
				const result = await context.db
					.select()
					.from(users)
					.where(eq(users.id, context.userId))
					.limit(1);
				updatedUser = result[0];
			}

			if (!updatedProfile) {
				const result = await context.db
					.select()
					.from(profiles)
					.where(eq(profiles.userId, context.userId))
					.limit(1);
				updatedProfile = result[0];
			}

			return {
				user: updatedUser,
				profile: updatedProfile,
			};
		},
	},

	// Field resolvers
	User: {
		profile: async (
			user: { id: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.profiles.findFirst({
				where: eq(profiles.userId, user.id),
			});
		},

		organizations: async (
			user: { id: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.organizationMembers.findMany({
				where: eq(organizationMembers.userId, user.id),
			});
		},
	},

	Profile: {
		user: async (
			profile: { userId: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.users.findFirst({
				where: eq(users.id, profile.userId),
			});
		},
	},

	OrganizationMembership: {
		user: async (
			membership: { userId: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.users.findFirst({
				where: eq(users.id, membership.userId),
			});
		},

		organization: async (
			membership: { organizationId: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.organizations.findFirst({
				where: eq(organizations.id, membership.organizationId),
			});
		},
	},

	Organization: {
		members: async (
			org: { id: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.organizationMembers.findMany({
				where: eq(organizationMembers.organizationId, org.id),
			});
		},
	},
};
