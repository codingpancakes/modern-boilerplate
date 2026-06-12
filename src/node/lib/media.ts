/**
 * Shared Media Utilities
 *
 * Centralizes image upload configuration, object-key generation, URL
 * building, and content-type validation used across REST handlers and
 * GraphQL resolvers.
 *
 * Storage is Cloudflare R2 via its S3-compatible API, signed with `aws4fetch`
 * (pure fetch + WebCrypto — runs on Workers and Node alike). The R2 binding
 * (`c.env.IMAGES`) is preferred by routes when present; everything here works
 * from plain env config so GraphQL resolvers and presigning need no binding.
 *
 * Required env for the S3-API path (gate like origin-verify did: when unset,
 * media endpoints fail with a CLEAR 503 config error instead of crashing):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET (falls back to IMAGES_BUCKET — same bucket, one name)
 */

import { randomUUID } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { ApiError } from "./errors";
import { ALLOWED_FILE_EXTENSIONS, sanitizeFilename } from "./sanitize";

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

const mediaNotConfigured = () =>
	new ApiError(
		503,
		"MEDIA_STORAGE_NOT_CONFIGURED",
		"Media storage is not configured",
	);

export interface MediaConfig {
	bucketName: string;
	cdnUrl: string;
}

/**
 * Public-URL config (IMAGES_BUCKET + IMAGES_CDN_URL — the R2 public bucket /
 * custom-domain URL). Throws a clear 503 config error when unset.
 */
export function getMediaConfig(): MediaConfig {
	const bucketName = process.env.IMAGES_BUCKET;
	const cdnUrl = process.env.IMAGES_CDN_URL;
	if (!bucketName || !cdnUrl) {
		throw mediaNotConfigured();
	}
	return { bucketName, cdnUrl };
}

export interface R2S3Config {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
}

/** S3-API config for R2, or null when not configured. */
export function getR2S3Config(): R2S3Config | null {
	const accountId = process.env.R2_ACCOUNT_ID;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	const bucket = process.env.R2_BUCKET || process.env.IMAGES_BUCKET;
	if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
		return null;
	}
	return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** S3-API config for R2; throws a clear 503 config error when unset. */
export function requireR2S3Config(): R2S3Config {
	const config = getR2S3Config();
	if (!config) {
		throw mediaNotConfigured();
	}
	return config;
}

function r2Client(config: R2S3Config): AwsClient {
	return new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region: "auto",
		service: "s3",
	});
}

/** Object keys are path-like; encode each segment, keep the slashes. */
function encodeKeyPath(key: string): string {
	return key.split("/").map(encodeURIComponent).join("/");
}

