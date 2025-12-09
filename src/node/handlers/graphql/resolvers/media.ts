import {
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sanitizeFilename, validateFileExtension } from "../../../lib/sanitize";
import type { GraphQLContext } from "../context";

const s3Client = new S3Client({
	region: process.env.AWS_REGION || "us-east-1",
});
const IMAGES_BUCKET = process.env.IMAGES_BUCKET ?? "";
const CDN_URL = process.env.CDN_URL || "";

export const mediaResolvers = {
	Query: {
		images: async (
			_parent: unknown,
			{
				category,
				limit = 50,
				continuationToken,
			}: { category?: string; limit?: number; continuationToken?: string },
			context: GraphQLContext,
		) => {
			const prefix = category
				? `${context.userId}/${category}/`
				: `${context.userId}/`;

			const command = new ListObjectsV2Command({
				Bucket: IMAGES_BUCKET,
				Prefix: prefix,
				MaxKeys: limit,
				ContinuationToken: continuationToken,
			});

			const response = await s3Client.send(command);

			const images = (response.Contents || []).map((item) => ({
				key: item.Key ?? "",
				url: CDN_URL
					? `${CDN_URL}/${item.Key}`
					: `https://${IMAGES_BUCKET}.s3.amazonaws.com/${item.Key}`,
				size: item.Size || 0,
				lastModified:
					item.LastModified?.toISOString() || new Date().toISOString(),
				category: item.Key?.split("/")[1] || null,
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
			// Validate file
			const safeFilename = sanitizeFilename(filename);

			// Validate file extension for images
			if (!validateFileExtension(safeFilename, "IMAGE")) {
				throw new Error(
					"Invalid file extension. Allowed: jpg, jpeg, png, gif, webp",
				);
			}

			// Generate S3 key
			const timestamp = Date.now();
			const randomString = Math.random().toString(36).substring(2, 15);
			const key = category
				? `${context.userId}/${category}/${timestamp}-${randomString}-${safeFilename}`
				: `${context.userId}/${timestamp}-${randomString}-${safeFilename}`;

			// Generate presigned URL
			const command = new PutObjectCommand({
				Bucket: IMAGES_BUCKET,
				Key: key,
				ContentType: contentType,
			});

			const uploadUrl = await getSignedUrl(s3Client, command, {
				expiresIn: 3600, // 1 hour
			});

			const imageUrl = CDN_URL
				? `${CDN_URL}/${key}`
				: `https://${IMAGES_BUCKET}.s3.amazonaws.com/${key}`;

			return {
				uploadUrl,
				imageUrl,
				key,
				expiresIn: 3600,
			};
		},
	},
};
