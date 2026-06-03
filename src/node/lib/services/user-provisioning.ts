import { Logger } from "@aws-lambda-powertools/logger";
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
	logAudit,
} from "../audit";
import type { DbInstance } from "../db";
import {
	isWorkOSAuthFailure,
	type WorkOSAuthData,
} from "../validation/webhooks";

const logger = new Logger({ serviceName: "user-provisioning" });

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

/**
 * Atomic user + profile + authIdentity creation inside a transaction.
 * Shared by the WorkOS webhook flow and the JIT provisioning in auth.ts.
 */
export async function createUserWithIdentity(
	db: DbInstance,
	data: ProvisionUserData,
): Promise<string> {
	return db.transaction(async (tx) => {
		const [newUser] = await tx
			.insert(users)
			.values({
				email: data.email,
				firstName: data.firstName || null,
				lastName: data.lastName || null,
				type: "MEMBER",
			})
			.returning({ id: users.id });

		await tx.insert(profiles).values({ userId: newUser.id });
		await tx.insert(authIdentities).values({
			userId: newUser.id,
			providerType: "workos",
			providerSubject: data.providerSubject,
			emailAtProvider: data.email,
		});

		return newUser.id;
	});
}

export async function upsertUserFromWorkOS(
	db: DbInstance,
	userData: WorkOSUserData,
	eventType: string,
): Promise<void> {
	// Entire upsert runs in a single transaction to prevent the race where
	// two concurrent webhooks both see "no row" and both try to create.
	const result = await db.transaction(async (tx) => {
		const [existingAuth] = await tx
			.select({ userId: authIdentities.userId })
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, userData.id),
				),
			)
			.limit(1);

		if (existingAuth?.userId) {
			await tx
				.update(users)
				.set({
					email: userData.email,
					firstName: userData.first_name,
					lastName: userData.last_name,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(users.id, existingAuth.userId));

			return { action: "updated" as const, userId: existingAuth.userId };
		}

		const [newUser] = await tx
			.insert(users)
			.values({
				email: userData.email,
				firstName: userData.first_name || null,
				lastName: userData.last_name || null,
				type: "MEMBER",
			})
			.returning({ id: users.id });

		await tx.insert(profiles).values({ userId: newUser.id });
		await tx.insert(authIdentities).values({
			userId: newUser.id,
			providerType: "workos",
			providerSubject: userData.id,
			emailAtProvider: userData.email,
		});

		return { action: "created" as const, userId: newUser.id };
	});

	void logAudit({
		userId: result.userId,
		action:
			result.action === "created" ? AUDIT_ACTIONS.CREATE : AUDIT_ACTIONS.UPDATE,
		resourceType: AUDIT_RESOURCE_TYPES.USER,
		resourceId: result.userId,
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: "workos_webhook",
			eventType,
			providerSubject: userData.id,
		},
	});

	if (result.action === "created") {
		logger.info("User created successfully", {
			userId: result.userId,
			providerSubject: userData.id,
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
	const userId = await db.transaction(async (tx) => {
		const [authIdentity] = await tx
			.select({ userId: authIdentities.userId })
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, userData.id),
				),
			)
			.limit(1);

		const uid = authIdentity?.userId;
		if (!uid) return null;

		await tx
			.update(users)
			.set({
				status: "deleted",
				email: null,
				firstName: null,
				lastName: null,
				phone: null,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(users.id, uid));

		await tx.delete(authIdentities).where(eq(authIdentities.userId, uid));

		return uid;
	});

	if (!userId) return;

	void logAudit({
		userId,
		action: AUDIT_ACTIONS.DELETE,
		resourceType: AUDIT_RESOURCE_TYPES.USER,
		resourceId: userId,
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: "workos_webhook",
			eventType,
			providerSubject: userData.id,
		},
	});
}

export async function upsertOrgFromWorkOS(
	db: DbInstance,
	orgData: WorkOSOrgData,
	eventType: string,
): Promise<void> {
	const [org] = await db
		.insert(organizations)
		.values({
			workosOrgId: orgData.id,
			name: orgData.name,
		})
		.onConflictDoUpdate({
			target: organizations.workosOrgId,
			set: {
				name: orgData.name,
				updatedAt: new Date().toISOString(),
			},
		})
		.returning({ id: organizations.id });

	void logAudit({
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
			eventType,
			workosOrgId: orgData.id,
		},
	});
}

export async function deleteOrgFromWorkOS(
	db: DbInstance,
	orgData: WorkOSOrgData,
	eventType: string,
): Promise<void> {
	const deleted = await db.transaction(async (tx) => {
		const [del] = await tx
			.update(organizations)
			.set({ status: "DELETED", updatedAt: new Date().toISOString() })
			.where(eq(organizations.workosOrgId, orgData.id))
			.returning({ id: organizations.id });

		if (!del) return null;

		await tx
			.update(organizationMembers)
			.set({
				status: "INACTIVE",
				updatedAt: new Date().toISOString(),
			})
			.where(eq(organizationMembers.organizationId, del.id));

		return del;
	});

	if (!deleted) return;

	void logAudit({
		organizationId: deleted.id,
		action: AUDIT_ACTIONS.DELETE,
		resourceType: AUDIT_RESOURCE_TYPES.ORGANIZATION,
		resourceId: deleted.id,
		status: AUDIT_STATUS.SUCCESS,
		metadata: {
			source: "workos_webhook",
			eventType,
			workosOrgId: orgData.id,
		},
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
	const failed = isWorkOSAuthFailure(eventType);

	let userId: string | undefined;
	if (authData.user_id) {
		const [identity] = await db
			.select({ userId: authIdentities.userId })
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.providerType, "workos"),
					eq(authIdentities.providerSubject, authData.user_id),
				),
			)
			.limit(1);
		userId = identity?.userId ?? undefined;
	}

	void logAudit({
		userId,
		action: failed ? AUDIT_ACTIONS.LOGIN_FAILED : AUDIT_ACTIONS.LOGIN,
		resourceType: AUDIT_RESOURCE_TYPES.USER,
		resourceId: userId,
		ipAddress: authData.ip_address ?? undefined,
		userAgent: authData.user_agent ?? undefined,
		status: failed ? AUDIT_STATUS.FAILURE : AUDIT_STATUS.SUCCESS,
		metadata: {
			source: "workos_webhook",
			eventType,
			providerSubject: authData.user_id,
			email: authData.email,
			authType: authData.type,
		},
	});
}
