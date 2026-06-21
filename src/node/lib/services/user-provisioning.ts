import { and, eq } from "drizzle-orm";
import {
	authIdentities,
	organizationMembers,
	organizations,
	profiles,
	users,
} from "../../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	writeAuditLog,
} from "../audit";
import type { DbInstance } from "../db";
import { createLogger } from "../logger";
import { sanitizeObject } from "../sanitize";
import { RECORD_STATUS } from "../status";
import {
	isWorkOSAuthFailure,
	type WorkOSAuthData,
} from "../validation/webhooks";

const logger = createLogger({ serviceName: "user-provisioning" });

interface WorkOSUserData {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
}

interface WorkOSOrgData {
	id: string;
	name: string;
}

export interface ProvisionUserData {
	providerSubject: string;
	email: string | null;
	firstName?: string | null;
	lastName?: string | null;
}

interface SanitizedProvisionUserData {
	providerSubject: string;
	email: string | null;
	firstName: string | null;
	lastName: string | null;
}

function sanitizeProvisionUserData(
	data: ProvisionUserData,
): SanitizedProvisionUserData {
	return sanitizeObject({
		providerSubject: data.providerSubject,
		email: data.email,
		firstName: data.firstName ?? null,
		lastName: data.lastName ?? null,
	});
}

function sanitizeWorkOSUserData(data: WorkOSUserData): WorkOSUserData {
	return sanitizeObject({
		id: data.id,
		email: data.email,
		first_name: data.first_name,
		last_name: data.last_name,
	});
}

function sanitizeWorkOSOrgData(data: WorkOSOrgData): WorkOSOrgData {
	return sanitizeObject({
		id: data.id,
		name: data.name,
	});
}

function sanitizeWorkOSAuthData(data: WorkOSAuthData): WorkOSAuthData {
	return sanitizeObject({
		user_id: data.user_id,
		email: data.email,
		ip_address: data.ip_address,
		user_agent: data.user_agent,
		type: data.type,
	});
}

function sanitizeEventType(eventType: string): string {
	return sanitizeObject({ eventType }).eventType;
}

/**
 * Atomic user + profile + authIdentity creation inside a transaction.
 * Shared by the WorkOS webhook flow and the JIT provisioning in auth.ts.
 */
export async function createUserWithIdentity(
	db: DbInstance,
	data: ProvisionUserData,
): Promise<string> {
	const sanitized = sanitizeProvisionUserData(data);

	return db.transaction(async (tx) => {
		const [newUser] = await tx
			.insert(users)
			.values({
				email: sanitized.email,
				firstName: sanitized.firstName || null,
				lastName: sanitized.lastName || null,
				type: "MEMBER",
			})
			.returning({ id: users.id });

		await tx.insert(profiles).values({ userId: newUser.id });
		await tx.insert(authIdentities).values({
			userId: newUser.id,
			providerType: "workos",
			providerSubject: sanitized.providerSubject,
			emailAtProvider: sanitized.email,
		});

		return newUser.id;
	});
}

export async function upsertUserFromWorkOS(
	db: DbInstance,
	userData: WorkOSUserData,
	eventType: string,
): Promise<void> {
	const sanitized = sanitizeWorkOSUserData(userData);
	const sanitizedEventType = sanitizeEventType(eventType);

	// Entire upsert runs in a single transaction to prevent the race where
	// two concurrent webhooks both see "no row" and both try to create.
	const result = await db.transaction(async (tx) => {
		const [existingAuth] = await tx
			.select({ userId: authIdentities.userId })
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, sanitized.id),
				),
			)
			.limit(1);

		let result: { action: "created" | "updated"; userId: string };

		if (existingAuth?.userId) {
			await tx
				.update(users)
				.set({
					email: sanitized.email,
					firstName: sanitized.first_name,
					lastName: sanitized.last_name,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(users.id, existingAuth.userId));

			result = { action: "updated", userId: existingAuth.userId };
		} else {
			const [newUser] = await tx
				.insert(users)
				.values({
					email: sanitized.email,
					firstName: sanitized.first_name || null,
					lastName: sanitized.last_name || null,
					type: "MEMBER",
				})
				.returning({ id: users.id });

			await tx.insert(profiles).values({ userId: newUser.id });
			await tx.insert(authIdentities).values({
				userId: newUser.id,
				providerType: "workos",
				providerSubject: sanitized.id,
				emailAtProvider: sanitized.email,
			});

			result = { action: "created", userId: newUser.id };
		}

		await writeAuditLog(tx, {
			userId: result.userId,
			action:
				result.action === "created"
					? AUDIT_ACTIONS.CREATE
					: AUDIT_ACTIONS.UPDATE,
			resourceType: AUDIT_RESOURCE_TYPES.USER,
			resourceId: result.userId,
			status: AUDIT_STATUS.SUCCESS,
			metadata: {
				source: "workos_webhook",
				eventType: sanitizedEventType,
				providerSubject: sanitized.id,
			},
		});

		return result;
	});

	if (result.action === "created") {
		logger.info("User created successfully", {
			userId: result.userId,
			providerSubject: sanitized.id,
		});
	} else {
		logger.info("User updated", { userId: result.userId });
	}
}

