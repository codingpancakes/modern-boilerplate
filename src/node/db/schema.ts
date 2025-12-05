import { pgTable, index, pgEnum, uuid, text, timestamp, foreignKey, date, boolean, jsonb, integer, bigint, numeric, uniqueIndex, type AnyPgColumn, inet } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { citext } from './types/citext'

export const assignmentStatus = pgEnum("assignment_status", ['active', 'inactive', 'ended'])
export const embedProvider = pgEnum("embed_provider", ['pgvector', 'external'])
export const personaAttrType = pgEnum("persona_attr_type", ['json', 'string_array', 'enum', 'timestamp', 'date', 'numeric', 'integer', 'boolean', 'text', 'string'])
export const personaCardinality = pgEnum("persona_cardinality", ['multi', 'single'])
export const personaValueSource = pgEnum("persona_value_source", ['sync', 'import', 'ai', 'coach', 'self'])
export const userType = pgEnum("user_type", ['operator', 'member'])
export const orgRole = pgEnum("org_role", ['owner', 'admin', 'manager', 'member', 'viewer'])
export const ownerType = pgEnum("owner_type", ['user', 'organization', 'org_unit', 'group'])
export const ownershipLevel = pgEnum("ownership_level", ['primary', 'shared', 'viewer'])
export const resourceVisibility = pgEnum("resource_visibility", ['private', 'shared', 'org_unit', 'organization', 'public'])

// Messaging platform enums
export const messageStatus = pgEnum("message_status", ['queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'expired'])
export const campaignStatus = pgEnum("campaign_status", ['draft', 'scheduled', 'running', 'paused', 'completed', 'archived'])
export const journeyStatus = pgEnum("journey_status", ['draft', 'active', 'paused', 'archived'])
export const journeyRunStatus = pgEnum("journey_run_status", ['active', 'waiting', 'completed', 'failed', 'cancelled', 'expired'])
export const stepStatus = pgEnum("step_status", ['pending', 'processing', 'completed', 'failed', 'skipped', 'scheduled', 'cancelled'])
export const stepType = pgEnum("step_type", ['start', 'send', 'delay', 'filter', 'user_update', 'integration'])
export const delayType = pgEnum("delay_type", ['time_delay', 'hold_until', 'hold_for_reply'])
export const filterType = pgEnum("filter_type", ['ab_split', 'yes_no_split', 'attribute_split', 'send_to_journey'])
export const userUpdateType = pgEnum("user_update_type", ['set_fields', 'list_membership', 'subscription'])
export const integrationType = pgEnum("integration_type", ['webhook', 'segment', 'facebook', 'custom'])
export const channelType = pgEnum("channel_type", ['email', 'sms', 'push', 'web_push', 'in_app', 'embedded', 'whatsapp'])
export const contactStatus = pgEnum("contact_status", ['active', 'unsubscribed', 'bounced', 'complained', 'deleted'])
export const subscriptionStatus = pgEnum("subscription_status", ['subscribed', 'unsubscribed', 'pending'])
export const webhookStatus = pgEnum("webhook_status", ['active', 'paused', 'failed'])
export const experimentStatus = pgEnum("experiment_status", ['draft', 'running', 'completed', 'archived'])


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
		keyRequestHashUnique: uniqueIndex("idempotency_keys_key_request_hash_unique").on(table.key, table.requestHash),
	}
});

export const organizationMembers = pgTable("organization_members", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" } ),
	role: orgRole("role").default('member'),
	status: assignmentStatus("status").default('active'),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixOrgMembersOrg: index("ix_org_members_org").on(table.organizationId),
		ixOrgMembersUser: index("ix_org_members_user").on(table.userId),
	}
});

