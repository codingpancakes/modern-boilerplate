/**
 * Organization Validation Schemas
 */

import { z } from "zod";

export const createOrganization = z.object({
	name: z.string().min(1).max(200),
	slug: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
	orgType: z.string().max(50).optional(),
	visibility: z.string().max(50).optional(),
	defaultTimezone: z.string().max(50).optional(),
	countryCode: z.string().length(2).optional(),
	branding: z.record(z.unknown()).optional(),
	metadata: z.record(z.unknown()).optional(),
});

export const updateOrganization = z.object({
	name: z.string().min(1).max(200).optional(),
	slug: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens")
		.optional(),
	orgType: z.string().max(50).optional(),
	visibility: z.string().max(50).optional(),
	defaultTimezone: z.string().max(50).optional(),
	countryCode: z.string().length(2).optional(),
	branding: z.record(z.unknown()).optional(),
	metadata: z.record(z.unknown()).optional(),
});

const orgRoles = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;

export const inviteMember = z.object({
	userId: z.string().uuid(),
	role: z.enum(orgRoles).default("MEMBER"),
});

export const updateMemberRole = z.object({
	memberId: z.string().uuid(),
	role: z.enum(orgRoles),
});

export const createOrgUnit = z.object({
	organizationId: z.string().uuid(),
	parentId: z.string().uuid().optional(),
	code: z.string().max(100).optional(),
	name: z.string().min(1).max(200),
	isRoot: z.boolean().optional(),
	metadata: z.record(z.unknown()).optional(),
});

export const organizationSchemas = {
	create: createOrganization,
	update: updateOrganization,
	inviteMember,
	updateMemberRole,
	createOrgUnit,
};
