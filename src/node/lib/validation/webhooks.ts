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

/**
 * Authentication-lifecycle events emitted by WorkOS. We don't enumerate every
 * provider variant (`authentication.password_succeeded`,
 * `authentication.sso_failed`, …); instead we match the `authentication.`
 * prefix plus `session.created` and derive success/failure from the suffix.
 */
export function isWorkOSAuthEvent(event: string): boolean {
	return event.startsWith("authentication.") || event === "session.created";
}

export function isWorkOSAuthFailure(event: string): boolean {
	return event.endsWith("_failed");
}

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

const workosAuthData = z
	.object({
		user_id: z.string().min(1).optional(),
		email: z.string().email().optional(),
		ip_address: z.string().optional().nullable(),
		user_agent: z.string().optional().nullable(),
		type: z.string().optional(),
	})
	.passthrough();

// `event` is accepted as a free-form string (not a strict enum) because the
// payload is already authenticated via HMAC signature, and WorkOS emits a wide
// and evolving catalog of `authentication.*` events we want to audit without
// having to enumerate each one. Unknown events are ignored by the handler.
export const workosWebhookEvent = z.object({
	id: z.string(),
	event: z.string().min(1),
	data: z.record(z.unknown()),
	created_at: z.string(),
});

export type WorkOSUserData = z.infer<typeof workosUserData>;
export type WorkOSOrgData = z.infer<typeof workosOrgData>;
export type WorkOSAuthData = z.infer<typeof workosAuthData>;

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

export function parseWorkOSAuthData(
	data: Record<string, unknown>,
): WorkOSAuthData {
	return workosAuthData.parse(data);
}

// Re-exported so the strict event list remains available for documentation/tests.
export { WORKOS_EVENT_TYPES };

/**
 * Webhook schemas object
 */
export const webhookSchemas = {
	workos: workosWebhookEvent,
};
