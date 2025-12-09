import {
	bigint,
	boolean,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { assignmentStatus, orgRole, ownershipLevel, ownerType } from "./enums";
import { users } from "./users";

/**
 * Organizations table - Top-level organizational entities
 */
export const organizations = pgTable(
	"organizations",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
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
			ixOrgSlug: index("ix_org_slug").on(table.slug),
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
		organizationId: uuid("organization_id").references(() => organizations.id, {
			onDelete: "cascade",
		}),
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
 * Groups table - Flexible grouping mechanism (cohorts, teams, etc.)
 */
export const groups = pgTable(
	"groups",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		organizationId: uuid("organization_id").references(() => organizations.id, {
			onDelete: "cascade",
		}),
		orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, {
			onDelete: "set null",
		}),
		parentId: uuid("parent_id"),
		key: text("key"),
		name: text("name"),
		kind: text("kind"),
		isRoot: boolean("is_root").default(false),
		membershipMode: text("membership_mode"),
		rule: jsonb("rule"),
		startsAt: timestamp("starts_at", { withTimezone: true, mode: "string" }),
		endsAt: timestamp("ends_at", { withTimezone: true, mode: "string" }),
		maxSize: integer("max_size"),
		visibility: text("visibility"),
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
			ixGroupsOrg: index("ix_groups_org").on(table.organizationId),
			ixGroupsKind: index("ix_groups_kind").on(
				table.kind,
				table.organizationId,
			),
			ixGroupsKey: index("ix_groups_key").on(table.key, table.organizationId),
			ixGroupsRoot: index("ix_groups_root").on(
				table.isRoot,
				table.kind,
				table.organizationId,
			),
			groupsParentIdFkey: foreignKey({
				columns: [table.parentId],
				foreignColumns: [table.id],
				name: "groups_parent_id_fkey",
			}).onDelete("set null"),
		};
	},
);

/**
 * Group Memberships table - User membership in groups
 */
export const groupMemberships = pgTable(
	"group_memberships",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		groupId: uuid("group_id").references(() => groups.id, {
			onDelete: "cascade",
		}),
		userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
		role: text("role"),
		status: text("status"),
		joinedAt: timestamp("joined_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		leftAt: timestamp("left_at", { withTimezone: true, mode: "string" }),
		metadata: jsonb("metadata"),
	},
	(table) => {
		return {
			ixGmGroup: index("ix_gm_group").on(table.groupId),
			ixGmUser: index("ix_gm_user").on(table.userId),
			ixGmStatus: index("ix_gm_status").on(table.status),
		};
	},
);

/**
 * Property Definitions table - Defines custom properties for entities
 */
export const propertyDefinitions = pgTable(
	"property_definitions",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		ownerScope: text("owner_scope"),
		ownerOrgId: uuid("owner_org_id"),
		entityType: text("entity_type"),
		profileKind: text("profile_kind"),
		code: text("code"),
		name: text("name"),
		description: text("description"),
		dataType: text("data_type"),
		cardinality: text("cardinality"),
		allowedValues: jsonb("allowed_values"),
		defaultVisibility: text("default_visibility"),
		isIndexed: boolean("is_indexed").default(false),
		isSensitive: boolean("is_sensitive").default(false),
		status: text("status"),
		sourceAllowed: jsonb("source_allowed"),
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
			ixPropdefScope: index("ix_propdef_scope").on(
				table.ownerOrgId,
				table.ownerScope,
			),
			ixPropdefEntity: index("ix_propdef_entity").on(
				table.code,
				table.entityType,
			),
			ixPropdefStatus: index("ix_propdef_status").on(table.status),
		};
	},
);

/**
 * Entity Properties table - Stores property values for entities
 */
export const entityProperties = pgTable(
	"entity_properties",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		entityType: text("entity_type"),
		entityId: uuid("entity_id"),
		propertyDefId: uuid("property_def_id").references(
			() => propertyDefinitions.id,
			{ onDelete: "cascade" },
		),
		valueString: text("value_string"),
		valueText: text("value_text"),
		valueBoolean: boolean("value_boolean"),
		// You can use { mode: "bigint" } if numbers are exceeding js number limitations
		valueInt: bigint("value_int", { mode: "number" }),
		valueNum: numeric("value_num"),
		valueDate: date("value_date"),
		valueTimestamp: timestamp("value_timestamp", {
			withTimezone: true,
			mode: "string",
		}),
		valueEnum: text("value_enum"),
		valueMultiEnum: text("value_multi_enum").array(),
		valueJson: jsonb("value_json"),
		visibility: text("visibility"),
		source: text("source"),
		effectiveAt: timestamp("effective_at", {
			withTimezone: true,
			mode: "string",
		}),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
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
			ixPropsEntity: index("ix_props_entity").on(
				table.entityId,
				table.entityType,
			),
			ixPropsDefEntity: index("ix_props_def_entity").on(
				table.entityType,
				table.propertyDefId,
			),
			ixPropsDef: index("ix_props_def").on(table.propertyDefId),
		};
	},
);

/**
 * Property Facets table - Indexed property values for fast filtering
 */
export const propertyFacets = pgTable(
	"property_facets",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		ownerOrgId: uuid("owner_org_id"),
		entityType: text("entity_type"),
		entityId: uuid("entity_id"),
		propertyCode: text("property_code"),
		valueText: text("value_text"),
		valueNum: numeric("value_num"),
		valueBool: boolean("value_bool"),
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
			ixFacetsText: index("ix_facets_text").on(
				table.entityType,
				table.propertyCode,
				table.valueText,
			),
			ixFacetsNum: index("ix_facets_num").on(
				table.entityType,
				table.propertyCode,
				table.valueNum,
			),
			ixFacetsBool: index("ix_facets_bool").on(
				table.entityType,
				table.propertyCode,
				table.valueBool,
			),
			ixFacetsTenant: index("ix_facets_tenant").on(
				table.entityType,
				table.ownerOrgId,
				table.propertyCode,
				table.valueText,
			),
			ixFacetsEntity: index("ix_facets_entity").on(
				table.entityId,
				table.entityType,
			),
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
		organizationId: uuid("organization_id").references(() => organizations.id, {
			onDelete: "cascade",
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

/**
 * Resource Owners table - Tracks ownership of various resources
 */
export const resourceOwners = pgTable(
	"resource_owners",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		resourceType: text("resource_type").notNull(),
		resourceId: uuid("resource_id").notNull(),
		ownerType: ownerType("owner_type").notNull(),
		ownerId: uuid("owner_id").notNull(),
		ownershipLevel: ownershipLevel("ownership_level").default("PRIMARY"),
		permissions: jsonb("permissions"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
	},
	(table) => {
		return {
			ixResourceOwnersResource: index("ix_resource_owners_resource").on(
				table.resourceType,
				table.resourceId,
			),
			ixResourceOwnersOwner: index("ix_resource_owners_owner").on(
				table.ownerType,
				table.ownerId,
			),
			uxResourceOwner: uniqueIndex("ux_resource_owner").on(
				table.resourceType,
				table.resourceId,
				table.ownerType,
				table.ownerId,
			),
		};
	},
);