export const resourceOwners = pgTable("resource_owners", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	resourceType: text("resource_type").notNull(),
	resourceId: uuid("resource_id").notNull(),
	ownerType: ownerType("owner_type").notNull(),
	ownerId: uuid("owner_id").notNull(),
	ownershipLevel: ownershipLevel("ownership_level").default('primary'),
	permissions: jsonb("permissions"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixResourceOwnersResource: index("ix_resource_owners_resource").on(table.resourceType, table.resourceId),
		ixResourceOwnersOwner: index("ix_resource_owners_owner").on(table.ownerType, table.ownerId),
		uxResourceOwner: uniqueIndex("ux_resource_owner").on(table.resourceType, table.resourceId, table.ownerType, table.ownerId),
	}
});

export const messageChannels = pgTable("message_channels", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	key: text("key"),
	name: text("name"),
	kind: text("kind"),
	provider: text("provider"),
	config: jsonb("config"),
	isDefault: boolean("is_default").default(false),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixChannelsOrg: index("ix_channels_org").on(table.organizationId),
		ixChannelsKind: index("ix_channels_kind").on(table.kind, table.organizationId),
		ixChannelsKey: index("ix_channels_key").on(table.key, table.organizationId),
	}
});

export const subscriptionTopics = pgTable("subscription_topics", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	key: text("key"),
	name: text("name"),
	description: text("description"),
	defaultChannelKind: text("default_channel_kind"),
	isRequired: boolean("is_required").default(false),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixTopicsOrg: index("ix_topics_org").on(table.organizationId),
		ixTopicsKey: index("ix_topics_key").on(table.key, table.organizationId),
	}
});

export const contactListMembers = pgTable("contact_list_members", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	listId: uuid("list_id").references(() => contactLists.id, { onDelete: "cascade" } ),
	contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" } ),
	status: text("status"),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	removedAt: timestamp("removed_at", { withTimezone: true, mode: 'string' }),
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixClmList: index("ix_clm_list").on(table.listId),
		ixClmContact: index("ix_clm_contact").on(table.contactId),
		ixClmListContact: index("ix_clm_list_contact").on(table.contactId, table.listId),
	}
});

export const contacts = pgTable("contacts", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	externalId: text("external_id"),
	email: citext("email"),
	phone: citext("phone"),
	firstName: text("first_name"),
	lastName: text("last_name"),
	locale: text("locale"),
	timezone: text("timezone"),
	status: contactStatus("status").default('active'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
},
(table) => {
	return {
		ixContactsOrg: index("ix_contacts_org").on(table.organizationId),
		ixContactsEmail: index("ix_contacts_email").on(table.email, table.organizationId),
		ixContactsExternal: index("ix_contacts_external").on(table.externalId, table.organizationId),
		ixContactsOrgEmail: index("ix_contacts_org_email").on(table.organizationId, table.email),
		ixContactsOrgStatus: index("ix_contacts_org_status").on(table.organizationId, table.status),
		uxContactsOrgEmail: uniqueIndex("ux_contacts_org_email").on(table.organizationId, table.email),
	}
});

export const contactLists = pgTable("contact_lists", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	key: text("key"),
	name: text("name"),
	description: text("description"),
	listType: text("list_type"),
	isPrimary: boolean("is_primary").default(false),
	isSystem: boolean("is_system").default(false),
	visibility: resourceVisibility("visibility").default('private'),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixContactListsKey: index("ix_contact_lists_key").on(table.key),
		ixContactListsVisibility: index("ix_contact_lists_visibility").on(table.visibility),
	}
});

export const contactSegments = pgTable("contact_segments", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	key: text("key"),
	name: text("name"),
	description: text("description"),
	segmentType: text("segment_type"),
	definition: jsonb("definition"),
	materializationMode: text("materialization_mode"),
	source: text("source"),
	visibility: resourceVisibility("visibility").default('private'),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixContactSegmentsKey: index("ix_contact_segments_key").on(table.key),
		ixContactSegmentsVisibility: index("ix_contact_segments_visibility").on(table.visibility),
	}
});

export const contactSegmentMembers = pgTable("contact_segment_members", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	segmentId: uuid("segment_id").references(() => contactSegments.id, { onDelete: "cascade" } ),
	contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" } ),
	asOf: timestamp("as_of", { withTimezone: true, mode: 'string' }),
	status: text("status"),
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixCsmSegment: index("ix_csm_segment").on(table.segmentId),
		ixCsmContact: index("ix_csm_contact").on(table.contactId),
	}
});

