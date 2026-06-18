import { AsyncLocalStorage } from "node:async_hooks";
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
import { createLogger } from "./logger";
import { captureException } from "./sentry";

/**
 * SOC 2 retention window for audit logs. Mirrored by the `audit_logs_guard`
 * DB trigger, which rejects deletes of any row newer than this — so logs are
 * tamper-proof within the window and only the retention job can prune beyond it.
 */
export const AUDIT_RETENTION_YEARS = 7;

const logger = createLogger({ serviceName: "audit" });

/**
 * Emit an `AuditWriteFailure` count metric so a sustained DB outage holing the
 * compliance trail pages someone instead of only leaving log lines behind.
 *
 * The body is the CloudWatch Embedded Metric Format (EMF) JSON written to
 * stdout. On Workers there is no EMF pipeline, so this degrades to a
 * structured log line that Workers Logs / Logpush queries can count on
 * (`_aws.CloudWatchMetrics[0].Metrics[0].Name == "AuditWriteFailure"`).
 * Deliberately isolated in this one function so it can be swapped for an
 * Analytics Engine write (or similar) without touching callers.
 */
function emitAuditWriteFailureMetric(): void {
	const namespace = process.env.PROJECT_NAME || "local-dev";
	const emf = {
		_aws: {
			Timestamp: Date.now(),
			CloudWatchMetrics: [
				{
					Namespace: namespace,
					Dimensions: [["Service"]],
					Metrics: [{ Name: "AuditWriteFailure", Unit: "Count" }],
				},
			],
		},
		Service: "audit",
		AuditWriteFailure: 1,
	};
	// Must be a bare console.log: EMF requires the JSON object to be the whole
	// log line, which the structured logger's envelope would break.
	console.log(JSON.stringify(emf));
}

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
 * Scrub secrets from free-form metadata before persisting. Mirrors the
 * treatment of `changes` so the redaction contract is uniform: every value
 * written to the (immutable, 7-year) audit trail passes through the same
 * key-based filter, regardless of which field carries it.
 */
function redactMetadata(
	metadata: AuditLogEntry["metadata"],
): AuditLogEntry["metadata"] {
	if (!metadata) return metadata;
	return redactSensitive(metadata) as Record<string, unknown>;
}

/**
 * In-flight audit writes.
 *
 * Audit logging is intentionally called fire-and-forget (`void logAudit(...)`)
 * so it never blocks the request hot path. But a detached promise is NOT
 * guaranteed to finish once the response is returned (the Workers runtime can
 * cancel work outliving its request) — unacceptable for an immutable,
 * compliance-grade audit trail.
 *
 * So every `logAudit` registers its write here, and the `auditFlush()`
 * middleware (lib/hono/middleware.ts) calls {@link flushAudits} before the
 * request finishes. The hot path still never awaits an individual write; we
 * just drain whatever is outstanding at the very end.
 *
 * The buffer is PER-REQUEST, held in AsyncLocalStorage (mirroring the DB pool
 * scope in db.ts). On Cloudflare Workers a module-level set would be shared by
 * every concurrent request in the isolate, so one request's `flushAudits()`
 * would await — and head-of-line-block on — another request's audit writes.
 * Scoping the set per request means each request drains only its own writes.
 *
 * Outside a scope (cron jobs, scripts) there is no buffer: `logAudit` simply
 * awaits its write inline, and `flushAudits` is a no-op.
 */
const auditScopeStorage = new AsyncLocalStorage<Set<Promise<void>>>();

/**
 * Run `fn` with a per-request audit buffer. The `auditFlush()` middleware wraps
 * every HTTP request in this; `logAudit` writes started inside are collected and
 * drained by {@link flushAudits} at the end of the request.
 */
export function runWithAuditScope<T>(fn: () => Promise<T>): Promise<T> {
	return auditScopeStorage.run(new Set<Promise<void>>(), fn);
}

/**
 * Await all audit writes started during the current request scope. Best-effort:
 * failures are already swallowed inside {@link logAudit}, so this never rejects.
 * A no-op outside a scope (writes there are awaited inline by `logAudit`).
 */
export async function flushAudits(): Promise<void> {
	const pending = auditScopeStorage.getStore();
	if (!pending || pending.size === 0) return;
	await Promise.allSettled([...pending]);
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
 *   ipAddress: c.req.header("cf-connecting-ip"),
 *   status: AUDIT_STATUS.SUCCESS,
 * });
 * ```
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
	const write = persistAudit(entry);
	const pending = auditScopeStorage.getStore();
	// Outside a request scope (cron/scripts): no buffer to drain later, so
	// await inline to guarantee the write completes.
	if (!pending) {
		await write;
		return;
	}
	pending.add(write);
	try {
		await write;
	} finally {
		pending.delete(write);
	}
}

async function persistAudit(entry: AuditLogEntry): Promise<void> {
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
			metadata: redactMetadata(entry.metadata),
			status: entry.status || AUDIT_STATUS.SUCCESS,
			errorMessage: entry.errorMessage,
		});
	} catch (error) {
		// Don't throw — audit logging should never break the main flow.
		// Log the full entry as fallback so it can be backfilled from logs.
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
			metadata: redactMetadata(entry.metadata),
		};

		if (process.env.NODE_ENV === "test") {
			// Silently swallow — no DB in unit tests
		} else {
			emitAuditWriteFailureMetric();
			logger.error("Failed to log audit event — falling back to log line", {
				error: errorMessage(error),
				auditEntry,
			});
			captureException(toError(error));
		}
	}
}

/**
 * Source-agnostic request descriptor for audit context — built from whatever
 * carried the request (Hono context, webhook payload, test fixture).
 */
export interface RequestContextSource {
	requestId?: string;
	sourceIp?: string;
	userAgent?: string;
}

/**
 * Map a request descriptor onto audit-entry fields. Spread into `logAudit`:
 *
 * ```typescript
 * void logAudit({
 *   ...,
 *   ...extractRequestContext({
 *     requestId: c.get("requestId"),
 *     sourceIp: c.req.header("cf-connecting-ip"),
 *     userAgent: c.req.header("user-agent"),
 *   }),
 * });
 * ```
 */
export function extractRequestContext(source: RequestContextSource) {
	return {
		ipAddress: source.sourceIp,
		userAgent: source.userAgent,
		requestId: source.requestId,
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
