import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { contactLists, contactSegments, contacts } from "./contacts";
import {
	campaignStatus,
	journeyRunStatus,
	journeyStatus,
	resourceVisibility,
	stepStatus,
	stepType,
} from "./enums";
import { messageChannels, messages, templates } from "./messaging";
import { organizations, orgUnits } from "./organizations";
import { users } from "./users";

/**
 * Journeys table - Multi-step customer journeys
 * Note: Has forward references to contacts which will be linked in contacts.ts
 */
export const journeys = pgTable(
	"journeys",
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
		status: journeyStatus("status").default("DRAFT"),
		entryMode: text("entry_mode"),
		entryContactListId: uuid("entry_contact_list_id").references(
			() => contactLists.id,
			{ onDelete: "set null" },
		),
		entryContactSegmentId: uuid("entry_contact_segment_id").references(
			() => contactSegments.id,
			{ onDelete: "set null" },
		),
		entryEventName: text("entry_event_name"),
		definition: jsonb("definition"),
		version: integer("version").default(1).notNull(),
		settings: jsonb("settings"), // { max_duration_days: 30, allow_re_entry: false, timezone: 'UTC' }
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
			ixJourneysOrg: index("ix_journeys_org").on(table.organizationId),
			ixJourneysOrgUnit: index("ix_journeys_org_unit").on(table.orgUnitId),
			ixJourneysOrgAndUnit: index("ix_journeys_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixJourneysKey: index("ix_journeys_key").on(table.key),
			uxJourneysOrgKey: uniqueIndex("ux_journeys_org_key").on(
				table.organizationId,
				table.key,
			),
			ixJourneysStatus: index("ix_journeys_status").on(table.status),
			ixJourneysVisibility: index("ix_journeys_visibility").on(
				table.visibility,
			),
			ixJourneysCreatedBy: index("ix_journeys_created_by").on(
				table.createdByUserId,
			),
		};
	},
);

/**
 * Campaigns table - Marketing campaigns
 * Note: Has forward references to contacts which will be linked in contacts.ts
 */
export const campaigns = pgTable(
	"campaigns",
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
		campaignType: text("campaign_type"),
		channelId: uuid("channel_id").references(() => messageChannels.id, {
			onDelete: "set null",
		}),
		templateId: uuid("template_id").references(() => templates.id, {
			onDelete: "set null",
		}),
		entryContactListId: uuid("entry_contact_list_id").references(
			() => contactLists.id,
			{ onDelete: "set null" },
		),
		entryContactSegmentId: uuid("entry_contact_segment_id").references(
			() => contactSegments.id,
			{ onDelete: "set null" },
		),
		scheduleType: text("schedule_type"),
		scheduleConfig: jsonb("schedule_config"),
		sendConfig: jsonb("send_config"),
		status: campaignStatus("status").default("DRAFT"),
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
			ixCampaignsOrg: index("ix_campaigns_org").on(table.organizationId),
			ixCampaignsOrgUnit: index("ix_campaigns_org_unit").on(table.orgUnitId),
			ixCampaignsOrgAndUnit: index("ix_campaigns_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixCampaignsKey: index("ix_campaigns_key").on(table.key),
			uxCampaignsOrgKey: uniqueIndex("ux_campaigns_org_key").on(
				table.organizationId,
				table.key,
			),
			ixCampaignsStatus: index("ix_campaigns_status").on(table.status),
			ixCampaignsVisibility: index("ix_campaigns_visibility").on(
				table.visibility,
			),
			ixCampaignsCreatedBy: index("ix_campaigns_created_by").on(
				table.createdByUserId,
			),
		};
	},
);

/**
 * Campaign Runs table - Individual campaign execution instances
 * Note: Has forward references to contacts which will be linked in contacts.ts
 */