export const contactChannels = pgTable("contact_channels", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" } ),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	channelId: uuid("channel_id").references(() => messageChannels.id, { onDelete: "set null" } ),
	channelKind: text("channel_kind"),
	address: text("address"),
	status: text("status"),
	isPrimary: boolean("is_primary").default(false),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixContactChannelsContact: index("ix_contact_channels_contact").on(table.contactId),
		ixContactChannelsOrgKind: index("ix_contact_channels_org_kind").on(table.channelKind, table.organizationId),
		ixContactChannelsAddress: index("ix_contact_channels_address").on(table.address, table.channelKind),
		uxContactChannelsAddress: uniqueIndex("ux_contact_channels_address").on(table.contactId, table.channelKind, table.address),
	}
});

export const contactSubscriptions = pgTable("contact_subscriptions", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" } ),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	topicId: uuid("topic_id").references(() => subscriptionTopics.id, { onDelete: "cascade" } ),
	contactChannelId: uuid("contact_channel_id").references(() => contactChannels.id, { onDelete: "set null" } ),
	channelKind: text("channel_kind"),
	status: subscriptionStatus("status").default('subscribed'),
	source: text("source"),
	reason: text("reason"),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixContactSubscriptionsContact: index("ix_contact_subscriptions_contact").on(table.contactId, table.organizationId),
		ixContactSubscriptionsTopic: index("ix_contact_subscriptions_topic").on(table.topicId),
		ixContactSubscriptionsChannel: index("ix_contact_subscriptions_channel").on(table.contactChannelId),
	}
});

export const templates = pgTable("templates", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	channelId: uuid("channel_id").references(() => messageChannels.id, { onDelete: "set null" } ),
	key: text("key"),
	name: text("name"),
	description: text("description"),
	kind: text("kind"),
	renderEngine: text("render_engine"),
	currentVersionId: uuid("current_version_id").references((): AnyPgColumn => templateVersions.id, { onDelete: "set null" } ),
	visibility: resourceVisibility("visibility").default('private'),
	metadata: jsonb("metadata"),
	createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
},
(table) => {
	return {
		ixTemplatesChannel: index("ix_templates_channel").on(table.channelId),
		ixTemplatesKey: index("ix_templates_key").on(table.key),
		ixTemplatesVisibility: index("ix_templates_visibility").on(table.visibility),
		ixTemplatesCreatedBy: index("ix_templates_created_by").on(table.createdByUserId),
	}
});

export const templateVersions = pgTable("template_versions", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	templateId: uuid("template_id").references((): AnyPgColumn => templates.id, { onDelete: "cascade" } ),
	version: integer("version"),
	isActive: boolean("is_active").default(true),
	subject: text("subject"),
	bodyHtml: text("body_html"),
	bodyText: text("body_text"),
	dataSchema: jsonb("data_schema"),
	metadata: jsonb("metadata"),
	createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixTemplateVersionsTemplate: index("ix_template_versions_template").on(table.templateId, table.version),
	}
});

export const journeys = pgTable("journeys", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	key: text("key"),
	name: text("name"),
	description: text("description"),
	status: journeyStatus("status").default('draft'),
	entryMode: text("entry_mode"),
	entryContactListId: uuid("entry_contact_list_id").references(() => contactLists.id, { onDelete: "set null" } ),
	entryContactSegmentId: uuid("entry_contact_segment_id").references(() => contactSegments.id, { onDelete: "set null" } ),
	entryEventName: text("entry_event_name"),
	definition: jsonb("definition"),
	version: integer("version").default(1).notNull(),
	settings: jsonb("settings"), // { max_duration_days: 30, allow_re_entry: false, timezone: 'UTC' }
	visibility: resourceVisibility("visibility").default('private'),
	metadata: jsonb("metadata"),
	createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
},
(table) => {
	return {
		ixJourneysKey: index("ix_journeys_key").on(table.key),
		ixJourneysStatus: index("ix_journeys_status").on(table.status),
		ixJourneysVisibility: index("ix_journeys_visibility").on(table.visibility),
		ixJourneysCreatedBy: index("ix_journeys_created_by").on(table.createdByUserId),
	}
});

