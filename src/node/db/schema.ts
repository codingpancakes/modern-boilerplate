import { pgTable, index, uuid, text, timestamp, foreignKey, date, boolean, jsonb, integer, bigint, numeric, unique, char, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

  // Custom PostgreSQL types
import { citext } from './types/citext';

// Status enums for database constraints
export const userType = pgEnum("user_type", ['operator', 'professional', 'member'])
export const personaAttrType = pgEnum("persona_attr_type", ['json', 'string_array', 'enum', 'timestamp', 'date', 'numeric', 'integer', 'boolean', 'text', 'string'])
export const personaCardinality = pgEnum("persona_cardinality", ['multi', 'single'])
export const personaValueSource = pgEnum("persona_value_source", ['sync', 'import', 'ai', 'coach', 'self'])
export const embedProvider = pgEnum("embed_provider", ['pgvector', 'external'])
export const assignmentStatusEnum = pgEnum('assignment_status', ['active', 'inactive', 'ended'])


export const users = pgTable("users", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	email: citext("email"),
	phone: citext("phone"),
	firstName: text("first_name"),
	lastName: text("last_name"),
	type: userType("type").notNull(),
	status: text("status"),
	defaultTimezone: text("default_timezone"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
},
(table) => {
	return {
		ixUsersEmail: index("ix_users_email").on(table.email),
		ixUsersPhone: index("ix_users_phone").on(table.phone),
	}
});

export const profiles = pgTable("profiles", {
	userId: uuid("user_id").primaryKey().notNull().references(() => users.id, { onDelete: "cascade" } ),
	preferredName: text("preferred_name"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	pronouns: text("pronouns"),
	externalId: text("external_id"),
	location: text("location"),
	countryCode: text("country_code"),
	activatedOn: date("activated_on"),
	deactivatedOn: date("deactivated_on"),
	noSync: boolean("no_sync").default(false),
	photoUrl: text("photo_url"),
	gender: text("gender"),
	lgbtq: boolean("lgbtq"),
	ethnicity: text("ethnicity"),
	languages: text("languages").array(),
	onboardingCompleted: boolean("onboarding_completed").default(false),
	persona: jsonb("persona"),
	snapshot: jsonb("snapshot"),
},
(table) => {
	return {
		ixProfilesExternalId: index("ix_profiles_external_id").on(table.externalId),
		ixProfilesCountry: index("ix_profiles_country").on(table.countryCode),
	}
});

export const authIdentities = pgTable("auth_identities", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" } ),
	providerType: text("provider_type"),
	providerSubject: text("provider_subject"),
	emailAtProvider: citext("email_at_provider"),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixAuthUser: index("ix_auth_user").on(table.userId),
		ixAuthProviderLookup: index("ix_auth_provider_lookup").on(table.providerSubject, table.providerType),
	}
});

export const organizations = pgTable("organizations", {
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
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixOrgSlug: index("ix_org_slug").on(table.slug),
		ixOrgType: index("ix_org_type").on(table.orgType),
		ixOrgVisible: index("ix_org_visible").on(table.visibility),
	}
});

export const orgUnits = pgTable("org_units", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	parentId: uuid("parent_id"),
	code: text("code"),
	name: text("name"),
	isRoot: boolean("is_root").default(false),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixOuOrg: index("ix_ou_org").on(table.organizationId),
		ixOuOrgCode: index("ix_ou_org_code").on(table.code, table.organizationId),
		ixOuIsRoot: index("ix_ou_is_root").on(table.isRoot, table.organizationId),
		orgUnitsParentIdFkey: foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "org_units_parent_id_fkey"
		}).onDelete("set null"),
	}
});

export const groups = pgTable("groups", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" } ),
	parentId: uuid("parent_id"),
	key: text("key"),
	name: text("name"),
	kind: text("kind"),
	isRoot: boolean("is_root").default(false),
	membershipMode: text("membership_mode"),
	rule: jsonb("rule"),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	maxSize: integer("max_size"),
	visibility: text("visibility"),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixGroupsOrg: index("ix_groups_org").on(table.organizationId),
		ixGroupsKind: index("ix_groups_kind").on(table.kind, table.organizationId),
		ixGroupsKey: index("ix_groups_key").on(table.key, table.organizationId),
		ixGroupsRoot: index("ix_groups_root").on(table.isRoot, table.kind, table.organizationId),
		groupsParentIdFkey: foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "groups_parent_id_fkey"
		}).onDelete("set null"),
	}
});

export const groupMemberships = pgTable("group_memberships", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" } ),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" } ),
	role: text("role"),
	status: text("status"),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	leftAt: timestamp("left_at", { withTimezone: true, mode: 'string' }),
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixGmGroup: index("ix_gm_group").on(table.groupId),
		ixGmUser: index("ix_gm_user").on(table.userId),
		ixGmStatus: index("ix_gm_status").on(table.status),
	}
});

export const propertyDefinitions = pgTable("property_definitions", {
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
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixPropdefScope: index("ix_propdef_scope").on(table.ownerOrgId, table.ownerScope),
		ixPropdefEntity: index("ix_propdef_entity").on(table.code, table.entityType),
		ixPropdefStatus: index("ix_propdef_status").on(table.status),
	}
});

export const entityProperties = pgTable("entity_properties", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	entityType: text("entity_type"),
	entityId: uuid("entity_id"),
	propertyDefId: uuid("property_def_id").references(() => propertyDefinitions.id, { onDelete: "cascade" } ),
	valueString: text("value_string"),
	valueText: text("value_text"),
	valueBoolean: boolean("value_boolean"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	valueInt: bigint("value_int", { mode: "number" }),
	valueNum: numeric("value_num"),
	valueDate: date("value_date"),
	valueTimestamp: timestamp("value_timestamp", { withTimezone: true, mode: 'string' }),
	valueEnum: text("value_enum"),
	valueMultiEnum: text("value_multi_enum").array(),
	valueJson: jsonb("value_json"),
	visibility: text("visibility"),
	source: text("source"),
	effectiveAt: timestamp("effective_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixPropsEntity: index("ix_props_entity").on(table.entityId, table.entityType),
		ixPropsDefEntity: index("ix_props_def_entity").on(table.entityType, table.propertyDefId),
		ixPropsDef: index("ix_props_def").on(table.propertyDefId),
	}
});

export const propertyFacets = pgTable("property_facets", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	ownerOrgId: uuid("owner_org_id"),
	entityType: text("entity_type"),
	entityId: uuid("entity_id"),
	propertyCode: text("property_code"),
	valueText: text("value_text"),
	valueNum: numeric("value_num"),
	valueBool: boolean("value_bool"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixFacetsText: index("ix_facets_text").on(table.entityType, table.propertyCode, table.valueText),
		ixFacetsNum: index("ix_facets_num").on(table.entityType, table.propertyCode, table.valueNum),
		ixFacetsBool: index("ix_facets_bool").on(table.entityType, table.propertyCode, table.valueBool),
		ixFacetsTenant: index("ix_facets_tenant").on(table.entityType, table.ownerOrgId, table.propertyCode, table.valueText),
		ixFacetsEntity: index("ix_facets_entity").on(table.entityId, table.entityType),
	}
});



export const idempotencyKeys = pgTable("idempotency_keys", {
	key: text("key").primaryKey().notNull(),
	requestHash: text("request_hash").notNull(),
	status: text("status").notNull(),
	response: text("response"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		idempotencyKeysKeyRequestHashUnique: unique("idempotency_keys_key_request_hash_unique").on(table.key, table.requestHash),
	}
});