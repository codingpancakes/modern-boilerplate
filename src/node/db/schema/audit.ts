import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organizations, orgUnits } from "./organizations";
import { users } from "./users";

/**
 * Audit Logs table - SOC 2 compliance
 *
 * Tracks all user actions for security, compliance, and forensics.
 * Required for SOC 2 Type II certification.
 *
 * Retention: 7 years (compliance requirement)
 */
export const auditLogs = pgTable(
	"audit_logs",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),

		// Who performed the action
		userId: uuid("user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		organizationId: uuid("organization_id").references(() => organizations.id, {
			onDelete: "set null",
		}),
		orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, {
			onDelete: "set null",
		}),

		// What action was performed
		action: text("action").notNull(),
		resourceType: text("resource_type").notNull(),
		// ID of the affected resource — text, not uuid, so it can hold any
		// identifier: a DB row UUID, an R2 object key, an external ID, etc.
		resourceId: text("resource_id"),

		// Details of the change
		changes: jsonb("changes"), // { before: {...}, after: {...} }

		// Request context
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		requestId: text("request_id"), // cf-ray request id or request ID

		// When it happened
		timestamp: timestamp("timestamp", {
			withTimezone: true,
			mode: "string",
		})
			.defaultNow()
			.notNull(),

		// Additional metadata
		metadata: jsonb("metadata"), // Any additional context

		// Status/Result
		status: text("status"), // SUCCESS, FAILURE, PARTIAL
		errorMessage: text("error_message"), // If action failed
	},
	(table) => [
		// Index for querying by user
		index("ix_audit_logs_user_id").on(table.userId),

		// Index for querying by organization
		index("ix_audit_logs_org_id").on(table.organizationId),

		// Index for querying by org unit
		index("ix_audit_logs_org_unit_id").on(table.orgUnitId),

		// Index for querying by resource
		index("ix_audit_logs_resource").on(table.resourceType, table.resourceId),

		// Index for querying by action
		index("ix_audit_logs_action").on(table.action),

		// Index for time-based queries (most common)
		index("ix_audit_logs_timestamp").on(table.timestamp),

		// Composite index for user activity over time
		index("ix_audit_logs_user_time").on(table.userId, table.timestamp),

		// Composite index for org audit queries over time
		index("ix_audit_logs_org_time").on(table.organizationId, table.timestamp),
	],
);

/**
 * Audit Log Actions - Standard action types
 */
export const AUDIT_ACTIONS = {
	// Authentication
	LOGIN: "LOGIN",
	LOGOUT: "LOGOUT",
	LOGIN_FAILED: "LOGIN_FAILED",
	PASSWORD_RESET: "PASSWORD_RESET",
	MFA_ENABLED: "MFA_ENABLED",
	MFA_DISABLED: "MFA_DISABLED",

	// CRUD Operations
	CREATE: "CREATE",
	READ: "READ",
	UPDATE: "UPDATE",
	DELETE: "DELETE",

	// Bulk Operations
	BULK_CREATE: "BULK_CREATE",
	BULK_UPDATE: "BULK_UPDATE",
	BULK_DELETE: "BULK_DELETE",

	// Access Control
	PERMISSION_GRANTED: "PERMISSION_GRANTED",
	PERMISSION_REVOKED: "PERMISSION_REVOKED",
	ACCESS_DENIED: "ACCESS_DENIED",

	// Data Export/Import
	EXPORT: "EXPORT",
	IMPORT: "IMPORT",

	// System Events
	WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
	WEBHOOK_FAILED: "WEBHOOK_FAILED",
	API_KEY_CREATED: "API_KEY_CREATED",
	API_KEY_REVOKED: "API_KEY_REVOKED",
} as const;

/**
 * Audit Log Resource Types - Standard resource types
 */
export const AUDIT_RESOURCE_TYPES = {
	USER: "USER",
	PROFILE: "PROFILE",
	ORGANIZATION: "ORGANIZATION",
	ORGANIZATION_MEMBER: "ORGANIZATION_MEMBER",
	MEDIA: "MEDIA",
	WEBHOOK: "WEBHOOK",
	API_KEY: "API_KEY",
	SETTINGS: "SETTINGS",
} as const;

/**
 * Audit Log Status - Result of the action
 */
export const AUDIT_STATUS = {
	SUCCESS: "SUCCESS",
	FAILURE: "FAILURE",
	PARTIAL: "PARTIAL",
} as const;

// Type exports for TypeScript
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
export type AuditResourceType =
	(typeof AUDIT_RESOURCE_TYPES)[keyof typeof AUDIT_RESOURCE_TYPES];
export type AuditStatus = (typeof AUDIT_STATUS)[keyof typeof AUDIT_STATUS];