export const campaigns = pgTable("campaigns", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	key: text("key"),
	name: text("name"),
	description: text("description"),
	campaignType: text("campaign_type"),
	channelId: uuid("channel_id").references(() => messageChannels.id, { onDelete: "set null" } ),
	templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" } ),
	entryContactListId: uuid("entry_contact_list_id").references(() => contactLists.id, { onDelete: "set null" } ),
	entryContactSegmentId: uuid("entry_contact_segment_id").references(() => contactSegments.id, { onDelete: "set null" } ),
	scheduleType: text("schedule_type"),
	scheduleConfig: jsonb("schedule_config"),
	sendConfig: jsonb("send_config"),
	status: campaignStatus("status").default('draft'),
	visibility: resourceVisibility("visibility").default('private'),
	metadata: jsonb("metadata"),
	createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
},
(table) => {
	return {
		ixCampaignsKey: index("ix_campaigns_key").on(table.key),
		ixCampaignsStatus: index("ix_campaigns_status").on(table.status),
		ixCampaignsVisibility: index("ix_campaigns_visibility").on(table.visibility),
		ixCampaignsCreatedBy: index("ix_campaigns_created_by").on(table.createdByUserId),
	}
});

export const campaignRuns = pgTable("campaign_runs", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" } ),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	triggerType: text("trigger_type"),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	status: text("status"),
	entryContactListId: uuid("entry_contact_list_id").references(() => contactLists.id, { onDelete: "set null" } ),
	entryContactSegmentId: uuid("entry_contact_segment_id").references(() => contactSegments.id, { onDelete: "set null" } ),
	targetSegmentId: uuid("target_segment_id").references(() => contactSegments.id, { onDelete: "set null" } ),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	targetCount: bigint("target_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sentCount: bigint("sent_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	errorCount: bigint("error_count", { mode: "number" }),
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixCampaignRunsCampaign: index("ix_campaign_runs_campaign").on(table.campaignId, table.scheduledAt),
		ixCampaignRunsOrg: index("ix_campaign_runs_org").on(table.organizationId, table.status),
	}
});

export const journeyRuns = pgTable("journey_runs", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "cascade" } ),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" } ),
	journeyVersion: integer("journey_version").notNull(), // Snapshot version
	journeyDefinition: jsonb("journey_definition"), // Frozen copy of journey steps
	status: journeyRunStatus("status").default('active'),
	currentStepKey: text("current_step_key"), // Where contact is now
	currentStepIndex: integer("current_step_index"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }), // Optional timeout
	lastStepKey: text("last_step_key"),
	// Goal tracking
	goalAchieved: boolean("goal_achieved").default(false),
	goalAchievedAt: timestamp("goal_achieved_at", { withTimezone: true, mode: 'string' }),
	goalEventName: text("goal_event_name"),
	// Holdout groups
	isHoldout: boolean("is_holdout").default(false),
	holdoutReason: text("holdout_reason"),
	context: jsonb("context"),
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixJourneyRunsJourney: index("ix_journey_runs_journey").on(table.journeyId),
		ixJourneyRunsContact: index("ix_journey_runs_contact").on(table.contactId, table.journeyId),
		ixJourneyRunsStatus: index("ix_journey_runs_status").on(table.status),
	}
});

