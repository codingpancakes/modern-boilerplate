/**
 * Webhook Validation Schemas
 *
 * Schemas for external webhook events.
 */

import { z } from "zod";

/**
 * WorkOS webhook event schema
 */
export const workosWebhookEvent = z.object({
	id: z.string(),
	event: z.string(),
	data: z.record(z.unknown()),
	created_at: z.string(),
});

/**
 * Webhook schemas object
 */
export const webhookSchemas = {
	workos: workosWebhookEvent,
};
