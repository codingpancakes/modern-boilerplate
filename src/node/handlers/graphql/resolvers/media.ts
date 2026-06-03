import { GraphQLError } from "graphql";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	auditRequestContext,
	logAudit,
} from "../../../lib/audit";
import {
	generatePresignedUploadUrl,
	listUserImages,
	validateContentTypeExtension,
} from "../../../lib/media";
import { FILE_SIZE_LIMITS, validateFileExtension } from "../../../lib/sanitize";
import { validateCategory } from "../../../lib/validation/media";
import type { GraphQLContext } from "../context";

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
			if (!filename || filename.length > 255) {
				throw new GraphQLError("Filename must be 1-255 characters", {
					extensions: { code: "BAD_USER_INPUT" },
				});
			}
			if (category) validateCategoryGraphQL(category);

			if (
				!Number.isInteger(fileSize) ||
				fileSize < 1 ||
				fileSize > FILE_SIZE_LIMITS.IMAGE
			) {
				throw new GraphQLError(
					`fileSize must be between 1 and ${FILE_SIZE_LIMITS.IMAGE} bytes`,
					{ extensions: { code: "BAD_USER_INPUT" } },
				);
			}

			if (!validateFileExtension(filename, "IMAGE")) {
				throw new GraphQLError(
					"Invalid file extension. Allowed: jpg, jpeg, png, gif, webp",
					{ extensions: { code: "BAD_USER_INPUT" } },
				);
			}

			const ext = filename.split(".").pop()?.toLowerCase() || "";
			if (!validateContentTypeExtension(contentType, ext)) {
				throw new GraphQLError(
					`Content type ${contentType} does not match file extension .${ext}`,
					{ extensions: { code: "BAD_USER_INPUT" } },
				);
			}

			const result = await generatePresignedUploadUrl(
				context.userId,
				filename,
				contentType,
				fileSize,
				category,
			);

			void logAudit({
				userId: context.userId,
				organizationId: context.organizationId,
				...auditRequestContext(context),
				action: AUDIT_ACTIONS.CREATE,
				resourceType: AUDIT_RESOURCE_TYPES.MEDIA,
				resourceId: result.key,
				status: AUDIT_STATUS.SUCCESS,
				metadata: {
					source: "graphql",
					action: "generate_upload_url",
					filename,
					contentType,
					fileSize,
					category,
				},
			});

			return result;
		},
	},
};
