import { Logger } from "@aws-lambda-powertools/logger";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from "aws-lambda";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "../lib/audit";
import { getUserIdFromClaims } from "../lib/auth";
import { Errors } from "../lib/errors";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv, AuthClaims } from "../lib/hono/types";
import {
	buildImageKey,
	buildImageUrl,
	generatePresignedUploadUrl,
	getMediaConfig,
	getS3Client,
	listUserImages,
	validateContentTypeExtension,
	validateImageMagicBytes,
} from "../lib/media";
import {
	mediaSchemas,
	uploadImageDirectRequest,
	uploadImageRequest,
	validate,
} from "../lib/validation";

/**
 * /v1/media/* — media routes (protected; `requireAuth()` is applied by the
 * barrel in `routes/index.ts`, so `c.get("claims")` is always set).
 *
 * Ported from the Lambda handlers (which are now thin re-exports of the
 * shared app handler). The @swagger blocks stay in the entry files because
 * `scripts/generate-openapi.js` only globs `src/node/handlers/**`:
 *   POST /upload-image         ← src/node/handlers/media/upload-image.ts        (API GW: POST /v1/media/upload-image)
 *   POST /upload-image-direct  ← src/node/handlers/media/upload-image-direct.ts (API GW: POST /v1/media/upload-image-direct)
 *   GET  /images               ← src/node/handlers/media/list-images.ts         (API GW: GET  /v1/media/images)
 */
export const media = new Hono<AppEnv>();

// One logger per endpoint so CloudWatch service names stay identical to the
// per-Lambda loggers the entry files used to create.
const uploadImageLogger = new Logger({ serviceName: "media-upload-image" });
const uploadDirectLogger = new Logger({ serviceName: "media-upload-direct" });
const listImagesLogger = new Logger({ serviceName: "media-list-images" });

/**
 * Hono port of `parseBody` (lib/validation/helpers.ts) — same error bodies:
 * missing body and malformed JSON throw `Errors.BadRequest` with the exact
 * legacy messages, and schema failures throw `Errors.ValidationError` via the
 * shared `validate()`.
 */
async function parseJsonBody<T>(
	c: Context<AppEnv>,
	schema: z.ZodSchema<T>,
): Promise<T> {
	const raw = await c.req.text();
	if (!raw) {
		throw Errors.BadRequest("Request body is required");
	}
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		throw Errors.BadRequest("Invalid JSON in request body");
	}
	return validate(schema, body);
}

/**
 * Hono port of `extractRequestContext` (lib/audit.ts). On Lambda it reads the
 * same fields off the original API Gateway event; in local dev (no event) it
 * falls back to the request headers and the middleware-assigned request id.
 */
function requestAuditContext(c: Context<AppEnv>) {
	const event = c.env?.event;
	if (event && "rawPath" in event) {
		return {
			ipAddress: event.requestContext.http.sourceIp,
			userAgent: event.headers?.["user-agent"],
			requestId: event.requestContext.requestId,
		};
	}
	return {
		ipAddress: undefined,
		userAgent: c.req.header("user-agent"),
		requestId: c.get("requestId"),
	};
}

/**
 * Resolve the internal user id from the authenticated claims.
 *
 * `getUserIdFromClaims` (lib/auth.ts) owns the identity lookup + JIT
 * provisioning and reads claims from `requestContext.authorizer.lambda` on an
 * API Gateway event. Rebuild that minimal event shape from the claims that
 * `requireAuth()` already validated — on Lambda these ARE the authorizer
 * context verbatim — so both Lambda and local dev share the single code path
 * without re-parsing tokens (invariant #10).
 */
async function resolveUserId(c: Context<AppEnv>): Promise<string> {
	const claims = c.get("claims");
	const routeKey = `${c.req.method} ${c.req.path}`;
	const event: APIGatewayProxyEventV2WithLambdaAuthorizer<AuthClaims> = {
		version: "2.0",
		routeKey,
		rawPath: c.req.path,
		rawQueryString: "",
		headers: {},
		isBase64Encoded: false,
		requestContext: {
			accountId: "",
			apiId: "",
			authorizer: { lambda: claims },
			domainName: "",
			domainPrefix: "",
			http: {
				method: c.req.method,
				path: c.req.path,
				protocol: "HTTP/1.1",
				sourceIp: "",
				userAgent: c.req.header("user-agent") ?? "",
			},
			requestId: c.get("requestId"),
			routeKey,
			stage: "$default",
			time: "",
			timeEpoch: 0,
		},
	};
	return getUserIdFromClaims(event);
}

