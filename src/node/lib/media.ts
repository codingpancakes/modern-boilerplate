/**
 * Shared Media Utilities
 *
 * Centralizes image upload configuration, S3 key generation, URL building,
 * and content-type validation used across REST handlers and GraphQL resolvers.
 */

import { randomUUID } from "node:crypto";
import {
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ALLOWED_FILE_EXTENSIONS, sanitizeFilename } from "./sanitize";

let _s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
	if (!_s3Client) {
		_s3Client = new S3Client({ region: process.env.AWS_REGION });
	}
	return _s3Client;
}

export const IMAGE_CONTENT_TYPE_MAP: Record<string, string[]> = {
	"image/jpeg": ["jpg", "jpeg"],
	"image/png": ["png"],
	"image/gif": ["gif"],
	"image/webp": ["webp"],
};

const IMAGE_MAGIC_BYTES: [string, number[]][] = [
	["image/jpeg", [0xff, 0xd8, 0xff]],
	["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
	["image/gif", [0x47, 0x49, 0x46, 0x38]], // GIF87a or GIF89a
	["image/webp", [0x52, 0x49, 0x46, 0x46]], // RIFF header (WebP also has "WEBP" at offset 8)
];

/**
 * Validates that the first bytes of the buffer match the expected magic bytes
 * for the declared content type. Prevents uploading non-image data with a
 * spoofed MIME type.
 */
export function validateImageMagicBytes(
	buffer: Buffer,
	declaredContentType: string,
): boolean {
	const entry = IMAGE_MAGIC_BYTES.find(([ct]) => ct === declaredContentType);
	if (!entry) return false;

	const [, expected] = entry;
	if (buffer.length < expected.length) return false;

	for (let i = 0; i < expected.length; i++) {
		if (buffer[i] !== expected[i]) return false;
	}

	// Extra check for WebP: bytes 8-11 must be "WEBP"
	if (declaredContentType === "image/webp") {
		if (buffer.length < 12) return false;
		const webpTag = buffer.subarray(8, 12).toString("ascii");
		if (webpTag !== "WEBP") return false;
	}

	return true;
}

export interface MediaConfig {
	bucketName: string;
	cdnUrl: string;
}

export function getMediaConfig(): MediaConfig {
	const bucketName = process.env.IMAGES_BUCKET;
	const cdnUrl = process.env.IMAGES_CDN_URL;
	if (!bucketName || !cdnUrl) {
		throw new Error(
			"Missing required environment variables: IMAGES_BUCKET, IMAGES_CDN_URL",
		);
	}
	return { bucketName, cdnUrl };
}

/**
 * Validates that the content type and file extension are an allowed pair.
 */
export function validateContentTypeExtension(
	contentType: string,
	extension: string,
): boolean {
	const allowedExts = IMAGE_CONTENT_TYPE_MAP[contentType];
	return !!allowedExts && allowedExts.includes(extension.toLowerCase());
}

/**
 * Builds a user-scoped S3 key with sanitized filename and unique prefix.
 */
export function buildImageKey(
	userId: string,
	category: string | undefined,
	filename: string,
): string {
	const safeName = sanitizeFilename(filename, {
		maxLength: 100,
		allowedExtensions: ALLOWED_FILE_EXTENSIONS.IMAGE,
	});
	const route = category || "general";
	const timestamp = Date.now();
	const uniqueId = randomUUID();
	return `users/${userId}/${route}/${timestamp}_${uniqueId}_${safeName}`;
}

/**
 * Builds a public image URL from an S3 key using CDN or direct S3.
 */
export function buildImageUrl(key: string, config?: MediaConfig): string {
	const { bucketName, cdnUrl } = config ?? getMediaConfig();
	return cdnUrl
		? `${cdnUrl}/${key}`
		: `https://${bucketName}.s3.amazonaws.com/${key}`;
}

const UPLOAD_EXPIRY_SECONDS = 300;

export interface PresignedUploadResult {
	uploadUrl: string;
	imageUrl: string;
	key: string;
	expiresIn: number;
}

/**
 * Generate a presigned S3 PUT URL for image upload.
 * Single source of truth for both REST and GraphQL upload flows.
 */
export async function generatePresignedUploadUrl(
	userId: string,
	filename: string,
	contentType: string,
	fileSize: number,
	category?: string,
): Promise<PresignedUploadResult> {
	const config = getMediaConfig();
	const key = buildImageKey(userId, category, filename);

	const safeFilename = sanitizeFilename(filename, {
		maxLength: 200,
		allowedExtensions: ALLOWED_FILE_EXTENSIONS.IMAGE,
	});

	const command = new PutObjectCommand({
		Bucket: config.bucketName,
		Key: key,
		ContentType: contentType,
		ContentLength: fileSize,
		ServerSideEncryption: "AES256",
		Metadata: {
			userId,
			originalFilename: safeFilename,
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
}

export interface ImageItem {
	key: string;
	url: string;
	size: number;
	lastModified: string;
	category: string | null;
	filename?: string;
}

export interface ListImagesResult {
	images: ImageItem[];
	count: number;
	hasMore: boolean;
	continuationToken: string | null;
}

/**
 * List images for a user from S3.
 * Single source of truth for both REST and GraphQL listing flows.
 */
export async function listUserImages(
	userId: string,
	category?: string | null,
	limit = 20,
	continuationToken?: string | null,
): Promise<ListImagesResult> {
	const config = getMediaConfig();
	const safeLimit = Math.min(Math.max(limit, 1), 100);

	const prefix = category ? `users/${userId}/${category}/` : `users/${userId}/`;

	const command = new ListObjectsV2Command({
		Bucket: config.bucketName,
		Prefix: prefix,
		MaxKeys: safeLimit,
		ContinuationToken: continuationToken || undefined,
	});

	const response = await getS3Client().send(command);

	const images: ImageItem[] = (response.Contents || []).map((item) => {
		const key = item.Key ?? "";
		const parts = key.split("/");
		return {
			key,
			url: buildImageUrl(key, config),
			size: item.Size || 0,
			lastModified:
				item.LastModified?.toISOString() || new Date().toISOString(),
			category: parts.length > 2 ? parts[2] : null,
			filename: parts[parts.length - 1],
		};
	});

	return {
		images,
		count: images.length,
		hasMore: response.IsTruncated || false,
		continuationToken: response.NextContinuationToken || null,
	};
}