export async function deleteUserFromWorkOS(
	db: DbInstance,
	userData: WorkOSUserData,
	eventType: string,
): Promise<void> {
	const sanitized = sanitizeWorkOSUserData(userData);
	const sanitizedEventType = sanitizeEventType(eventType);

	await db.transaction(async (tx) => {
		const [authIdentity] = await tx
			.select({ userId: authIdentities.userId })
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, sanitized.id),
				),
			)
			.limit(1);

		const uid = authIdentity?.userId;
		if (!uid) return null;

		await tx
			.update(users)
			.set({
				status: RECORD_STATUS.DELETED,
				email: null,
				firstName: null,
				lastName: null,
				phone: null,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(users.id, uid));

		await tx.delete(authIdentities).where(eq(authIdentities.userId, uid));

		await writeAuditLog(tx, {
			userId: uid,
			action: AUDIT_ACTIONS.DELETE,
			resourceType: AUDIT_RESOURCE_TYPES.USER,
			resourceId: uid,
			status: AUDIT_STATUS.SUCCESS,
			metadata: {
				source: "workos_webhook",
				eventType: sanitizedEventType,
				providerSubject: sanitized.id,
			},
		});

		return uid;
	});
}

export async function upsertOrgFromWorkOS(
	db: DbInstance,
	orgData: WorkOSOrgData,
	eventType: string,
): Promise<void> {
	const sanitized = sanitizeWorkOSOrgData(orgData);
	const sanitizedEventType = sanitizeEventType(eventType);

	await db.transaction(async (tx) => {
		const [org] = await tx
			.insert(organizations)
			.values({
				workosOrgId: sanitized.id,
				name: sanitized.name,
			})
			.onConflictDoUpdate({
				target: organizations.workosOrgId,
				set: {
					name: sanitized.name,
					updatedAt: new Date().toISOString(),
				},
			})
			.returning({ id: organizations.id });

		await writeAuditLog(tx, {
			organizationId: org?.id,
			action:
				eventType === "organization.created"
					? AUDIT_ACTIONS.CREATE
					: AUDIT_ACTIONS.UPDATE,
			resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
			resourceId: org?.id,
			status: AUDIT_STATUS.SUCCESS,
			metadata: {
				source: "workos_webhook",
				eventType: sanitizedEventType,
				workosOrgId: sanitized.id,
			},
		});
	});
}

export async function deleteOrgFromWorkOS(
	db: DbInstance,
	orgData: WorkOSOrgData,
	eventType: string,
): Promise<void> {
	const sanitized = sanitizeWorkOSOrgData(orgData);
	const sanitizedEventType = sanitizeEventType(eventType);

	await db.transaction(async (tx) => {
		const [del] = await tx
			.update(organizations)
			.set({
				status: RECORD_STATUS.DELETED,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(organizations.workosOrgId, sanitized.id))
			.returning({ id: organizations.id });

		if (!del) return null;

		await tx
			.update(organizationMembers)
			.set({
				status: RECORD_STATUS.INACTIVE,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(organizationMembers.organizationId, del.id));

		await writeAuditLog(tx, {
			organizationId: del.id,
			action: AUDIT_ACTIONS.DELETE,
			resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
			resourceId: del.id,
			status: AUDIT_STATUS.SUCCESS,
			metadata: {
				source: "workos_webhook",
				eventType: sanitizedEventType,
				workosOrgId: sanitized.id,
			},
		});

		return del;
	});
}

/**
 * Record an authentication-lifecycle event (login / failed login) emitted by
 * WorkOS into the audit trail. Resolves the internal user id from the provider
 * subject when available; failed logins may have no resolvable user, which is
 * expected and still logged for security forensics.
 */
export async function recordAuthEventFromWorkOS(
	db: DbInstance,
	authData: WorkOSAuthData,
	eventType: string,
): Promise<void> {
	const sanitized = sanitizeWorkOSAuthData(authData);
	const sanitizedEventType = sanitizeEventType(eventType);
	const failed = isWorkOSAuthFailure(eventType);

	let userId: string | undefined;
	if (sanitized.user_id) {
		const [identity] = await db
			.select({ userId: authIdentities.userId })
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, sanitized.user_id),
				),
			)
			.limit(1);
		userId = identity?.userId ?? undefined;
	}

	await writeAuditLog(db, {
		userId,
		action: failed ? AUDIT_ACTIONS.LOGIN_FAILED : AUDIT_ACTIONS.LOGIN,
		resourceType: AUDIT_RESOURCE_TYPES.USER,
		resourceId: userId,
		ipAddress: sanitized.ip_address ?? undefined,
		userAgent: sanitized.user_agent ?? undefined,
		status: failed ? AUDIT_STATUS.FAILURE : AUDIT_STATUS.SUCCESS,
		metadata: {
			source: "workos_webhook",
			eventType: sanitizedEventType,
			providerSubject: sanitized.user_id,
			email: sanitized.email,
			authType: sanitized.type,
		},
	});
}
