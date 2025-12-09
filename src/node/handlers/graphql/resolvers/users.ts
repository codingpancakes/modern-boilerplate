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
		me: async (parent: any, args: any, context: GraphQLContext) => {
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
			parent: any,
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
			parent: any,
			args: any,
			context: GraphQLContext,
		) => {
			return context.db.query.organizationMembers.findMany({
				where: eq(organizationMembers.userId, context.userId),
			});
		},

		// Get organization by ID (must be member)
		organization: async (
			parent: any,
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
			parent: any,
			{ input }: { input: any },
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
			parent: any,
			{ input }: { input: any },
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
	},

	// Field resolvers
	User: {
		profile: async (user: any, args: any, context: GraphQLContext) => {
			return context.db.query.profiles.findFirst({
				where: eq(profiles.userId, user.id),
			});
		},

		organizations: async (user: any, args: any, context: GraphQLContext) => {
			return context.db.query.organizationMembers.findMany({
				where: eq(organizationMembers.userId, user.id),
			});
		},
	},

	Profile: {
		user: async (profile: any, args: any, context: GraphQLContext) => {
			return context.db.query.users.findFirst({
				where: eq(users.id, profile.userId),
			});
		},
	},

	OrganizationMembership: {
		user: async (membership: any, args: any, context: GraphQLContext) => {
			return context.db.query.users.findFirst({
				where: eq(users.id, membership.userId),
			});
		},

		organization: async (
			membership: any,
			args: any,
			context: GraphQLContext,
		) => {
			return context.db.query.organizations.findFirst({
				where: eq(organizations.id, membership.organizationId),
			});
		},
	},

	Organization: {
		members: async (org: any, args: any, context: GraphQLContext) => {
			return context.db.query.organizationMembers.findMany({
				where: eq(organizationMembers.organizationId, org.id),
			});
		},
	},
};
