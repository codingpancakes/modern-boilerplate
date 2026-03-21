import { and, eq } from "drizzle-orm";
import {
	organizationMembers,
	organizations,
	profiles,
	users,
} from "../../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	auditResolver,
	logAudit,
} from "../../../lib/audit";
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
			if (!context.orgId) {
				throw new Error(
					"Organization context required. Ensure your token includes an org_id claim.",
				);
			}

			const membership = await context.db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.userId, id),
					eq(organizationMembers.organizationId, context.orgId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});

			if (!membership) {
				throw new Error("User not found or not in your organization");
			}

			return context.db.query.users.findFirst({
				where: eq(users.id, id),
			});
		},

		// Get current user's organizations
		myOrganizations: async (
			_parent: unknown,
			_args: unknown,
			context: GraphQLContext,
		) => {
			return context.db.query.organizationMembers.findMany({
				where: and(
					eq(organizationMembers.userId, context.userId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});
		},

		// Get organization by ID (must be active member)
		organization: async (
			_parent: unknown,
			{ id }: { id: string },
			context: GraphQLContext,
		) => {
			const membership = await context.db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.userId, context.userId),
					eq(organizationMembers.organizationId, id),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});

			if (!membership) {
				throw new Error("Organization not found or you are not a member");
			}

			return context.db.query.organizations.findFirst({
				where: eq(organizations.id, id),
			});
		},
	},

	Mutation: {
		// Update current user (with audit logging)
		updateMe: auditResolver(
			async (
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
			{
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.USER,
				getResourceId: (result) => result.id,
				getChanges: (result) => ({ after: result }),
				getMetadata: (_result, args) => ({
					updatedFields: Object.keys(args.input),
				}),
			},
		),

		// Update profile (with audit logging)
		updateProfile: auditResolver(
			async (
				_parent: unknown,
				{ input }: { input: Record<string, unknown> },
				context: GraphQLContext,
			) => {
				const validated = userSchemas.updateProfileInput.parse(input);
				const sanitized = sanitizeObject(validated);

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
			{
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.PROFILE,
				getResourceId: (result) => result.userId,
				getChanges: (result) => ({ after: result }),
				getMetadata: (_result, args) => ({
					updatedFields: Object.keys(args.input),
					...(args.input.onboardingCompleted !== undefined && {
						onboardingCompleted: args.input.onboardingCompleted,
					}),
				}),
			},
		),

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
				const validatedProfile = userSchemas.updateProfileInput.parse(
					args.profile,
				);
				const sanitized = sanitizeObject(validatedProfile);

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

			// Fire-and-forget audit log
			void logAudit({
				userId: context.userId,
				organizationId: context.orgId || undefined,
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.PROFILE,
				resourceId: context.userId,
				changes: { after: { user: updatedUser, profile: updatedProfile } },
				status: AUDIT_STATUS.SUCCESS,
				metadata: {
					source: "graphql",
					updatedFields: {
						user: args.user ? Object.keys(args.user) : [],
						profile: args.profile ? Object.keys(args.profile) : [],
					},
				},
			});

			return {
				user: updatedUser,
				profile: updatedProfile,
			};
		},
	},

	// Field resolvers — use DataLoaders to batch and deduplicate DB queries
	User: {
		profile: (user: { id: string }, _args: unknown, context: GraphQLContext) =>
			context.loaders.profileByUserId.load(user.id),

		organizations: (
			user: { id: string },
			_args: unknown,
			context: GraphQLContext,
		) => context.loaders.membershipsByUserId.load(user.id),
	},

	Profile: {
		user: (
			profile: { userId: string },
			_args: unknown,
			context: GraphQLContext,
		) => context.loaders.userById.load(profile.userId),
	},

	OrganizationMembership: {
		user: (
			membership: { userId: string },
			_args: unknown,
			context: GraphQLContext,
		) => context.loaders.userById.load(membership.userId),

		organization: (
			membership: { organizationId: string },
			_args: unknown,
			context: GraphQLContext,
		) => context.loaders.orgById.load(membership.organizationId),

		// DB column is createdAt, GraphQL field is joinedAt
		joinedAt: (membership: { createdAt: string }) => membership.createdAt,
		// No leftAt column on organizationMembers; always null
		leftAt: () => null,
	},

	Organization: {
		members: (org: { id: string }, _args: unknown, context: GraphQLContext) =>
			context.loaders.membershipsByOrgId.load(org.id),
	},
};