export const journeyStepRuns = pgTable("journey_step_runs", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	journeyRunId: uuid("journey_run_id").references(() => journeyRuns.id, { onDelete: "cascade" } ),
	journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "cascade" } ),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	stepKey: text("step_key").notNull(),
	stepType: stepType("step_type").notNull(),
	stepIndex: integer("step_index"),
	status: stepStatus("status").default('pending'),
	scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: 'string' }), // For delays
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	// Filter/branch tracking
	filterResult: jsonb("filter_result"), // { matched: true, condition: "...", variant: "A" }
	branchTaken: text("branch_taken"), // 'yes', 'no', 'A', 'B', 'US', 'default', etc.
	nextStepKey: text("next_step_key"), // Where contact goes next
	// Message tracking
	campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" } ),
	messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" } ),
	// Error handling
	errorMessage: text("error_message"),
	retryCount: integer("retry_count").default(0),
	// EventBridge/SQS tracking
	eventId: text("event_id"), // EventBridge event ID for idempotency
	sqsMessageId: text("sqs_message_id"), // SQS message ID
	// Context snapshot
	evaluationContext: jsonb("evaluation_context"), // Contact data at step execution
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixJourneyStepRunsJourneyRun: index("ix_journey_step_runs_journey_run").on(table.journeyRunId),
		ixJourneyStepRunsStep: index("ix_journey_step_runs_step").on(table.journeyId, table.stepKey),
		ixJourneyStepRunsScheduled: index("ix_journey_step_runs_scheduled").on(table.scheduledFor, table.status), // For delay polling
		ixJourneyStepRunsStatus: index("ix_journey_step_runs_status").on(table.status),
		ixJourneyStepRunsEventId: index("ix_journey_step_runs_event_id").on(table.eventId), // Idempotency
	}
});

export const messages = pgTable("messages", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" } ),
	campaignRunId: uuid("campaign_run_id").references(() => campaignRuns.id, { onDelete: "set null" } ),
	journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "set null" } ),
	journeyRunId: uuid("journey_run_id").references(() => journeyRuns.id, { onDelete: "set null" } ),
	contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" } ),
	contactChannelId: uuid("contact_channel_id").references(() => contactChannels.id, { onDelete: "set null" } ),
	channelId: uuid("channel_id").references(() => messageChannels.id, { onDelete: "set null" } ),
	channelKind: text("channel_kind"),
	topicId: uuid("topic_id").references(() => subscriptionTopics.id, { onDelete: "set null" } ),
	templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" } ),
	templateVersionId: uuid("template_version_id").references(() => templateVersions.id, { onDelete: "set null" } ),
	messageKey: text("message_key"),
	providerMessageId: text("provider_message_id"),
	fromAddress: text("from_address"),
	toAddress: text("to_address"),
	subject: text("subject"),
	sendStatus: messageStatus("send_status").default('queued'),
	errorCode: text("error_code"),
	errorMessage: text("error_message"),
	queuedAt: timestamp("queued_at", { withTimezone: true, mode: 'string' }),
	sendingStartedAt: timestamp("sending_started_at", { withTimezone: true, mode: 'string' }),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	softDeletedAt: timestamp("soft_deleted_at", { withTimezone: true, mode: 'string' }),
	renderContext: jsonb("render_context"),
	renderedBodyUrl: text("rendered_body_url"),
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixMessagesOrg: index("ix_messages_org").on(table.organizationId),
		ixMessagesCampaign: index("ix_messages_campaign").on(table.campaignId),
		ixMessagesContact: index("ix_messages_contact").on(table.contactId, table.organizationId),
		ixMessagesProvider: index("ix_messages_provider").on(table.providerMessageId),
		ixMessagesStatus: index("ix_messages_status").on(table.sendStatus),
		ixMessagesQueuedAt: index("ix_messages_queued_at").on(table.queuedAt),
		ixMessagesCampaignStatus: index("ix_messages_campaign_status").on(table.campaignId, table.sendStatus),
		ixMessagesContactStatus: index("ix_messages_contact_status").on(table.contactId, table.sendStatus),
	}
});

export const messageEvents = pgTable("message_events", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" } ),
	contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" } ),
	eventType: text("event_type"),
	eventSubtype: text("event_subtype"),
	providerEventId: text("provider_event_id"),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	url: text("url"),
	ipAddress: inet("ip_address"),
	userAgent: text("user_agent"),
	rawEvent: jsonb("raw_event"),
	metadata: jsonb("metadata"),
},
(table) => {
	return {
		ixMessageEventsMessage: index("ix_message_events_message").on(table.eventType, table.messageId),
		ixMessageEventsContact: index("ix_message_events_contact").on(table.contactId, table.eventType),
		ixMessageEventsOrgTime: index("ix_message_events_org_time").on(table.occurredAt, table.organizationId),
	}
});

