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
	(table) => [
		uniqueIndex("ux_org_slug").on(table.slug),
		uniqueIndex("ux_workos_org_id").on(table.workosOrgId),
		index("ix_org_type").on(table.orgType),
		index("ix_org_visible").on(table.visibility),
	],
);

/**
 * Org Units table - Hierarchical organizational units (departments, teams, etc.)
 *
 * Intentional extension point: no endpoint/service wires this up yet, and
 * `audit_logs` / `organization_members` carry a nullable `org_unit_id` FK ready
 * for it. Kept deliberately as conceptual flexibility — NOT dead code; do not
 * drop it or its `createOrgUnit` validation schema in a cleanup pass.
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
	(table) => [
		index("ix_ou_org").on(table.organizationId),
		index("ix_ou_org_code").on(table.code, table.organizationId),
		index("ix_ou_is_root").on(table.isRoot, table.organizationId),
		foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "org_units_parent_id_fkey",
		}).onDelete("set null"),
	],
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
		// NOT NULL: keyset pagination compares/encodes createdAt as a non-null
		// string (see listMyOrganizations/listOrganizationMembers); a NULL would
		// drop out of the `gt(createdAt, cursor)` window and break the cursor.
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		})
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		})
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("ix_org_members_org").on(table.organizationId),
		index("ix_org_members_user").on(table.userId),
		uniqueIndex("ux_org_member_user_org").on(
			table.userId,
			table.organizationId,
		),
		// Composite indexes matching the keyset-pagination sort orders so the
		// `myOrganizations` / `organizationMembers` queries are index-served
		// (WHERE user_id|org_id ... ORDER BY created_at, id).
		index("ix_org_members_user_created").on(
			table.userId,
			table.createdAt,
			table.id,
		),
		index("ix_org_members_org_created").on(
			table.organizationId,
			table.createdAt,
			table.id,
		),
	],
);
