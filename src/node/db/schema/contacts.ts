import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { citext } from "../types/citext";
import { contactStatus, resourceVisibility, subscriptionStatus } from "./enums";
import { messageChannels, messages, subscriptionTopics } from "./messaging";
import { organizations, orgUnits } from "./organizations";

/**
 * Contacts table - Customer/contact records
 */
export const contacts = pgTable(
	"contacts",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),
		orgUnitId: uuid("org_unit_id")
			.references(() => orgUnits.id, {
				onDelete: "cascade",
			})
			.notNull(),
		externalId: text("external_id"),
		email: citext("email"),
		phone: citext("phone"),
		firstName: text("first_name"),
		lastName: text("last_name"),
		locale: text("locale"),
		timezone: text("timezone"),
		status: contactStatus("status").default("ACTIVE"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
	},
	(table) => {
		return {
			ixContactsOrg: index("ix_contacts_org").on(table.organizationId),
			ixContactsOrgUnit: index("ix_contacts_org_unit").on(table.orgUnitId),
			ixContactsOrgAndUnit: index("ix_contacts_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixContactsEmail: index("ix_contacts_email").on(
				table.email,
				table.organizationId,
			),
			ixContactsExternal: index("ix_contacts_external").on(
				table.externalId,
				table.organizationId,
			),
			ixContactsOrgEmail: index("ix_contacts_org_email").on(
				table.organizationId,
				table.email,
			),
			ixContactsOrgStatus: index("ix_contacts_org_status").on(
				table.organizationId,
				table.status,
			),
			uxContactsOrgEmail: uniqueIndex("ux_contacts_org_email").on(
				table.organizationId,
				table.email,
			),
			uxContactsOrgExternal: uniqueIndex("ux_contacts_org_external").on(
				table.organizationId,
				table.externalId,
			),
		};
	},
);

/**
 * Contact Lists table - Static lists of contacts
 */
export const contactLists = pgTable(
	"contact_lists",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),
		orgUnitId: uuid("org_unit_id")
			.references(() => orgUnits.id, {
				onDelete: "cascade",
			})
			.notNull(),
		key: text("key"),
		name: text("name"),
		description: text("description"),
		listType: text("list_type"),
		isPrimary: boolean("is_primary").default(false),
		isSystem: boolean("is_system").default(false),
		visibility: resourceVisibility("visibility").default("PRIVATE"),
		metadata: jsonb("metadata"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
	},
	(table) => {
		return {
			ixContactListsOrg: index("ix_contact_lists_org").on(table.organizationId),
			ixContactListsOrgUnit: index("ix_contact_lists_org_unit").on(
				table.orgUnitId,
			),
			ixContactListsOrgAndUnit: index("ix_contact_lists_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixContactListsKey: index("ix_contact_lists_key").on(table.key),
			ixContactListsVisibility: index("ix_contact_lists_visibility").on(
				table.visibility,
			),
		};
	},
);

/**
 * Contact List Members table - Membership in contact lists
 */
export const contactListMembers = pgTable(
	"contact_list_members",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		listId: uuid("list_id").references(() => contactLists.id, {
			onDelete: "cascade",
		}),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "cascade",
		}),
		status: text("status"),
		addedAt: timestamp("added_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		removedAt: timestamp("removed_at", { withTimezone: true, mode: "string" }),
		metadata: jsonb("metadata"),
	},
	(table) => {
		return {
			ixClmList: index("ix_clm_list").on(table.listId),
			ixClmContact: index("ix_clm_contact").on(table.contactId),
			ixClmListContact: index("ix_clm_list_contact").on(
				table.contactId,
				table.listId,
			),
		};
	},
);

/**
 * Contact Segments table - Dynamic segments based on rules
 */
export const contactSegments = pgTable(
	"contact_segments",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),
		orgUnitId: uuid("org_unit_id")
			.references(() => orgUnits.id, {
				onDelete: "cascade",
			})
			.notNull(),
		key: text("key"),
		name: text("name"),
		description: text("description"),
		segmentType: text("segment_type"),
		definition: jsonb("definition"),
		materializationMode: text("materialization_mode"),
		source: text("source"),
		visibility: resourceVisibility("visibility").default("PRIVATE"),
		metadata: jsonb("metadata"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
	},
	(table) => {
		return {
			ixContactSegmentsOrg: index("ix_contact_segments_org").on(
				table.organizationId,
			),
			ixContactSegmentsOrgUnit: index("ix_contact_segments_org_unit").on(
				table.orgUnitId,
			),
			ixContactSegmentsOrgAndUnit: index("ix_contact_segments_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixContactSegmentsKey: index("ix_contact_segments_key").on(table.key),
			ixContactSegmentsVisibility: index("ix_contact_segments_visibility").on(
				table.visibility,
			),
		};
	},
);

/**
 * Contact Segment Members table - Membership in contact segments
 */
export const contactSegmentMembers = pgTable(
	"contact_segment_members",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		segmentId: uuid("segment_id").references(() => contactSegments.id, {
			onDelete: "cascade",
		}),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "cascade",
		}),
		asOf: timestamp("as_of", { withTimezone: true, mode: "string" }),
		status: text("status"),
		metadata: jsonb("metadata"),
	},
	(table) => {
		return {
			ixCsmSegment: index("ix_csm_segment").on(table.segmentId),
			ixCsmContact: index("ix_csm_contact").on(table.contactId),
		};
	},
);

/**
 * Contact Channels table - Communication channels for contacts
 */
