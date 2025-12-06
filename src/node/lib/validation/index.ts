/**
 * Validation Module
 *
 * Centralized validation with domain-organized schemas.
 *
 * @example
 * // Import helpers
 * import { validate, parseBody } from './validation';
 *
 * // Import specific domain schemas
 * import { userSchemas } from './validation';
 *
 * // Or use the unified schemas object (backward compatible)
 * import { schemas } from './validation';
 * const input = parseBody(event, schemas.createUser);
 */

// Re-export helpers
export { parseBody, parseParams, parseQuery, validate } from "./helpers";

// Import domain schemas for unified object
import { commonSchemas } from "./common";
import { mediaSchemas } from "./media";
import { organizationSchemas } from "./organizations";
import { userSchemas } from "./users";
import { webhookSchemas } from "./webhooks";

// Re-export domain schemas
export {
	commonSchemas,
	userSchemas,
	mediaSchemas,
	organizationSchemas,
	webhookSchemas,
};

// Re-export individual schemas for direct import
export * from "./common";
export * from "./media";
export * from "./organizations";
export * from "./users";
export * from "./webhooks";

/**
 * Unified schemas object (backward compatible)
 *
 * @deprecated Use domain-specific imports instead (e.g., userSchemas.create)
 * This is maintained for backward compatibility with existing handlers.
 */
export const schemas = {
	// Common
	paginationQuery: commonSchemas.pagination,
	idParam: commonSchemas.idParam,

	// Users (backward compatible names)
	createUser: userSchemas.create,
	updateUser: userSchemas.update,
	updateUserProfile: userSchemas.updateProfile,

	// Media (backward compatible names)
	uploadImageRequest: mediaSchemas.uploadImage,
	uploadImageDirectRequest: mediaSchemas.uploadImageDirect,
	listImagesQuery: mediaSchemas.listImages,

	// Organizations (backward compatible names)
	createOrganization: organizationSchemas.create,
	createOrgUnit: organizationSchemas.createOrgUnit,

	// Webhooks (backward compatible names)
	workosWebhookEvent: webhookSchemas.workos,
};
