import { and, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { organizationMembers, profiles, users } from "../../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	auditResolver,
} from "../../../lib/audit";
import { sanitizeObject } from "../../../lib/sanitize";
import { updateMyAccount as updateAccount } from "../../../lib/services/user-account";
import { userSchemas } from "../../../lib/validation";
import type { GraphQLContext } from "../context";
import { toGraphQLError } from "../errors";

export const userResolvers = {
	Query: {
		// Get current user
		me: async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
			const user = await context.db.query.users.findFirst({
				where: eq(users.id, context.userId),
			});

			if (!user) {
				throw new GraphQLError("User not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			return user;
		},

		// Get user by ID (must be in same org)
		user: async (
			_parent: unknown,
			{ id }: { id: string },
			context: GraphQLContext,
		) => {
			if (!context.organizationId) {
				throw new GraphQLError(
					"Organization context required. Ensure your token includes an org_id claim.",
					{ extensions: { code: "BAD_USER_INPUT" } },
				);
			}

			// Verify the CALLER is an active member of the org they're scoping to —
			// don't trust the JWT org_id alone (it could be stale). Defense in depth,
			// consistent with requireMembership in the org resolvers.
			const callerMembership =
				await context.db.query.organizationMembers.findFirst({
					where: and(
						eq(organizationMembers.userId, context.userId),
						eq(organizationMembers.organizationId, context.organizationId),
						eq(organizationMembers.status, "ACTIVE"),
					),
				});

			if (!callerMembership) {
				throw new GraphQLError(
					"Organization not found or you are not a member",
					{ extensions: { code: "FORBIDDEN" } },
				);
			}

			const membership = await context.db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.userId, id),
					eq(organizationMembers.organizationId, context.organizationId),
					eq(organizationMembers.status, "ACTIVE"),
				),
			});

			if (!membership) {
				throw new GraphQLError("User not found or not in your organization", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			const user = await context.db.query.users.findFirst({
				where: eq(users.id, id),
			});

			if (!user) {
				throw new GraphQLError("User not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			return user;
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
				const validated = userSchemas.update.parse(input);
				const sanitized = sanitizeObject(validated);

				const [updated] = await context.db
					.update(users)
					.set({
						...sanitized,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(users.id, context.userId))
					.returning();

				if (!updated) {
					throw new GraphQLError("User not found", {
						extensions: { code: "NOT_FOUND" },
					});
				}

				return updated;
			},
			{
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.USER,
				getBefore: (_args, context) =>
					context.db.query.users.findFirst({
						where: eq(users.id, context.userId),
					}),
				getResourceId: (result) => result.id,
				getChanges: (result, _args, before) => ({ before, after: result }),
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

				if (!updated) {
					throw new GraphQLError("Profile not found", {
						extensions: { code: "NOT_FOUND" },
					});
				}

				return updated;
			},
			{
				action: AUDIT_ACTIONS.UPDATE,
				resourceType: AUDIT_RESOURCE_TYPES.PROFILE,
				getBefore: (_args, context) =>
					context.db.query.profiles.findFirst({
						where: eq(profiles.userId, context.userId),
					}),
				getResourceId: (result) => result.userId,
				getChanges: (result, _args, before) => ({ before, after: result }),
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
			try {
				return await updateAccount({
					db: context.db,
					userId: context.userId,
					input: args,
					source: "graphql",
					auditContext: context,
				});
			} catch (error) {
				throw toGraphQLError(error);
			}
		},
	},

	// Field resolvers — use DataLoaders to batch and deduplicate DB queries
	User: {
		profile: (user: { id: string }, _args: unknown, context: GraphQLContext) =>
			context.loaders.profileByUserId.load(user.id),

		organizations: async (
			user: { id: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			const memberships = await context.loaders.membershipsByUserId.load(
				user.id,
			);

			if (user.id === context.userId) {
				return memberships;
			}

			// Cross-user query: only reveal orgs the caller also belongs to
			const callerMemberships = await context.loaders.membershipsByUserId.load(
				context.userId,
			);
			const callerOrgIds = new Set(
				callerMemberships.map((m) => m.organizationId),
			);
			return memberships.filter((m) => callerOrgIds.has(m.organizationId));
		},
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
			membership: { userId: string; status?: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			// A PENDING invite must not expose the invitee's profile to anyone
			// but the invitee themselves — reading it before they consent would
			// leak their PII (see inviteMember consent boundary).
			if (
				membership.status === "PENDING" &&
				membership.userId !== context.userId
			) {
				throw new GraphQLError(
					"Cannot view a pending invitee's profile before they accept",
					{ extensions: { code: "FORBIDDEN" } },
				);
			}
			return context.loaders.userById.load(membership.userId);
		},

		organization: (
			membership: { organizationId: string },
			_args: unknown,
			context: GraphQLContext,
		) => context.loaders.orgById.load(membership.organizationId),

		joinedAt: (membership: { createdAt: string }) => membership.createdAt,
	},

	Organization: {
		members: async (
			org: { id: string },
			_args: unknown,
			context: GraphQLContext,
		) => {
			const members = await context.loaders.membershipsByOrgId.load(org.id);
			if (!members.some((m) => m.userId === context.userId)) {
				throw new GraphQLError(
					"Organization not found or you are not a member",
					{ extensions: { code: "FORBIDDEN" } },
				);
			}
			return members;
		},
	},
};
