import { eq } from "drizzle-orm";
import { profiles, users } from "../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	type AuditContext,
	type AuditLogEntry,
	logAudit,
} from "../audit";
import type { DbClient, DbInstance, DbTransaction } from "../db";
import { Errors } from "../errors";
import { sanitizeObject } from "../sanitize";
import { validate } from "../validation/helpers";
import { userSchemas } from "../validation/users";

export interface AccountUpdateResult {
	user: typeof users.$inferSelect;
	profile: typeof profiles.$inferSelect;
}

interface UpdateFields {
	fields: string[];
	values?: Record<string, unknown>;
}

export interface AccountUpdateWithAudit {
	result: AccountUpdateResult;
	auditEntry: AuditLogEntry;
}

function validateAccountUpdateInput(input: unknown) {
	return validate(userSchemas.updateProfile, input);
}

function updateFields(
	partial: object | undefined,
	timestamp: string,
): UpdateFields {
	if (!partial || Object.keys(partial).length === 0) {
		return { fields: [] };
	}

	const defined = Object.fromEntries(
		Object.entries(partial).filter(([, value]) => value !== undefined),
	);
	if (Object.keys(defined).length === 0) {
		return { fields: [] };
	}

	const sanitized = sanitizeObject(defined);
	const fields = Object.keys(sanitized);
	if (fields.length === 0) {
		return { fields: [] };
	}

	return {
		fields,
		values: {
			...sanitized,
			updatedAt: timestamp,
		},
	};
}

export async function updateMyAccount(options: {
	db: DbInstance;
	userId: string;
	input: unknown;
	auditContext: AuditContext;
	source: "graphql" | "rest";
}): Promise<AccountUpdateResult> {
	const update = await options.db.transaction((tx) =>
		updateMyAccountOnClient(tx, {
			userId: options.userId,
			input: options.input,
			auditContext: options.auditContext,
			source: options.source,
		}),
	);

	logAccountUpdateAudit(update.auditEntry);
	return update.result;
}

export async function updateMyAccountInTransaction(options: {
	tx: DbTransaction;
	userId: string;
	input: unknown;
	auditContext: AuditContext;
	source: "graphql" | "rest";
}): Promise<AccountUpdateWithAudit> {
	return updateMyAccountOnClient(options.tx, {
		userId: options.userId,
		input: options.input,
		auditContext: options.auditContext,
		source: options.source,
	});
}

export function logAccountUpdateAudit(entry: AuditLogEntry): void {
	void logAudit(entry);
}

async function updateMyAccountOnClient(
	db: DbClient,
	options: {
		userId: string;
		input: unknown;
		auditContext: AuditContext;
		source: "graphql" | "rest";
	},
): Promise<AccountUpdateWithAudit> {
	const input = validateAccountUpdateInput(options.input);
	const timestamp = new Date().toISOString();
	const userUpdate = updateFields(input.user, timestamp);
	const profileUpdate = updateFields(input.profile, timestamp);

	if (!userUpdate.values && !profileUpdate.values) {
		throw Errors.BadRequest("No fields to update");
	}

	const curUserRows = await db
		.select()
		.from(users)
		.where(eq(users.id, options.userId))
		.limit(1);
	const curProfileRows = await db
		.select()
		.from(profiles)
		.where(eq(profiles.userId, options.userId))
		.limit(1);
	const currentUser = curUserRows[0];
	const currentProfile = curProfileRows[0];

	const updatedUser = userUpdate.values
		? await db
				.update(users)
				.set(userUpdate.values)
				.where(eq(users.id, options.userId))
				.returning()
				.then((rows) => rows[0])
		: currentUser;

	const updatedProfile = profileUpdate.values
		? await db
				.update(profiles)
				.set(profileUpdate.values)
				.where(eq(profiles.userId, options.userId))
				.returning()
				.then((rows) => rows[0])
		: currentProfile;

	if (!updatedUser) {
		throw Errors.NotFound("User");
	}
	if (!updatedProfile) {
		throw Errors.NotFound("Profile");
	}

	const resourceType =
		userUpdate.fields.length > 0
			? AUDIT_RESOURCE_TYPES.USER
			: AUDIT_RESOURCE_TYPES.PROFILE;

	return {
		result: {
			user: updatedUser,
			profile: updatedProfile,
		},
		auditEntry: {
			userId: options.userId,
			organizationId: options.auditContext.organizationId,
			action: AUDIT_ACTIONS.UPDATE,
			resourceType,
			resourceId: options.userId,
			changes: {
				before: { user: currentUser, profile: currentProfile },
				after: { user: updatedUser, profile: updatedProfile },
			},
			ipAddress: options.auditContext.ipAddress,
			userAgent: options.auditContext.userAgent,
			requestId: options.auditContext.requestId,
			status: AUDIT_STATUS.SUCCESS,
			metadata: {
				source: options.source,
				updatedFields: {
					user: userUpdate.fields,
					profile: profileUpdate.fields,
				},
			},
		},
	};
}