export const contactChannels = pgTable(
	"contact_channels",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "cascade",
		}),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),
		orgUnitId: uuid("org_unit_id")
			.references(() => orgUnits.id, {
				onDelete: "cascade",
			})
			.notNull(),
		channelId: uuid("channel_id").references(() => messageChannels.id, {
			onDelete: "set null",
		}),
		channelKind: text("channel_kind"),
		address: text("address"),
		status: text("status"),
		isPrimary: boolean("is_primary").default(false),
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
			ixContactChannelsContact: index("ix_contact_channels_contact").on(
				table.contactId,
			),
			ixContactChannelsOrgUnit: index("ix_contact_channels_org_unit").on(
				table.orgUnitId,
			),
			ixContactChannelsOrgAndUnit: index("ix_contact_channels_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixContactChannelsOrgKind: index("ix_contact_channels_org_kind").on(
				table.channelKind,
				table.organizationId,
			),
			ixContactChannelsAddress: index("ix_contact_channels_address").on(
				table.address,
				table.channelKind,
			),
			uxContactChannelsAddress: uniqueIndex("ux_contact_channels_address").on(
				table.contactId,
				table.channelKind,
				table.address,
			),
		};
	},
);

/**
 * Contact Subscriptions table - Subscription preferences for contacts
 */
export const contactSubscriptions = pgTable(
	"contact_subscriptions",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "cascade",
		}),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),
		orgUnitId: uuid("org_unit_id")
			.references(() => orgUnits.id, {
				onDelete: "cascade",
			})
			.notNull(),
		topicId: uuid("topic_id").references(() => subscriptionTopics.id, {
			onDelete: "cascade",
		}),
		contactChannelId: uuid("contact_channel_id").references(
			() => contactChannels.id,
			{ onDelete: "set null" },
		),
		channelKind: text("channel_kind"),
		status: subscriptionStatus("status").default("SUBSCRIBED"),
		source: text("source"),
		reason: text("reason"),
		occurredAt: timestamp("occurred_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		metadata: jsonb("metadata"),
	},
	(table) => {
		return {
			ixContactSubscriptionsContact: index(
				"ix_contact_subscriptions_contact",
			).on(table.contactId, table.organizationId),
			ixContactSubscriptionsTopic: index("ix_contact_subscriptions_topic").on(
				table.topicId,
			),
			ixContactSubscriptionsChannel: index(
				"ix_contact_subscriptions_channel",
			).on(table.contactChannelId),
		};
	},
);

/**
 * Events table - Custom events tracked for contacts
 */
export const events = pgTable(
	"events",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),
		orgUnitId: uuid("org_unit_id")
			.references(() => orgUnits.id, {
				onDelete: "cascade",
			})
			.notNull(),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "set null",
		}),
		eventName: text("event_name"),
		eventSource: text("event_source"),
		eventGroup: text("event_group"),
		occurredAt: timestamp("occurred_at", {
			withTimezone: true,
			mode: "string",
		}).notNull(),
		messageId: uuid("message_id").references(() => messages.id, {
			onDelete: "set null",
		}),
		properties: jsonb("properties"),
		context: jsonb("context"),
		insertId: text("insert_id"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
	},
	(table) => {
		return {
			ixEventsOrgTime: index("ix_events_org_time").on(
				table.occurredAt,
				table.organizationId,
			),
			ixEventsOrgUnit: index("ix_events_org_unit").on(table.orgUnitId),
			ixEventsOrgAndUnit: index("ix_events_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixEventsContactTime: index("ix_events_contact_time").on(
				table.contactId,
				table.occurredAt,
			),
			ixEventsNameTime: index("ix_events_name_time").on(
				table.eventName,
				table.occurredAt,
				table.organizationId,
			),
			ixEventsInsertId: index("ix_events_insert_id").on(
				table.insertId,
				table.organizationId,
			),
		};
	},
);

/**
 * Global Unsubscribes table - Permanent unsubscribe tracking across all contacts
 * Ensures compliance with CAN-SPAM, GDPR, and prevents re-subscription abuse
 */
export const globalUnsubscribes = pgTable(
	"global_unsubscribes",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id, {
				onDelete: "cascade",
			})
			.notNull(),

		// The identifier that's unsubscribed (at least one must be provided)
		email: citext("email"),
		phone: citext("phone"),

		// What channel they unsubscribed from
		channelKind: text("channel_kind").notNull(), // EMAIL, SMS, PUSH, etc.

		// When and why
		unsubscribedAt: timestamp("unsubscribed_at", {
			withTimezone: true,
			mode: "string",
		})
			.defaultNow()
			.notNull(),
		reason: text("reason"), // "User request", "Complaint", "Hard bounce", etc.
		source: text("source"), // UNSUBSCRIBE_LINK, COMPLAINT, BOUNCE, ADMIN, API

		// Optional: What topic they unsubscribed from (null = all topics)
		topicId: uuid("topic_id").references(() => subscriptionTopics.id, {
			onDelete: "set null",
		}),

		// Compliance tracking
		userAgent: text("user_agent"),
		ipAddress: text("ip_address"),
		metadata: jsonb("metadata"), // Additional context

		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		})
			.defaultNow()
			.notNull(),
	},
	(table) => {
		return {
			// Fast lookup before sending - email
			uxGlobalUnsubEmail: uniqueIndex("ux_global_unsub_email").on(
				table.organizationId,
				table.email,
				table.channelKind,
			),
			// Fast lookup before sending - phone
			uxGlobalUnsubPhone: uniqueIndex("ux_global_unsub_phone").on(
				table.organizationId,
				table.phone,
				table.channelKind,
			),
			// Query by organization
			ixGlobalUnsubOrg: index("ix_global_unsub_org").on(table.organizationId),
			// Query by date for reporting
			ixGlobalUnsubCreated: index("ix_global_unsub_created").on(
				table.unsubscribedAt,
			),
			// Query by source for analytics
			ixGlobalUnsubSource: index("ix_global_unsub_source").on(
				table.organizationId,
				table.source,
			),
		};
	},
);
