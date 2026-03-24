/**
 * Shared Media Utilities
 *
 * Centralizes image upload configuration, S3 key generation, URL building,
 * and content-type validation used across REST handlers and GraphQL resolvers.
 */

import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
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
