import { z } from "zod";
import { auditRequestContext } from "../../../lib/audit";
import * as organizationService from "../../../lib/services/organizations";
import { organizationSchemas } from "../../../lib/validation";
import { validate } from "../../../lib/validation/helpers";
import type { GraphQLContext } from "../context";
import { toGraphQLError } from "../errors";

function parseInput<T>(schema: z.ZodSchema<T>, input: unknown): T {
	try {
		return validate(schema, input);
	} catch (error) {
		throw toGraphQLError(error);
	}
}

const paginationArgs = z.object({
	limit: z.number().int().min(1).max(100).optional(),
	cursor: z.string().max(1_000).optional(),
});

const idArgs = z.object({
	id: z.string().uuid(),
});

const organizationIdArgs = z.object({
	organizationId: z.string().uuid(),
});

const organizationMembersArgs = organizationIdArgs.merge(paginationArgs);

const organizationMemberIdArgs = z.object({
	organizationId: z.string().uuid(),
	memberId: z.string().uuid(),
});

async function runService<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw toGraphQLError(error);
	}
}

function serviceOptions(context: GraphQLContext) {
	return {
		db: context.db,
		actorUserId: context.userId,
		auditContext: auditRequestContext(context),
		source: "graphql" as const,
	};
}

export const organizationResolvers = {
	Query: {
		myOrganizations: async (
			_parent: unknown,
			args: { limit?: number; cursor?: string },
			context: GraphQLContext,
		) => {
			const { limit, cursor } = parseInput(paginationArgs, args);
			return runService(() =>
				organizationService.listMyOrganizations({
					db: context.db,
					userId: context.userId,
					limit,
					cursor,
				}),
			);
		},

		organization: async (
			_parent: unknown,
			args: { id: string },
			context: GraphQLContext,
		) => {
			const { id } = parseInput(idArgs, args);
			return runService(() =>
				organizationService.getOrganization({
					db: context.db,
					userId: context.userId,
					organizationId: id,
				}),
			);
		},

		organizationMembers: async (
			_parent: unknown,
			args: { organizationId: string; limit?: number; cursor?: string },
			context: GraphQLContext,
		) => {
			const { organizationId, limit, cursor } = parseInput(
				organizationMembersArgs,
				args,
			);
			return runService(() =>
				organizationService.listOrganizationMembers({
					db: context.db,
					userId: context.userId,
					organizationId,
					limit,
					cursor,
				}),
			);
		},
	},

	Mutation: {
		createOrganization: async (
			_parent: unknown,
			{ input }: { input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const validated = parseInput(organizationSchemas.create, input);
			return runService(() =>
				organizationService.createOrganization({
					...serviceOptions(context),
					input: validated,
				}),
			);
		},

		updateOrganization: async (
			_parent: unknown,
			args: { id: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const { id } = parseInput(idArgs, args);
			const validated = parseInput(organizationSchemas.update, args.input);
			return runService(() =>
				organizationService.updateOrganization({
					...serviceOptions(context),
					organizationId: id,
					input: validated,
				}),
			);
		},

		deleteOrganization: async (
			_parent: unknown,
			args: { id: string },
			context: GraphQLContext,
		) => {
			const { id } = parseInput(idArgs, args);
			return runService(() =>
				organizationService.deleteOrganization({
					...serviceOptions(context),
					organizationId: id,
				}),
			);
		},

		inviteMember: async (
			_parent: unknown,
			args: { organizationId: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const { organizationId } = parseInput(organizationIdArgs, args);
			const validated = parseInput(
				organizationSchemas.inviteMember,
				args.input,
			);
			const serviceInput = {
				...validated,
				role: validated.role ?? "MEMBER",
			};
			return runService(() =>
				organizationService.inviteMember({
					...serviceOptions(context),
					organizationId,
					input: serviceInput,
				}),
			);
		},

		updateMemberRole: async (
			_parent: unknown,
			args: { organizationId: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const { organizationId } = parseInput(organizationIdArgs, args);
			const validated = parseInput(
				organizationSchemas.updateMemberRole,
				args.input,
			);
			return runService(() =>
				organizationService.updateMemberRole({
					...serviceOptions(context),
					organizationId,
					input: validated,
				}),
			);
		},

		removeMember: async (
			_parent: unknown,
			args: { organizationId: string; memberId: string },
			context: GraphQLContext,
		) => {
			const { organizationId, memberId } = parseInput(
				organizationMemberIdArgs,
				args,
			);
			return runService(() =>
				organizationService.removeMember({
					...serviceOptions(context),
					organizationId,
					memberId,
				}),
			);
		},

		leaveOrganization: async (
			_parent: unknown,
			args: { organizationId: string },
			context: GraphQLContext,
		) => {
			const { organizationId } = parseInput(organizationIdArgs, args);
			return runService(() =>
				organizationService.leaveOrganization({
					...serviceOptions(context),
					organizationId,
				}),
			);
		},

		acceptInvitation: async (
			_parent: unknown,
			args: { organizationId: string },
			context: GraphQLContext,
		) => {
			const { organizationId } = parseInput(organizationIdArgs, args);
			return runService(() =>
				organizationService.acceptInvitation({
					...serviceOptions(context),
					organizationId,
				}),
			);
		},

		declineInvitation: async (
			_parent: unknown,
			args: { organizationId: string },
			context: GraphQLContext,
		) => {
			const { organizationId } = parseInput(organizationIdArgs, args);
			return runService(() =>
				organizationService.declineInvitation({
					...serviceOptions(context),
					organizationId,
				}),
			);
		},
	},
};
