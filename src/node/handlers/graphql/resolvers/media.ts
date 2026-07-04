import { z } from "zod";
import { listUserImages } from "../../../lib/media";
import { createPresignedImageUpload } from "../../../lib/services/media-upload";
import { validate } from "../../../lib/validation/helpers";
import { categoryField } from "../../../lib/validation/media";
import type { GraphQLContext } from "../context";
import { toGraphQLError } from "../errors";

function parseInput<T>(schema: z.ZodSchema<T>, input: unknown): T {
	try {
		return validate(schema, input);
	} catch (error) {
		throw toGraphQLError(error);
	}
}

const imagesArgs = z.object({
	category: categoryField.optional(),
	limit: z.number().int().min(1).max(100).optional(),
	continuationToken: z.string().max(2_000).optional(),
});

export const mediaResolvers = {
	Query: {
		images: async (
			_parent: unknown,
			args: { category?: string; limit?: number; continuationToken?: string },
			context: GraphQLContext,
		) => {
			const {
				category,
				limit = 20,
				continuationToken,
			} = parseInput(imagesArgs, args);

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
