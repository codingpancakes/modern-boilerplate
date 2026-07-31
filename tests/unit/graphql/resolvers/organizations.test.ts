import { describe, expect, it } from "vitest";
import type { GraphQLContext } from "@/handlers/graphql/context";
import { organizationResolvers } from "@/handlers/graphql/resolvers/organizations";

describe("Organization Resolvers", () => {
	describe("Query.organization", () => {
		it("rejects invalid ID arguments before touching the database", async () => {
			const context = {
				userId: "user-1",
				requestId: "request-1",
				db: {},
				loaders: {},
			} as unknown as GraphQLContext;

			await expect(
				organizationResolvers.Query.organization(
					null,
					{ id: "not-a-uuid" },
					context,
				),
			).rejects.toMatchObject({
				extensions: {
					code: "BAD_USER_INPUT",
					http: { status: 400 },
				},
			});
		});
	});

	describe("Mutation.createOrganization", () => {
		it("maps validation failures to BAD_USER_INPUT before touching the database", async () => {
			const context = {
				userId: "user-1",
				requestId: "request-1",
				db: {},
				loaders: {},
			} as unknown as GraphQLContext;

			await expect(
				organizationResolvers.Mutation.createOrganization(
					null,
					{ input: { name: "", slug: "Invalid Slug" } },
					context,
				),
			).rejects.toMatchObject({
				extensions: {
					code: "BAD_USER_INPUT",
					http: { status: 400 },
				},
			});
		});
	});
});
