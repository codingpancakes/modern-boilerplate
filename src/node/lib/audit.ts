import type { APIGatewayProxyEvent } from "aws-lambda";
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

/**
 * Audit Log Entry
 */
export interface AuditLogEntry {
	userId?: string;
	organizationId?: string;
	action: AuditAction;
	resourceType: AuditResourceType;
	resourceId?: string;
	changes?: {
		before?: any;
		after?: any;
	};
	ipAddress?: string;
	userAgent?: string;
	requestId?: string;
	metadata?: Record<string, any>;
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
 *   resourceType: AUDIT_RESOURCE_TYPES.CONTACT,
 *   resourceId: contact.id,
 *   changes: { after: contact },
 *   ipAddress: event.requestContext.identity.sourceIp,
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
			action: entry.action,
			resourceType: entry.resourceType,
			resourceId: entry.resourceId,
			changes: entry.changes as any,
			ipAddress: entry.ipAddress,
			userAgent: entry.userAgent,
			requestId: entry.requestId,
			metadata: entry.metadata as any,
			status: entry.status || AUDIT_STATUS.SUCCESS,
			errorMessage: entry.errorMessage,
		});
	} catch (error) {
		// Don't throw - audit logging should never break the main flow
		console.error("Failed to log audit event:", error);
	}
}

/**
 * Extract request context from API Gateway event
 */
export function extractRequestContext(event: APIGatewayProxyEvent) {
	return {
		ipAddress: event.requestContext?.identity?.sourceIp,
		userAgent: event.headers?.["User-Agent"] || event.headers?.["user-agent"],
		requestId: event.requestContext?.requestId,
	};
}

/**
 * Audit middleware for Lambda handlers
 *
 * Automatically logs the action with request context.
 *
 * @example
 * ```typescript
 * export const handler = withAudit(
 *   async (event, context, auditLog) => {
 *     const contact = await createContact(data);
 *
 *     // Log the audit event
 *     await auditLog({
 *       action: AUDIT_ACTIONS.CREATE,
 *       resourceType: AUDIT_RESOURCE_TYPES.CONTACT,
 *       resourceId: contact.id,
 *       changes: { after: contact },
 *     });
 *
 *     return { statusCode: 200, body: JSON.stringify(contact) };
 *   }
 * );
 * ```
 */
export function withAudit<T = any>(
	handler: (
		event: APIGatewayProxyEvent,
		context: any,
		auditLog: (
			entry: Omit<AuditLogEntry, "ipAddress" | "userAgent" | "requestId">,
		) => Promise<void>,
	) => Promise<T>,
) {
	return async (event: APIGatewayProxyEvent, context: any): Promise<T> => {
		const requestContext = extractRequestContext(event);

		// Create audit log function with pre-filled request context
		const auditLog = async (
			entry: Omit<AuditLogEntry, "ipAddress" | "userAgent" | "requestId">,
		) => {
			await logAudit({
				...entry,
				...requestContext,
				userId: entry.userId || context.userId,
				organizationId: entry.organizationId || context.organizationId,
			});
		};

		return handler(event, context, auditLog);
	};
}

/**
 * Audit decorator for GraphQL resolvers
 *
 * @example
 * ```typescript
 * const resolvers = {
 *   Mutation: {
 *     createContact: auditResolver(
 *       async (parent, args, context) => {
 *         const contact = await createContact(args.input);
 *         return contact;
 *       },
 *       {
 *         action: AUDIT_ACTIONS.CREATE,
 *         resourceType: AUDIT_RESOURCE_TYPES.CONTACT,
 *         getResourceId: (result) => result.id,
 *         getChanges: (result) => ({ after: result }),
 *       }
 *     ),
 *   },
 * };
 * ```
 */
export function auditResolver<TArgs = any, TResult = any>(
	resolver: (
		parent: any,
		args: TArgs,
		context: any,
		info: any,
	) => Promise<TResult>,
	options: {
		action: AuditAction;
		resourceType: AuditResourceType;
		getResourceId?: (result: TResult, args: TArgs) => string | undefined;
		getChanges?: (
			result: TResult,
			args: TArgs,
		) => { before?: any; after?: any } | undefined;
		getMetadata?: (
			result: TResult,
			args: TArgs,
		) => Record<string, any> | undefined;
	},
) {
	return async (
		parent: any,
		args: TArgs,
		context: any,
		info: any,
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
				metadata: options.getMetadata?.(undefined as any, args),
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
			changes: options.getChanges?.(result, args) as any,
			metadata: options.getMetadata?.(result, args),
			status,
		});

		return result;
	};
}

// Re-export constants for convenience
export { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, AUDIT_STATUS };