export const campaignRuns = pgTable(
	"campaign_runs",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		campaignId: uuid("campaign_id").references(() => campaigns.id, {
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
		triggerType: text("trigger_type"),
		scheduledAt: timestamp("scheduled_at", {
			withTimezone: true,
			mode: "string",
		}),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
		finishedAt: timestamp("finished_at", {
			withTimezone: true,
			mode: "string",
		}),
		status: text("status"),
		entryContactListId: uuid("entry_contact_list_id").references(
			() => contactLists.id,
			{ onDelete: "set null" },
		),
		entryContactSegmentId: uuid("entry_contact_segment_id").references(
			() => contactSegments.id,
			{ onDelete: "set null" },
		),
		targetSegmentId: uuid("target_segment_id").references(
			() => contactSegments.id,
			{ onDelete: "set null" },
		),
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
			ixCampaignRunsCampaign: index("ix_campaign_runs_campaign").on(
				table.campaignId,
				table.scheduledAt,
			),
			ixCampaignRunsOrgUnit: index("ix_campaign_runs_org_unit").on(
				table.orgUnitId,
			),
			ixCampaignRunsOrgAndUnit: index("ix_campaign_runs_org_and_unit").on(
				table.organizationId,
				table.orgUnitId,
			),
			ixCampaignRunsOrg: index("ix_campaign_runs_org").on(
				table.organizationId,
				table.status,
			),
		};
	},
);

/**
 * Journey Runs table - Individual journey execution instances for contacts
 * Note: Has forward references to contacts which will be linked in contacts.ts
 */
export const journeyRuns = pgTable(
	"journey_runs",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		journeyId: uuid("journey_id").references(() => journeys.id, {
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
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "cascade",
		}),
		journeyVersion: integer("journey_version").notNull(), // Snapshot version
		journeyDefinition: jsonb("journey_definition"), // Frozen copy of journey steps
		status: journeyRunStatus("status").default("ACTIVE"),
		currentStepKey: text("current_step_key"), // Where contact is now
		currentStepIndex: integer("current_step_index"),
		startedAt: timestamp("started_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }), // Optional timeout
		lastStepKey: text("last_step_key"),
		// Goal tracking
		goalAchieved: boolean("goal_achieved").default(false),
		goalAchievedAt: timestamp("goal_achieved_at", {
			withTimezone: true,
			mode: "string",
		}),
		goalEventName: text("goal_event_name"),
		// Holdout groups
		isHoldout: boolean("is_holdout").default(false),
		holdoutReason: text("holdout_reason"),
		context: jsonb("context"),
		metadata: jsonb("metadata"),
	},
	(table) => {
		return {
			ixJourneyRunsJourney: index("ix_journey_runs_journey").on(
				table.journeyId,
			),
			ixJourneyRunsContact: index("ix_journey_runs_contact").on(
				table.contactId,
				table.journeyId,
			),
			ixJourneyRunsStatus: index("ix_journey_runs_status").on(table.status),
		};
	},
);

/**
 * Journey Step Runs table - Individual step executions within journey runs
 */
export const journeyStepRuns = pgTable(
	"journey_step_runs",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		journeyRunId: uuid("journey_run_id").references(() => journeyRuns.id, {
			onDelete: "cascade",
		}),
		journeyId: uuid("journey_id").references(() => journeys.id, {
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
		stepKey: text("step_key").notNull(),
		stepType: stepType("step_type").notNull(),
		stepIndex: integer("step_index"),
		status: stepStatus("status").default("PENDING"),
		scheduledFor: timestamp("scheduled_for", {
			withTimezone: true,
			mode: "string",
		}), // For delays
		startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
		endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
		// Filter/branch tracking
		filterResult: jsonb("filter_result"), // { matched: true, condition: "...", variant: "A" }
		branchTaken: text("branch_taken"), // 'yes', 'no', 'A', 'B', 'US', 'default', etc.
		nextStepKey: text("next_step_key"), // Where contact goes next
		// Message tracking
		campaignId: uuid("campaign_id").references(() => campaigns.id, {
			onDelete: "set null",
		}),
		messageId: uuid("message_id").references(() => messages.id, {
			onDelete: "set null",
		}),
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
			ixJourneyStepRunsJourneyRun: index("ix_journey_step_runs_journey_run").on(
				table.journeyRunId,
			),
			ixJourneyStepRunsStep: index("ix_journey_step_runs_step").on(
				table.journeyId,
				table.stepKey,
			),
			ixJourneyStepRunsScheduled: index("ix_journey_step_runs_scheduled").on(
				table.scheduledFor,
				table.status,
			), // For delay polling
			ixJourneyStepRunsStatus: index("ix_journey_step_runs_status").on(
				table.status,
			),
			ixJourneyStepRunsEventId: index("ix_journey_step_runs_event_id").on(
				table.eventId,
			), // Idempotency
		};
	},
);
