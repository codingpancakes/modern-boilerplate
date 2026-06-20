import { GraphQLError } from "graphql";
import { listUserImages } from "../../../lib/media";
import { createPresignedImageUpload } from "../../../lib/services/media-upload";
import { validateCategory } from "../../../lib/validation/media";
import type { GraphQLContext } from "../context";
import { toGraphQLError } from "../errors";

function validateCategoryGraphQL(category: string): void {
	try {
		validateCategory(category);
	} catch (err) {
		throw new GraphQLError(
			err instanceof Error ? err.message : "Invalid category",
			{ extensions: { code: "BAD_USER_INPUT" } },
		);
	}
}

export const mediaResolvers = {
	Query: {
		images: async (
			_parent: unknown,
			{
				category,
				limit = 20,
				continuationToken,
			}: { category?: string; limit?: number; continuationToken?: string },
			context: GraphQLContext,
		) => {
			if (category) validateCategoryGraphQL(category);

			return listUserImages(context.userId, category, limit, continuationToken);
		},
	},

	Mutation: {
		generateImageUploadUrl: async (
			_parent: unknown,
			{
				filename,
				contentType,
				fileSize,
				category,
			}: {
				filename: string;
				contentType: string;
				fileSize: number;
				category?: string;
			},
			context: GraphQLContext,
		) => {
			try {
				return await createPresignedImageUpload({
					userId: context.userId,
					input: { filename, contentType, fileSize, category },
					source: "graphql",
					auditContext: context,
				});
			} catch (error) {
				throw toGraphQLError(error);
			}
		},
	},
};