function objectUrl(config: R2S3Config, key: string): string {
	return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${encodeKeyPath(key)}`;
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
 * Builds a user-scoped object key with sanitized filename and unique prefix.
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
 * Builds a public image URL from an object key via the CDN (R2 public
 * bucket / custom domain) URL.
 */
export function buildImageUrl(key: string, config?: MediaConfig): string {
	const { cdnUrl } = config ?? getMediaConfig();
	return `${cdnUrl}/${key}`;
}

const UPLOAD_EXPIRY_SECONDS = 300;

export interface PresignedUploadResult {
	uploadUrl: string;
	imageUrl: string;
	key: string;
	expiresIn: number;
}

/**
 * Generate a presigned PUT URL for image upload, against the R2 S3 API.
 * Single source of truth for both REST and GraphQL upload flows.
 *
 * The uploader must send the declared `Content-Type` and `Content-Length`
 * (both are signed headers, as with the old S3 presigner); object metadata
 * (`x-amz-meta-*`) is hoisted into the signed query string, so clients don't
 * have to send it.
 */
export async function generatePresignedUploadUrl(
	userId: string,
	filename: string,
	contentType: string,
	fileSize: number,
	category?: string,
): Promise<PresignedUploadResult> {
	const r2 = requireR2S3Config();
	const mediaConfig = getMediaConfig();
	const key = buildImageKey(userId, category, filename);

	const safeFilename = sanitizeFilename(filename, {
		maxLength: 200,
		allowedExtensions: ALLOWED_FILE_EXTENSIONS.IMAGE,
	});

	const url = new URL(objectUrl(r2, key));
	url.searchParams.set("X-Amz-Expires", String(UPLOAD_EXPIRY_SECONDS));
	url.searchParams.set("x-amz-meta-userid", userId);
	url.searchParams.set("x-amz-meta-originalfilename", safeFilename);
	url.searchParams.set("x-amz-meta-uploadedat", new Date().toISOString());

	// NOTE: headers are passed via init (NOT a pre-built Request) on purpose:
	// `content-length` is a fetch-spec forbidden request header, so a Request
	// constructor would silently drop it and it would never get signed.
	const signed = await r2Client(r2).sign(url.toString(), {
		method: "PUT",
		headers: {
			"content-type": contentType,
			"content-length": String(fileSize),
		},
		// allHeaders: aws4fetch treats content-type/content-length as unsignable
		// by default; they ARE the upload contract here, so force-sign them.
		aws: { signQuery: true, allHeaders: true },
	});

	return {
		uploadUrl: signed.url,
		imageUrl: buildImageUrl(key, mediaConfig),
		key,
		expiresIn: UPLOAD_EXPIRY_SECONDS,
	};
}

/**
 * Upload an object through the R2 S3 API. Fallback for the direct-upload
 * route when the R2 binding (`c.env.IMAGES`) is not available (e.g. the
 * local Node server). Metadata keys must already be header-safe.
 */
export async function putImageObject(
	key: string,
	body: Buffer,
	contentType: string,
	metadata: Record<string, string>,
): Promise<void> {
	const r2 = requireR2S3Config();

	const headers: Record<string, string> = { "content-type": contentType };
	for (const [name, value] of Object.entries(metadata)) {
		headers[`x-amz-meta-${name.toLowerCase()}`] = value;
	}

	const response = await r2Client(r2).fetch(objectUrl(r2, key), {
		method: "PUT",
		headers,
		body,
	});
	if (!response.ok) {
		throw new Error(`Image upload failed (status ${response.status})`);
	}
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

/** Decode the five XML character entities (S3 list responses are XML). */
function decodeXml(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

function xmlTagValue(xml: string, tag: string): string | undefined {
	const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
	return match ? decodeXml(match[1]) : undefined;
}

/**
 * List images for a user from R2 (S3 ListObjectsV2 API).
 * Single source of truth for both REST and GraphQL listing flows.
 */
export async function listUserImages(
	userId: string,
	category?: string | null,
	limit = 20,
	continuationToken?: string | null,
): Promise<ListImagesResult> {
	const r2 = requireR2S3Config();
	const mediaConfig = getMediaConfig();
	const safeLimit = Math.min(Math.max(limit, 1), 100);

	const prefix = category ? `users/${userId}/${category}/` : `users/${userId}/`;

	const url = new URL(
		`https://${r2.accountId}.r2.cloudflarestorage.com/${r2.bucket}`,
	);
	url.searchParams.set("list-type", "2");
	url.searchParams.set("prefix", prefix);
	url.searchParams.set("max-keys", String(safeLimit));
	if (continuationToken) {
		url.searchParams.set("continuation-token", continuationToken);
	}

	const response = await r2Client(r2).fetch(url.toString());
	if (!response.ok) {
		throw new Error(`Failed to list images (status ${response.status})`);
	}
	const xml = await response.text();

	const images: ImageItem[] = (
		xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []
	).map((entry) => {
		const key = xmlTagValue(entry, "Key") ?? "";
		const size = Number(xmlTagValue(entry, "Size")) || 0;
		const lastModifiedRaw = xmlTagValue(entry, "LastModified");
		const lastModifiedDate = lastModifiedRaw
			? new Date(lastModifiedRaw)
			: new Date();
		const parts = key.split("/");
		return {
			key,
			url: buildImageUrl(key, mediaConfig),
			size,
			lastModified: Number.isNaN(lastModifiedDate.getTime())
				? new Date().toISOString()
				: lastModifiedDate.toISOString(),
			category: parts.length > 2 ? parts[2] : null,
			filename: parts[parts.length - 1],
		};
	});

	return {
		images,
		count: images.length,
		hasMore: xmlTagValue(xml, "IsTruncated") === "true",
		continuationToken: xmlTagValue(xml, "NextContinuationToken") || null,
	};
}
