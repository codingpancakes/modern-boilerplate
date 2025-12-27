import {
	type AnyPgColumn,
	boolean,
	index,
	inet,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { contactChannels, contacts } from "./contacts";
import {
	experimentStatus,
	messageStatus,
	resourceVisibility,
	webhookStatus,
} from "./enums";
import { campaignRuns, campaigns, journeyRuns, journeys } from "./journeys";
import { organizations, orgUnits } from "./organizations";
import { users } from "./users";

/**
 * Message Channels table - Communication channels (email, SMS, etc.)
 */
export const messageChannels = pgTable(
	"message_channels",
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
		kind: text("kind"),
		provider: text("provider"),
		config: jsonb("config"),
		isDefault: boolean("is_default").default(false),
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
			ixChannelsOrg: index("ix_channels_org").on(table.organizationId),
			ixChannelsOrgUnit: index("ix_channels_org_unit").on(table.orgUnitId),
			ixChannelsOrgAndUnit: index("ix_channels_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixChannelsKey: index("ix_channels_key").on(
				table.key,
				table.organizationId,
			),
			ixChannelsKindOrg: index("ix_channels_kind_org").on(
				table.kind,
				table.organizationId,
			),
			ixChannelsKindOrgUnit: index("ix_channels_kind_org_unit").on(
				table.kind,
				table.organizationId,
				table.orgUnitId,
			),
			uxChannelsKeyOrg: uniqueIndex("ux_channels_key_org").on(
				table.key,
				table.organizationId,
			),
		};
	},
);

/**
 * Subscription Topics table - Message subscription topics
 */
export const subscriptionTopics = pgTable(
	"subscription_topics",
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
		defaultChannelKind: text("default_channel_kind"),
		isRequired: boolean("is_required").default(false),
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
			ixTopicsOrg: index("ix_topics_org").on(table.organizationId),
			ixTopicsOrgUnit: index("ix_topics_org_unit").on(table.orgUnitId),
			ixTopicsOrgAndUnit: index("ix_topics_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixTopicsKey: index("ix_topics_key").on(table.key, table.organizationId),
			uxTopicsKeyOrg: uniqueIndex("ux_topics_key_org").on(
				table.key,
				table.organizationId,
			),
		};
	},
);

/**
 * Templates table - Message templates
 */
export const templates = pgTable(
	"templates",
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
		channelId: uuid("channel_id").references(() => messageChannels.id, {
			onDelete: "set null",
		}),
		key: text("key"),
		name: text("name"),
		description: text("description"),
		kind: text("kind"),
		renderEngine: text("render_engine"),
		currentVersionId: uuid("current_version_id").references(
			(): AnyPgColumn => templateVersions.id,
			{ onDelete: "set null" },
		),
		visibility: resourceVisibility("visibility").default("PRIVATE"),
		metadata: jsonb("metadata"),
		createdByUserId: uuid("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
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
			ixTemplatesOrg: index("ix_templates_org").on(table.organizationId),
			ixTemplatesOrgUnit: index("ix_templates_org_unit").on(table.orgUnitId),
			ixTemplatesOrgAndUnit: index("ix_templates_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixTemplatesChannel: index("ix_templates_channel").on(table.channelId),
			ixTemplatesKey: index("ix_templates_key").on(table.key),
			uxTemplatesOrgKey: uniqueIndex("ux_templates_org_key").on(
				table.organizationId,
				table.key,
			),
			ixTemplatesVisibility: index("ix_templates_visibility").on(
				table.visibility,
			),
			ixTemplatesCreatedBy: index("ix_templates_created_by").on(
				table.createdByUserId,
			),
		};
	},
);

/**
 * Template Versions table - Versioned template content
 */
export const templateVersions = pgTable(
	"template_versions",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		templateId: uuid("template_id").references(
			(): AnyPgColumn => templates.id,
			{ onDelete: "cascade" },
		),
		version: integer("version"),
		isActive: boolean("is_active").default(true),
		subject: text("subject"),
		bodyHtml: text("body_html"),
		bodyText: text("body_text"),
		dataSchema: jsonb("data_schema"),
		metadata: jsonb("metadata"),
		createdByUserId: uuid("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
	},
	(table) => {
		return {
			ixTemplateVersionsTemplate: index("ix_template_versions_template").on(
				table.templateId,
				table.version,
			),
		};
	},
);