// POST /v1/media/upload-image — generate a presigned S3 upload URL.
// (@swagger block lives in src/node/handlers/media/upload-image.ts)
media.post("/upload-image", async (c) => {
	// Get internal user ID from JWT claims
	const userId = await resolveUserId(c);

	// Add persistent context to all logs
	uploadImageLogger.appendKeys({ userId });

	const input = await parseJsonBody(c, uploadImageRequest);

	const fileExtension = input.filename.split(".").pop()?.toLowerCase() || "";
	if (!validateContentTypeExtension(input.contentType, fileExtension)) {
		throw Errors.BadRequest(
			`Content type ${input.contentType} does not match file extension .${fileExtension}`,
		);
	}

	uploadImageLogger.info("Generating presigned URL for image upload", {
		userId,
		contentType: input.contentType,
	});

	const result = await generatePresignedUploadUrl(
		userId,
		input.filename,
		input.contentType,
		input.fileSize,
		input.category,
	);

	uploadImageLogger.info("Presigned URL generated successfully", {
		key: result.key,
	});

	return sendSuccess(c, {
		uploadUrl: result.uploadUrl,
		imageUrl: result.imageUrl,
		key: result.key,
	});
});

// POST /v1/media/upload-image-direct — base64 upload straight to S3.
// (@swagger block lives in src/node/handlers/media/upload-image-direct.ts)
media.post("/upload-image-direct", async (c) => {
	// Get internal user ID from JWT claims
	const userId = await resolveUserId(c);

	// Add persistent context to all logs
	uploadDirectLogger.appendKeys({ userId });

	const config = getMediaConfig();

	const input = await parseJsonBody(c, uploadImageDirectRequest);

	const fileExtension = input.filename.split(".").pop()?.toLowerCase() || "";
	if (!validateContentTypeExtension(input.contentType, fileExtension)) {
		throw Errors.BadRequest(
			`Content type ${input.contentType} does not match file extension .${fileExtension}`,
		);
	}

	// Decode base64 image data
	let imageBuffer: Buffer;
	try {
		// Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
		const base64Data = input.imageData.replace(/^data:[^;]*;base64,/, "");
		imageBuffer = Buffer.from(base64Data, "base64");
	} catch (_error) {
		throw Errors.BadRequest("Invalid base64 image data");
	}

	// Lambda synchronous payload limit is ~6MB. Base64 encoding adds ~33% overhead,
	// so the effective max decoded image size is ~4.5MB.
	const maxSize = 4.5 * 1024 * 1024;
	if (imageBuffer.length > maxSize) {
		throw Errors.BadRequest(
			"Image size exceeds maximum allowed size of 4.5MB for direct upload. Use the presigned URL endpoint (/v1/media/upload-image) for larger files.",
		);
	}

	if (!validateImageMagicBytes(imageBuffer, input.contentType)) {
		throw Errors.BadRequest(
			"File content does not match the declared content type",
		);
	}

	const key = buildImageKey(userId, input.category, input.filename);

	uploadDirectLogger.info("Uploading image to S3", {
		userId,
		key,
		size: imageBuffer.length,
		contentType: input.contentType,
	});

	const uploadCommand = new PutObjectCommand({
		Bucket: config.bucketName,
		Key: key,
		Body: imageBuffer,
		ContentType: input.contentType,
		ServerSideEncryption: "AES256",
		Metadata: {
			userId,
			originalFilename: input.filename,
			uploadedAt: new Date().toISOString(),
		},
	});

	await getS3Client().send(uploadCommand);

	const imageUrl = buildImageUrl(key, config);

	uploadDirectLogger.info("Image uploaded successfully", { key, imageUrl });

	void logAudit({
		userId,
		action: AUDIT_ACTIONS.CREATE,
		resourceType: AUDIT_RESOURCE_TYPES.MEDIA,
		resourceId: key,
		...requestAuditContext(c),
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: "rest",
			handler: "media/upload-image-direct",
			contentType: input.contentType,
			size: imageBuffer.length,
			category: input.category,
		},
	});

	return sendSuccess(c, {
		imageUrl,
		key,
	});
});

// GET /v1/media/images — list the caller's images (user-scoped S3 prefix).
// (@swagger block lives in src/node/handlers/media/list-images.ts)
media.get("/images", async (c) => {
	// Get internal user ID from JWT claims
	const userId = await resolveUserId(c);

	// Add persistent context to all logs
	listImagesLogger.appendKeys({ userId });

	const query = validate(mediaSchemas.listImages, c.req.query());

	listImagesLogger.info("Listing user images", {
		category: query.prefix,
		limit: query.limit,
	});

	const result = await listUserImages(
		userId,
		query.prefix,
		query.limit,
		query.continuationToken,
	);

	listImagesLogger.info("Images listed successfully", {
		imageCount: result.count,
		hasMore: result.hasMore,
	});

	return sendSuccess(c, result);
});
