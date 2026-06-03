import { and, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { organizationMembers, profiles, users } from "../../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	auditRequestContext,
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
			if (!args.user && !args.profile) {
				throw new GraphQLError(
					"At least one of user or profile input must be provided",
					{ extensions: { code: "BAD_USER_INPUT" } },
				);
			}

			const {
				beforeUser,
				beforeProfile,
				updatedUser,
				updatedProfile,
				validatedUserKeys,
				validatedProfileKeys,
			} = await context.db.transaction(async (tx) => {
				const [bu, bp] = await Promise.all([
					tx
						.select()
						.from(users)
						.where(eq(users.id, context.userId))
						.limit(1)
						.then((r) => r[0]),
					tx
						.select()
						.from(profiles)
						.where(eq(profiles.userId, context.userId))
						.limit(1)
						.then((r) => r[0]),
				]);

				let uu = null;
				const userKeys: string[] = [];
				if (args.user && Object.keys(args.user).length > 0) {
					const validated = userSchemas.update.parse(args.user);
					userKeys.push(...Object.keys(validated));
					const sanitized = sanitizeObject(validated);
					[uu] = await tx
						.update(users)
						.set({
							...sanitized,
							updatedAt: new Date().toISOString(),
						})
						.where(eq(users.id, context.userId))
						.returning();
				}

				let up = null;
				const profileKeys: string[] = [];
				if (args.profile && Object.keys(args.profile).length > 0) {
					const validatedProfile = userSchemas.updateProfileInput.parse(
						args.profile,
					);
					profileKeys.push(...Object.keys(validatedProfile));
					const sanitized = sanitizeObject(validatedProfile);
					[up] = await tx
						.update(profiles)
						.set({
							...sanitized,
							updatedAt: new Date().toISOString(),
						})
						.where(eq(profiles.userId, context.userId))
						.returning();
				}

				return {
					beforeUser: bu,
					beforeProfile: bp,
					updatedUser: uu ?? bu,
					updatedProfile: up ?? bp,
					validatedUserKeys: userKeys,
					validatedProfileKeys: profileKeys,
				};
			});

			if (!updatedUser) {
				throw new GraphQLError("User not found", {
					extensions: { code: "NOT_FOUND" },
				});
			}

			const updatedUserFields = validatedUserKeys;
			const updatedProfileFields = validatedProfileKeys;
			const resourceType =
				updatedUserFields.length > 0 && updatedProfileFields.length > 0
					? AUDIT_RESOURCE_TYPES.USER
					: updatedProfileFields.length > 0
						? AUDIT_RESOURCE_TYPES.PROFILE
						: AUDIT_RESOURCE_TYPES.USER;

			void logAudit({
				userId: context.userId,
				organizationId: context.organizationId,
				...auditRequestContext(context),
				action: AUDIT_ACTIONS.UPDATE,
				resourceType,
				resourceId: context.userId,
				changes: {
					before: { user: beforeUser, profile: beforeProfile },
					after: { user: updatedUser, profile: updatedProfile },
				},
				status: AUDIT_STATUS.SUCCESS,
				metadata: {
					source: "graphql",
					updatedFields: {
						user: updatedUserFields,
						profile: updatedProfileFields,
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
			membership: { userId: string },
			_args: unknown,
			context: GraphQLContext,
		) => context.loaders.userById.load(membership.userId),

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