/**
 * Messages table - Individual messages sent to contacts
 * Note: This table has forward references to campaigns, journeys, and contacts
 * which will be imported from their respective schema files
 */
export const messages = pgTable(
	"messages",
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
		campaignId: uuid("campaign_id").references(() => campaigns.id, {
			onDelete: "set null",
		}),
		campaignRunId: uuid("campaign_run_id").references(() => campaignRuns.id, {
			onDelete: "set null",
		}),
		journeyId: uuid("journey_id").references(() => journeys.id, {
			onDelete: "set null",
		}),
		journeyRunId: uuid("journey_run_id").references(() => journeyRuns.id, {
			onDelete: "set null",
		}),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "set null",
		}),
		contactChannelId: uuid("contact_channel_id").references(
			() => contactChannels.id,
			{ onDelete: "set null" },
		),
		channelId: uuid("channel_id").references(() => messageChannels.id, {
			onDelete: "set null",
		}),
		channelKind: text("channel_kind"),
		topicId: uuid("topic_id").references(() => subscriptionTopics.id, {
			onDelete: "set null",
		}),
		templateId: uuid("template_id").references(() => templates.id, {
			onDelete: "set null",
		}),
		templateVersionId: uuid("template_version_id").references(
			() => templateVersions.id,
			{ onDelete: "set null" },
		),
		messageKey: text("message_key"),
		providerMessageId: text("provider_message_id"),
		fromAddress: text("from_address"),
		toAddress: text("to_address"),
		subject: text("subject"),
		sendStatus: messageStatus("send_status").default("QUEUED"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		queuedAt: timestamp("queued_at", { withTimezone: true, mode: "string" }),
		sendingStartedAt: timestamp("sending_started_at", {
			withTimezone: true,
			mode: "string",
		}),
		sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "string",
		}),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
		softDeletedAt: timestamp("soft_deleted_at", {
			withTimezone: true,
			mode: "string",
		}),
		renderContext: jsonb("render_context"),
		renderedBodyUrl: text("rendered_body_url"),
		metadata: jsonb("metadata"),
	},
	(table) => {
		return {
			ixMessagesOrg: index("ix_messages_org").on(table.organizationId),
			ixMessagesCampaign: index("ix_messages_campaign").on(table.campaignId),
			ixMessagesContact: index("ix_messages_contact").on(
				table.contactId,
				table.organizationId,
			),
			ixMessagesProvider: index("ix_messages_provider").on(
				table.providerMessageId,
			),
			ixMessagesStatus: index("ix_messages_status").on(table.sendStatus),
			ixMessagesQueuedAt: index("ix_messages_queued_at").on(table.queuedAt),
			ixMessagesCampaignStatus: index("ix_messages_campaign_status").on(
				table.campaignId,
				table.sendStatus,
			),
			ixMessagesContactStatus: index("ix_messages_contact_status").on(
				table.contactId,
				table.sendStatus,
			),
		};
	},
);

/**
 * Message Events table - Tracking events for messages (opens, clicks, etc.)
 */
export const messageEvents = pgTable(
	"message_events",
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
		messageId: uuid("message_id").references(() => messages.id, {
			onDelete: "cascade",
		}),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "set null",
		}),
		eventType: text("event_type"),
		eventSubtype: text("event_subtype"),
		providerEventId: text("provider_event_id"),
		occurredAt: timestamp("occurred_at", {
			withTimezone: true,
			mode: "string",
		}).notNull(),
		url: text("url"),
		ipAddress: inet("ip_address"),
		userAgent: text("user_agent"),
		rawEvent: jsonb("raw_event"),
		metadata: jsonb("metadata"),
	},
	(table) => {
		return {
			ixMessageEventsMessage: index("ix_message_events_message").on(
				table.eventType,
				table.messageId,
			),
			ixMessageEventsContact: index("ix_message_events_contact").on(
				table.contactId,
				table.eventType,
			),
			ixMessageEventsOrgTime: index("ix_message_events_org_time").on(
				table.occurredAt,
				table.organizationId,
			),
		};
	},
);

/**
 * Experiments table - A/B testing for campaigns
 */
