import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	type AuditAction,
	type AuditResourceType,
	type AuditStatus,
	auditLogs,
} from "../db/schema";
import { getDb } from "./db";
import { captureException } from "./sentry";

/**
 * Context with audit fields
 */
export interface AuditContext {
	userId?: string;
	organizationId?: string;
}

/**
 * Audit Log Entry
 */
export interface AuditLogEntry {
	userId?: string;
	organizationId?: string;
	orgUnitId?: string;
	action: AuditAction;
	resourceType: AuditResourceType;
	resourceId?: string;
	changes?: {
		before?: unknown;
		after?: unknown;
	};
	ipAddress?: string;
	userAgent?: string;
	requestId?: string;
	metadata?: Record<string, unknown>;
	status?: AuditStatus;
	errorMessage?: string;
}

/**
 * Log an audit event
 *
 * @example
 * ```typescript
 * await logAudit({
 *   userId: user.id,
 *   organizationId: org.id,
 *   action: AUDIT_ACTIONS.CREATE,
 *   resourceType: AUDIT_RESOURCE_TYPES.USER,
 *   resourceId: newUser.id,
 *   changes: { after: newUser },
 *   ipAddress: event.requestContext?.http?.sourceIp,
 *   status: AUDIT_STATUS.SUCCESS,
 * });
 * ```
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
	try {
		const db = await getDb();
		await db.insert(auditLogs).values({
			userId: entry.userId,
			organizationId: entry.organizationId,
			orgUnitId: entry.orgUnitId,
			action: entry.action,
			resourceType: entry.resourceType,
			resourceId: entry.resourceId,
			changes: entry.changes,
			ipAddress: entry.ipAddress,
			userAgent: entry.userAgent,
			requestId: entry.requestId,
			metadata: entry.metadata,
			status: entry.status || AUDIT_STATUS.SUCCESS,
			errorMessage: entry.errorMessage,
		});
	} catch (error) {
		// Don't throw - audit logging should never break the main flow
		if (process.env.NODE_ENV !== "test") {
			console.error("Failed to log audit event:", error);
			const err = error instanceof Error ? error : new Error(String(error));
			captureException(err);
		}
	}
}

/**
 * Extract request context from API Gateway V2 event
 */
export function extractRequestContext(event: APIGatewayProxyEventV2) {
	return {
		ipAddress: event.requestContext?.http?.sourceIp,
		userAgent: event.headers?.["user-agent"],
		requestId: event.requestContext?.requestId,
	};
}

/**
 * Audit decorator for GraphQL resolvers
 *
 * @example
 * ```typescript
 * const resolvers = {
 *   Mutation: {
 *     updateMe: auditResolver(
 *       async (parent, args, context) => {
 *         const user = await updateUser(args.input);
 *         return user;
 *       },
 *       {
 *         action: AUDIT_ACTIONS.UPDATE,
 *         resourceType: AUDIT_RESOURCE_TYPES.USER,
 *         getResourceId: (result) => result.id,
 *         getChanges: (result) => ({ after: result }),
 *       }
 *     ),
 *   },
 * };
 * ```
 */
export function auditResolver<
	TArgs = unknown,
	TResult = unknown,
	TContext extends AuditContext = AuditContext,
>(
	resolver: (
		parent: unknown,
		args: TArgs,
		context: TContext,
		info: unknown,
	) => Promise<TResult>,
	options: {
		action: AuditAction;
		resourceType: AuditResourceType;
		getResourceId?: (result: TResult, args: TArgs) => string | undefined;
		getChanges?: (
			result: TResult,
			args: TArgs,
		) => { before?: unknown; after?: unknown } | undefined;
		getMetadata?: (
			result: TResult,
			args: TArgs,
		) => Record<string, unknown> | undefined;
	},
) {
	return async (
		parent: unknown,
		args: TArgs,
		context: TContext,
		info: unknown,
	): Promise<TResult> => {
		let result: TResult;
		let status: AuditStatus = AUDIT_STATUS.SUCCESS;
		let errorMessage: string | undefined;

		try {
			result = await resolver(parent, args, context, info);
		} catch (error) {
			status = AUDIT_STATUS.FAILURE;
			errorMessage = error instanceof Error ? error.message : String(error);

			// Log the failure
			await logAudit({
				userId: context.userId,
				organizationId: context.organizationId,
				action: options.action,
				resourceType: options.resourceType,
				status,
				errorMessage,
				metadata: options.getMetadata?.(undefined as TResult, args),
			});

			// Re-throw the error
			throw error;
		}

		// Log the success
		await logAudit({
			userId: context.userId,
			organizationId: context.organizationId,
			action: options.action,
			resourceType: options.resourceType,
			resourceId: options.getResourceId?.(result, args),
			changes: options.getChanges?.(result, args),
			metadata: options.getMetadata?.(result, args),
			status,
		});

		return result;
	};
}

// Re-export constants for convenience
export { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, AUDIT_STATUS };
