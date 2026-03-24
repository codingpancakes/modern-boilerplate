import { ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GraphQLError } from "graphql";
import {
	buildImageKey,
	buildImageUrl,
	getMediaConfig,
	getS3Client,
	validateContentTypeExtension,
} from "../../../lib/media";
import { validateFileExtension } from "../../../lib/sanitize";
import type { GraphQLContext } from "../context";

const UPLOAD_EXPIRY_SECONDS = 300;

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
			const config = getMediaConfig();
			const safeLimit = Math.min(Math.max(limit ?? 20, 1), 100);

			const prefix = category
				? `users/${context.userId}/${category}/`
				: `users/${context.userId}/`;

			const command = new ListObjectsV2Command({
				Bucket: config.bucketName,
				Prefix: prefix,
				MaxKeys: safeLimit,
				ContinuationToken: continuationToken,
			});

			const response = await getS3Client().send(command);

			const images = (response.Contents || []).map((item) => ({
				key: item.Key ?? "",
				url: buildImageUrl(item.Key ?? "", config),
				size: item.Size || 0,
				lastModified:
					item.LastModified?.toISOString() || new Date().toISOString(),
				category: item.Key?.split("/")[2] || null,
			}));

			return {
				images,
				total: images.length,
				continuationToken: response.NextContinuationToken || null,
			};
		},
	},

	Mutation: {
		generateImageUploadUrl: async (
			_parent: unknown,
			{
				filename,
				contentType,
				category,
			}: { filename: string; contentType: string; category?: string },
			context: GraphQLContext,
		) => {
			if (!filename || filename.length > 255) {
				throw new GraphQLError("Filename must be 1-255 characters", {
					extensions: { code: "BAD_USER_INPUT" },
				});
			}
			if (category && category.length > 50) {
				throw new GraphQLError("Category must be 50 characters or less", {
					extensions: { code: "BAD_USER_INPUT" },
				});
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

			const config = getMediaConfig();
			const key = buildImageKey(context.userId, category, filename);

			const command = new PutObjectCommand({
				Bucket: config.bucketName,
				Key: key,
				ContentType: contentType,
				ServerSideEncryption: "AES256",
				Metadata: {
					userId: context.userId,
					originalFilename: filename,
					uploadedAt: new Date().toISOString(),
				},
			});

			const uploadUrl = await getSignedUrl(getS3Client(), command, {
				expiresIn: UPLOAD_EXPIRY_SECONDS,
			});

			return {
				uploadUrl,
				imageUrl: buildImageUrl(key, config),
				key,
				expiresIn: UPLOAD_EXPIRY_SECONDS,
			};
		},
	},
};