export const experiments = pgTable(
	"experiments",
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
		campaignId: uuid("campaign_id").references(() => campaigns.id, {
			onDelete: "set null",
		}),
		key: text("key"),
		name: text("name"),
		description: text("description"),
		status: experimentStatus("status").default("DRAFT"),
		winnerCriteria: text("winner_criteria"), // open_rate, click_rate, conversion, revenue
		winnerMetric: text("winner_metric"),
		variants: jsonb("variants"), // [{id, name, templateId, percentage, weight}]
		startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
		endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
		winnerId: text("winner_id"),
		results: jsonb("results"),
		visibility: resourceVisibility("visibility").default("PRIVATE"),
		metadata: jsonb("metadata"),
		createdByUserId: uuid("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
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
			ixExperimentsOrg: index("ix_experiments_org").on(table.organizationId),
			ixExperimentsOrgUnit: index("ix_experiments_org_unit").on(
				table.orgUnitId,
			),
			ixExperimentsOrgAndUnit: index("ix_experiments_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixExperimentsCampaign: index("ix_experiments_campaign").on(
				table.campaignId,
			),
			ixExperimentsKey: index("ix_experiments_key").on(table.key),
			ixExperimentsStatus: index("ix_experiments_status").on(table.status),
			ixExperimentsVisibility: index("ix_experiments_visibility").on(
				table.visibility,
			),
			ixExperimentsCreatedBy: index("ix_experiments_created_by").on(
				table.createdByUserId,
			),
			uxExperimentsKeyOrg: uniqueIndex("ux_experiments_key_org").on(
				table.key,
				table.organizationId,
			),
		};
	},
);

/**
 * Webhooks table - Webhook configurations for event notifications
 */
export const webhooks = pgTable(
	"webhooks",
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
		name: text("name"),
		url: text("url").notNull(),
		events: text("events").array().notNull(), // ['message.sent', 'message.delivered', 'contact.created']
		secret: text("secret"),
		status: webhookStatus("status").default("ACTIVE"),
		headers: jsonb("headers"), // Custom headers to send
		retryPolicy: jsonb("retry_policy"), // {maxRetries, backoffMultiplier}
		lastTriggeredAt: timestamp("last_triggered_at", {
			withTimezone: true,
			mode: "string",
		}),
		lastSuccessAt: timestamp("last_success_at", {
			withTimezone: true,
			mode: "string",
		}),
		lastFailureAt: timestamp("last_failure_at", {
			withTimezone: true,
			mode: "string",
		}),
		failureCount: integer("failure_count").default(0),
		visibility: resourceVisibility("visibility").default("PRIVATE"),
		metadata: jsonb("metadata"),
		createdByUserId: uuid("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
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
			ixWebhooksOrg: index("ix_webhooks_org").on(table.organizationId),
			ixWebhooksOrgUnit: index("ix_webhooks_org_unit").on(table.orgUnitId),
			ixWebhooksOrgAndUnit: index("ix_webhooks_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixWebhooksStatus: index("ix_webhooks_status").on(table.status),
			ixWebhooksVisibility: index("ix_webhooks_visibility").on(
				table.visibility,
			),
			ixWebhooksCreatedBy: index("ix_webhooks_created_by").on(
				table.createdByUserId,
			),
		};
	},
);

/**
 * Webhook Deliveries table - Tracks webhook delivery attempts
 */
export const webhookDeliveries = pgTable(
	"webhook_deliveries",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		webhookId: uuid("webhook_id").references(() => webhooks.id, {
			onDelete: "cascade",
		}),
		eventType: text("event_type").notNull(),
		eventId: uuid("event_id"), // ID of the message, contact, etc that triggered this
		payload: jsonb("payload").notNull(),
		status: text("status").default("pending"), // pending, sent, failed
		httpStatus: integer("http_status"),
		responseBody: text("response_body"),
		errorMessage: text("error_message"),
		attemptCount: integer("attempt_count").default(0),
		nextRetryAt: timestamp("next_retry_at", {
			withTimezone: true,
			mode: "string",
		}),
		sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "string",
		}),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
	},
	(table) => {
		return {
			ixWebhookDeliveriesWebhook: index("ix_webhook_deliveries_webhook").on(
				table.webhookId,
				table.createdAt,
			),
			ixWebhookDeliveriesStatus: index("ix_webhook_deliveries_status").on(
				table.status,
				table.nextRetryAt,
			),
			ixWebhookDeliveriesEvent: index("ix_webhook_deliveries_event").on(
				table.eventType,
				table.eventId,
			),
		};
	},
);
