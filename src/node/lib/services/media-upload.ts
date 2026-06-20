import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	type AuditContext,
	logAudit,
} from "../audit";
import { Errors } from "../errors";
import {
	generatePresignedUploadUrl,
	type PresignedUploadResult,
	validateContentTypeExtension,
} from "../media";
import { validate } from "../validation/helpers";
import { uploadImageRequest } from "../validation/media";

export type ImageUploadInput = ReturnType<typeof validateImageUploadInput>;

export function validateImageUploadInput(input: unknown) {
	const validated = validate(uploadImageRequest, input);
	const fileExtension =
		validated.filename.split(".").pop()?.toLowerCase() || "";

	if (!validateContentTypeExtension(validated.contentType, fileExtension)) {
		throw Errors.BadRequest(
			`Content type ${validated.contentType} does not match file extension .${fileExtension}`,
		);
	}

	return validated;
}

export async function createPresignedImageUpload(options: {
	userId: string;
	input: unknown;
	auditContext?: AuditContext;
	source: "graphql" | "rest";
}): Promise<PresignedUploadResult> {
	const input = validateImageUploadInput(options.input);
	const result = await generatePresignedUploadUrl(
		options.userId,
		input.filename,
		input.contentType,
		input.fileSize,
		input.category,
	);

	if (options.auditContext) {
		void logAudit({
			userId: options.userId,
			organizationId: options.auditContext.organizationId,
			action: AUDIT_ACTIONS.CREATE,
			resourceType: AUDIT_RESOURCE_TYPES.MEDIA,
			resourceId: result.key,
			status: AUDIT_STATUS.SUCCESS,
			ipAddress: options.auditContext.ipAddress,
			userAgent: options.auditContext.userAgent,
			requestId: options.auditContext.requestId,
			metadata: {
				source: options.source,
				action: "generate_upload_url",
				filename: input.filename,
				contentType: input.contentType,
				fileSize: input.fileSize,
				category: input.category,
			},
		});
	}

	return result;
}
