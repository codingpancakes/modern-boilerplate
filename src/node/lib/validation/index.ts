/**
 * Validation Module
 *
 * Centralized validation with domain-organized schemas.
 *
 * @example
 * // Import the validate helper
 * import { validate } from "./validation";
 *
 * // Import specific domain schemas
 * import { userSchemas } from "./validation";
 * const input = validate(userSchemas.create, body);
 */

// Re-export the validate helper
export { validate } from "./helpers";

// Import domain schemas for the bundled re-export
import { mediaSchemas } from "./media";
import { organizationSchemas } from "./organizations";
import { userSchemas } from "./users";
import { webhookSchemas } from "./webhooks";

// Re-export individual schemas for direct import
export * from "./media";
export * from "./organizations";
export * from "./users";
export * from "./webhooks";

// Re-export domain schema bundles
export { mediaSchemas, organizationSchemas, userSchemas, webhookSchemas };
