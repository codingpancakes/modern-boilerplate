import { auditResolvers } from "./audit";
import { mediaResolvers } from "./media";
import { organizationResolvers } from "./organizations";
import { userResolvers } from "./users";

function mergeResolverMaps(
	name: string,
	...maps: Record<string, unknown>[]
): Record<string, unknown> {
	const merged: Record<string, unknown> = {};
	for (const map of maps) {
		for (const key of Object.keys(map)) {
			if (key in merged) {
				throw new Error(
					`Resolver key collision: "${key}" defined in multiple ${name} resolver modules`,
				);
			}
			merged[key] = map[key];
		}
	}
	return merged;
}

/**
 * Single source of truth for merged GraphQL resolvers.
 * Used by both the Worker GraphQL route and the local dev server.
 */
export const resolvers = {
	Query: mergeResolverMaps(
		"Query",
		userResolvers.Query,
		mediaResolvers.Query,
		organizationResolvers.Query,
		auditResolvers.Query,
	),
	Mutation: mergeResolverMaps(
		"Mutation",
		userResolvers.Mutation,
		mediaResolvers.Mutation,
		organizationResolvers.Mutation,
	),
	User: userResolvers.User,
	Profile: userResolvers.Profile,
	OrganizationMembership: userResolvers.OrganizationMembership,
	Organization: userResolvers.Organization,
};
