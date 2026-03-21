import { randomUUID } from "node:crypto";
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
const CDN_URL = process.env.IMAGES_CDN_URL || "";
const UPLOAD_EXPIRY_SECONDS = 300;

const ALLOWED_CONTENT_TYPES: Record<string, string[]> = {
	"image/jpeg": ["jpg", "jpeg"],
	"image/png": ["png"],
	"image/gif": ["gif"],
	"image/webp": ["webp"],
};

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
				? `users/${context.userId}/${category}/`
				: `users/${context.userId}/`;

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
			const safeFilename = sanitizeFilename(filename);

			if (!validateFileExtension(safeFilename, "IMAGE")) {
				throw new Error(
					"Invalid file extension. Allowed: jpg, jpeg, png, gif, webp",
				);
			}

			// Validate contentType against allowlist and check extension match
			const allowedExts = ALLOWED_CONTENT_TYPES[contentType];
			if (!allowedExts) {
				throw new Error(
					`Invalid content type. Allowed: ${Object.keys(ALLOWED_CONTENT_TYPES).join(", ")}`,
				);
			}
			const ext = safeFilename.split(".").pop()?.toLowerCase() || "";
			if (!allowedExts.includes(ext)) {
				throw new Error(
					`Content type ${contentType} does not match file extension .${ext}`,
				);
			}

			const timestamp = Date.now();
			const uniqueId = randomUUID();
			const key = category
				? `users/${context.userId}/${category}/${timestamp}_${uniqueId}_${safeFilename}`
				: `users/${context.userId}/general/${timestamp}_${uniqueId}_${safeFilename}`;

			const command = new PutObjectCommand({
				Bucket: IMAGES_BUCKET,
				Key: key,
				ContentType: contentType,
				ServerSideEncryption: "AES256",
				Metadata: {
					userId: context.userId,
					originalFilename: filename,
					uploadedAt: new Date().toISOString(),
				},
			});

			const uploadUrl = await getSignedUrl(s3Client, command, {
				expiresIn: UPLOAD_EXPIRY_SECONDS,
			});

			const imageUrl = CDN_URL
				? `${CDN_URL}/${key}`
				: `https://${IMAGES_BUCKET}.s3.amazonaws.com/${key}`;

			return {
				uploadUrl,
				imageUrl,
				key,
				expiresIn: UPLOAD_EXPIRY_SECONDS,
			};
		},
	},
};
