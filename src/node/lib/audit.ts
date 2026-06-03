import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { lt } from "drizzle-orm";
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
import { errorMessage, toError } from "./error-utils";
import { captureException } from "./sentry";

/**
 * SOC 2 retention window for audit logs. Mirrored by the `audit_logs_guard`
 * DB trigger, which rejects deletes of any row newer than this — so logs are
 * tamper-proof within the window and only the retention job can prune beyond it.
 */
export const AUDIT_RETENTION_YEARS = 7;

const logger = new Logger({ serviceName: "audit" });

/**
 * Context with audit fields
 */
export interface AuditContext {
	userId?: string;
	organizationId?: string;
	requestId?: string;
	ipAddress?: string;
	userAgent?: string;
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
 * Keys whose values must never be persisted to the audit trail. Matched
 * case-insensitively as a substring of the field name, so `passwordHash`,
 * `accessToken`, `refreshToken`, etc. are all covered.
 */
const SENSITIVE_KEY_PATTERNS = [
	"password",
	"secret",
	"token",
	"apikey",
	"api_key",
	"authorization",
	"credential",
	"privatekey",
	"private_key",
	"sessionid",
	"session_id",
	"otp",
	"mfacode",
	"mfa_code",
];

const REDACTED = "[REDACTED]";

function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * Recursively redact credential/secret-bearing fields from a value before it is
 * written to the audit trail. PII fields (email, name, phone) are intentionally
 * preserved for forensic value; only secrets are masked. Bounded by depth to
 * avoid pathological/circular structures.
 */
function redactSensitive(value: unknown, depth = 0): unknown {
	if (depth > 8 || value === null || typeof value !== "object") {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => redactSensitive(item, depth + 1));
	}

	// Only recurse into plain objects. Class instances (Date, Buffer, Map, etc.)
	// are returned untouched so JSON serialization preserves their real shape
	// instead of collapsing to `{}`.
	const proto = Object.getPrototypeOf(value);
	if (proto !== null && proto !== Object.prototype) {
		return value;
	}

	const result: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
		result[key] = isSensitiveKey(key)
			? REDACTED
			: redactSensitive(val, depth + 1);
	}
	return result;
}

function redactChanges(
	changes: AuditLogEntry["changes"],
): AuditLogEntry["changes"] {
	if (!changes) return changes;
	return {
		before: redactSensitive(changes.before),
		after: redactSensitive(changes.after),
	};
}

/**
 * Log an audit event
 *
 * @example
 * ```typescript
 * void logAudit({
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
			changes: redactChanges(entry.changes),
			ipAddress: entry.ipAddress,
			userAgent: entry.userAgent,
			requestId: entry.requestId,
			metadata: entry.metadata,
			status: entry.status || AUDIT_STATUS.SUCCESS,
			errorMessage: entry.errorMessage,
		});
	} catch (error) {
		// Don't throw — audit logging should never break the main flow.
		// Log the full entry to CloudWatch as fallback so it can be backfilled.
		// Mirror every persisted column (changes still redacted) so a log-based
		// replay can fully reconstruct the row after a DB outage.
		const auditEntry = {
			action: entry.action,
			resourceType: entry.resourceType,
			resourceId: entry.resourceId,
			userId: entry.userId,
			organizationId: entry.organizationId,
			orgUnitId: entry.orgUnitId,
			changes: redactChanges(entry.changes),
			ipAddress: entry.ipAddress,
			userAgent: entry.userAgent,
			requestId: entry.requestId,
			status: entry.status ?? AUDIT_STATUS.SUCCESS,
			errorMessage: entry.errorMessage,
			metadata: entry.metadata,
		};

		if (process.env.NODE_ENV === "test") {
			// Silently swallow — no DB in unit tests
		} else {
			logger.error("Failed to log audit event — fallback to CloudWatch", {
				error: errorMessage(error),
				auditEntry,
			});
			captureException(toError(error));
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
 * Pull request-context audit fields off an already-built context (e.g. GraphQL
 * context). Spread into a `logAudit` call so manual log sites carry the same
 * IP / user-agent / request-id traceability as REST handlers.
 */
export function auditRequestContext(context: AuditContext) {
	return {
		requestId: context.requestId,
		ipAddress: context.ipAddress,
		userAgent: context.userAgent,
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
		/**
		 * Capture the resource's prior state *before* the resolver runs, so a
		 * before/after diff can be recorded. Must not mutate; failures here are
		 * swallowed so they can never break the mutation.
		 */
		getBefore?: (args: TArgs, context: TContext) => Promise<unknown> | unknown;
		getResourceId?: (result: TResult, args: TArgs) => string | undefined;
		getChanges?: (
			result: TResult,
			args: TArgs,
			before: unknown,
		) => { before?: unknown; after?: unknown } | undefined;
		getMetadata?: (
			result: TResult | null,
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

		let before: unknown;
		if (options.getBefore) {
			try {
				before = await options.getBefore(args, context);
			} catch {
				// Before-state capture is best-effort; never block the mutation.
				before = undefined;
			}
		}

		try {
			result = await resolver(parent, args, context, info);
		} catch (error) {
			void logAudit({
				userId: context.userId,
				organizationId: context.organizationId,
				requestId: context.requestId,
				ipAddress: context.ipAddress,
				userAgent: context.userAgent,
				action: options.action,
				resourceType: options.resourceType,
				status: AUDIT_STATUS.FAILURE,
				errorMessage: errorMessage(error),
				metadata: options.getMetadata?.(null, args),
			});

			throw error;
		}

		void logAudit({
			userId: context.userId,
			organizationId: context.organizationId,
			requestId: context.requestId,
			ipAddress: context.ipAddress,
			userAgent: context.userAgent,
			action: options.action,
			resourceType: options.resourceType,
			resourceId: options.getResourceId?.(result, args),
			changes: options.getChanges?.(result, args, before),
			metadata: options.getMetadata?.(result, args),
			status: AUDIT_STATUS.SUCCESS,
		});

		return result;
	};
}

/**
 * Delete audit logs older than the retention window. Intended to be invoked by
 * a scheduled job. Returns the number of rows pruned. The DB-level guard trigger
 * is the real enforcement boundary; this computes an equivalent cutoff in JS.
 */
export async function cleanupExpiredAuditLogs(): Promise<number> {
	const cutoff = new Date();
	cutoff.setUTCFullYear(cutoff.getUTCFullYear() - AUDIT_RETENTION_YEARS);

	const db = await getDb();
	const result = await db
		.delete(auditLogs)
		.where(lt(auditLogs.timestamp, cutoff.toISOString()));

	return result.rowCount ?? 0;
}

// Re-export constants for convenience
export { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, AUDIT_STATUS };