export const events = pgTable("events", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" } ),
	contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" } ),
	eventName: text("event_name"),
	eventSource: text("event_source"),
	eventGroup: text("event_group"),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" } ),
	properties: jsonb("properties"),
	context: jsonb("context"),
	insertId: text("insert_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixEventsOrgTime: index("ix_events_org_time").on(table.occurredAt, table.organizationId),
		ixEventsContactTime: index("ix_events_contact_time").on(table.contactId, table.occurredAt),
		ixEventsNameTime: index("ix_events_name_time").on(table.eventName, table.occurredAt, table.organizationId),
		ixEventsInsertId: index("ix_events_insert_id").on(table.insertId, table.organizationId),
	}
});

export const experiments = pgTable("experiments", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" } ),
	key: text("key"),
	name: text("name"),
	description: text("description"),
	status: experimentStatus("status").default('draft'),
	winnerCriteria: text("winner_criteria"), // open_rate, click_rate, conversion, revenue
	winnerMetric: text("winner_metric"),
	variants: jsonb("variants"), // [{id, name, templateId, percentage, weight}]
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	winnerId: text("winner_id"),
	results: jsonb("results"),
	visibility: resourceVisibility("visibility").default('private'),
	metadata: jsonb("metadata"),
	createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixExperimentsCampaign: index("ix_experiments_campaign").on(table.campaignId),
		ixExperimentsKey: index("ix_experiments_key").on(table.key),
		ixExperimentsStatus: index("ix_experiments_status").on(table.status),
		ixExperimentsVisibility: index("ix_experiments_visibility").on(table.visibility),
		ixExperimentsCreatedBy: index("ix_experiments_created_by").on(table.createdByUserId),
	}
});

export const webhooks = pgTable("webhooks", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	name: text("name"),
	url: text("url").notNull(),
	events: text("events").array().notNull(), // ['message.sent', 'message.delivered', 'contact.created']
	secret: text("secret"),
	status: webhookStatus("status").default('active'),
	headers: jsonb("headers"), // Custom headers to send
	retryPolicy: jsonb("retry_policy"), // {maxRetries, backoffMultiplier}
	lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true, mode: 'string' }),
	lastSuccessAt: timestamp("last_success_at", { withTimezone: true, mode: 'string' }),
	lastFailureAt: timestamp("last_failure_at", { withTimezone: true, mode: 'string' }),
	failureCount: integer("failure_count").default(0),
	visibility: resourceVisibility("visibility").default('private'),
	metadata: jsonb("metadata"),
	createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" } ),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixWebhooksStatus: index("ix_webhooks_status").on(table.status),
		ixWebhooksVisibility: index("ix_webhooks_visibility").on(table.visibility),
		ixWebhooksCreatedBy: index("ix_webhooks_created_by").on(table.createdByUserId),
	}
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	webhookId: uuid("webhook_id").references(() => webhooks.id, { onDelete: "cascade" } ),
	eventType: text("event_type").notNull(),
	eventId: uuid("event_id"), // ID of the message, contact, etc that triggered this
	payload: jsonb("payload").notNull(),
	status: text("status").default('pending'), // pending, sent, failed
	httpStatus: integer("http_status"),
	responseBody: text("response_body"),
	errorMessage: text("error_message"),
	attemptCount: integer("attempt_count").default(0),
	nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: 'string' }),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ixWebhookDeliveriesWebhook: index("ix_webhook_deliveries_webhook").on(table.webhookId, table.createdAt),
		ixWebhookDeliveriesStatus: index("ix_webhook_deliveries_status").on(table.status, table.nextRetryAt),
		ixWebhookDeliveriesEvent: index("ix_webhook_deliveries_event").on(table.eventType, table.eventId),
	}
});