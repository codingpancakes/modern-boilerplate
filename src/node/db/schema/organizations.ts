import {
	boolean,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { assignmentStatus, orgRole } from "./enums";
import { users } from "./users";

/**
 * Organizations table - Top-level organizational entities
 */
export const organizations = pgTable(
	"organizations",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		workosOrgId: text("workos_org_id"),
		name: text("name"),
		slug: text("slug"),
		orgType: text("org_type"),
		visibility: text("visibility"),
		defaultTimezone: text("default_timezone"),
		countryCode: text("country_code"),
		branding: jsonb("branding"),
		metadata: jsonb("metadata"),
		status: text("status"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
	},
	(table) => {
		return {
			uxOrgSlug: uniqueIndex("ux_org_slug").on(table.slug),
			uxWorkosOrgId: uniqueIndex("ux_workos_org_id").on(table.workosOrgId),
			ixOrgType: index("ix_org_type").on(table.orgType),
			ixOrgVisible: index("ix_org_visible").on(table.visibility),
		};
	},
);

/**
 * Org Units table - Hierarchical organizational units (departments, teams, etc.)
 */
export const orgUnits = pgTable(
	"org_units",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),
		parentId: uuid("parent_id"),
		code: text("code"),
		name: text("name"),
		isRoot: boolean("is_root").default(false),
		metadata: jsonb("metadata"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
	},
	(table) => {
		return {
			ixOuOrg: index("ix_ou_org").on(table.organizationId),
			ixOuOrgCode: index("ix_ou_org_code").on(table.code, table.organizationId),
			ixOuIsRoot: index("ix_ou_is_root").on(table.isRoot, table.organizationId),
			orgUnitsParentIdFkey: foreignKey({
				columns: [table.parentId],
				foreignColumns: [table.id],
				name: "org_units_parent_id_fkey",
			}).onDelete("set null"),
		};
	},
);

/**
 * Idempotency Keys table - Prevents duplicate request processing
 */
export const idempotencyKeys = pgTable(
	"idempotency_keys",
	{
		key: text("key").primaryKey().notNull(),
		requestHash: text("request_hash").notNull(),
		status: text("status").notNull(),
		response: text("response"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "string",
		}),
		expiresAt: timestamp("expires_at", {
			withTimezone: true,
			mode: "string",
		}).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => {
		return {
			keyRequestHashUnique: uniqueIndex(
				"idempotency_keys_key_request_hash_unique",
			).on(table.key, table.requestHash),
			ixIdempotencyKeysExpires: index("ix_idempotency_keys_expires").on(
				table.expiresAt,
			),
		};
	},
);

/**
 * Organization Members table - User membership in organizations
 */
export const organizationMembers = pgTable(
	"organization_members",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),
		orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, {
			onDelete: "set null",
		}),
		userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
		role: orgRole("role").default("MEMBER"),
		status: assignmentStatus("status").default("ACTIVE"),
		metadata: jsonb("metadata"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
	},
	(table) => {
		return {
			ixOrgMembersOrg: index("ix_org_members_org").on(table.organizationId),
			ixOrgMembersUser: index("ix_org_members_user").on(table.userId),
		};
	},
);
