import type { z } from "zod";
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
			{ limit = 20, cursor }: { limit?: number; cursor?: string },
			context: GraphQLContext,
		) =>
			runService(() =>
				organizationService.listMyOrganizations({
					db: context.db,
					userId: context.userId,
					limit,
					cursor,
				}),
			),

		organization: async (
			_parent: unknown,
			{ id }: { id: string },
			context: GraphQLContext,
		) =>
			runService(() =>
				organizationService.getOrganization({
					db: context.db,
					userId: context.userId,
					organizationId: id,
				}),
			),

		organizationMembers: async (
			_parent: unknown,
			{
				organizationId,
				limit = 20,
				cursor,
			}: { organizationId: string; limit?: number; cursor?: string },
			context: GraphQLContext,
		) =>
			runService(() =>
				organizationService.listOrganizationMembers({
					db: context.db,
					userId: context.userId,
					organizationId,
					limit,
					cursor,
				}),
			),
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
			{ id, input }: { id: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const validated = parseInput(organizationSchemas.update, input);
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
			{ id }: { id: string },
			context: GraphQLContext,
		) =>
			runService(() =>
				organizationService.deleteOrganization({
					...serviceOptions(context),
					organizationId: id,
				}),
			),

		inviteMember: async (
			_parent: unknown,
			{
				organizationId,
				input,
			}: { organizationId: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const validated = parseInput(organizationSchemas.inviteMember, input);
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
			{
				organizationId,
				input,
			}: { organizationId: string; input: Record<string, unknown> },
			context: GraphQLContext,
		) => {
			const validated = parseInput(organizationSchemas.updateMemberRole, input);
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
			{
				organizationId,
				memberId,
			}: { organizationId: string; memberId: string },
			context: GraphQLContext,
		) =>
			runService(() =>
				organizationService.removeMember({
					...serviceOptions(context),
					organizationId,
					memberId,
				}),
			),

		leaveOrganization: async (
			_parent: unknown,
			{ organizationId }: { organizationId: string },
			context: GraphQLContext,
		) =>
			runService(() =>
				organizationService.leaveOrganization({
					...serviceOptions(context),
					organizationId,
				}),
			),

		acceptInvitation: async (
			_parent: unknown,
			{ organizationId }: { organizationId: string },
			context: GraphQLContext,
		) =>
			runService(() =>
				organizationService.acceptInvitation({
					...serviceOptions(context),
					organizationId,
				}),
			),

		declineInvitation: async (
			_parent: unknown,
			{ organizationId }: { organizationId: string },
			context: GraphQLContext,
		) =>
			runService(() =>
				organizationService.declineInvitation({
					...serviceOptions(context),
					organizationId,
				}),
			),
	},
};
