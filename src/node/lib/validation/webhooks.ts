/**
 * Webhook Validation Schemas
 *
 * Schemas for external webhook events.
 */

import { z } from "zod";

const WORKOS_USER_EVENT_TYPES = [
	"user.created",
	"user.updated",
	"user.deleted",
] as const;

const WORKOS_ORG_EVENT_TYPES = [
	"organization.created",
	"organization.updated",
	"organization.deleted",
] as const;

const WORKOS_EVENT_TYPES = [
	...WORKOS_USER_EVENT_TYPES,
	...WORKOS_ORG_EVENT_TYPES,
] as const;

const workosUserData = z
	.object({
		id: z.string().min(1),
		email: z.string().email(),
		first_name: z
			.string()
			.nullable()
			.transform((v) => v ?? "")
			.default(""),
		last_name: z
			.string()
			.nullable()
			.transform((v) => v ?? "")
			.default(""),
	})
	.passthrough();

const workosOrgData = z
	.object({
		id: z.string().min(1),
		name: z.string().min(1),
	})
	.passthrough();

export const workosWebhookEvent = z.object({
	id: z.string(),
	event: z.enum(WORKOS_EVENT_TYPES),
	data: z.record(z.unknown()),
	created_at: z.string(),
});

export type WorkOSUserData = z.infer<typeof workosUserData>;
export type WorkOSOrgData = z.infer<typeof workosOrgData>;

export function parseWorkOSUserData(
	data: Record<string, unknown>,
): WorkOSUserData {
	return workosUserData.parse(data);
}

export function parseWorkOSOrgData(
	data: Record<string, unknown>,
): WorkOSOrgData {
	return workosOrgData.parse(data);
}

/**
 * Webhook schemas object
 */
export const webhookSchemas = {
	workos: workosWebhookEvent,
};
