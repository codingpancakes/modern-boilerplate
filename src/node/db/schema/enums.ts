import { pgEnum } from "drizzle-orm/pg-core";

// Core enums
export const assignmentStatus = pgEnum("assignment_status", [
	"active",
	"inactive",
	"ended",
]);

export const embedProvider = pgEnum("embed_provider", ["pgvector", "external"]);

export const personaAttrType = pgEnum("persona_attr_type", [
	"json",
	"string_array",
	"enum",
	"timestamp",
	"date",
	"numeric",
	"integer",
	"boolean",
	"text",
	"string",
]);

export const personaCardinality = pgEnum("persona_cardinality", [
	"multi",
	"single",
]);

export const personaValueSource = pgEnum("persona_value_source", [
	"sync",
	"import",
	"ai",
	"coach",
	"self",
]);

export const userType = pgEnum("user_type", ["operator", "member"]);

export const orgRole = pgEnum("org_role", [
	"owner",
	"admin",
	"manager",
	"member",
	"viewer",
]);

export const ownerType = pgEnum("owner_type", [
	"user",
	"organization",
	"org_unit",
	"group",
]);

export const ownershipLevel = pgEnum("ownership_level", [
	"primary",
	"shared",
	"viewer",
]);

export const resourceVisibility = pgEnum("resource_visibility", [
	"private",
	"shared",
	"org_unit",
	"organization",
	"public",
]);

// Messaging platform enums
export const messageStatus = pgEnum("message_status", [
	"queued",
	"sending",
	"sent",
	"delivered",
	"bounced",
	"failed",
	"expired",
]);

export const campaignStatus = pgEnum("campaign_status", [
	"draft",
	"scheduled",
	"running",
	"paused",
	"completed",
	"archived",
]);

export const journeyStatus = pgEnum("journey_status", [
	"draft",
	"active",
	"paused",
	"archived",
]);

export const journeyRunStatus = pgEnum("journey_run_status", [
	"active",
	"waiting",
	"completed",
	"failed",
	"cancelled",
	"expired",
]);

export const stepStatus = pgEnum("step_status", [
	"pending",
	"processing",
	"completed",
	"failed",
	"skipped",
	"scheduled",
	"cancelled",
]);

export const stepType = pgEnum("step_type", [
	"start",
	"send",
	"delay",
	"filter",
	"user_update",
	"integration",
]);

export const delayType = pgEnum("delay_type", [
	"time_delay",
	"hold_until",
	"hold_for_reply",
]);

export const filterType = pgEnum("filter_type", [
	"ab_split",
	"yes_no_split",
	"attribute_split",
	"send_to_journey",
]);

export const userUpdateType = pgEnum("user_update_type", [
	"set_fields",
	"list_membership",
	"subscription",
]);

export const integrationType = pgEnum("integration_type", [
	"webhook",
	"segment",
	"facebook",
	"custom",
]);

export const channelType = pgEnum("channel_type", [
	"email",
	"sms",
	"push",
	"web_push",
	"in_app",
	"embedded",
	"whatsapp",
]);

export const contactStatus = pgEnum("contact_status", [
	"active",
	"unsubscribed",
	"bounced",
	"complained",
	"deleted",
]);

export const subscriptionStatus = pgEnum("subscription_status", [
	"subscribed",
	"unsubscribed",
	"pending",
]);

export const webhookStatus = pgEnum("webhook_status", [
	"active",
	"paused",
	"failed",
]);

export const experimentStatus = pgEnum("experiment_status", [
	"draft",
	"running",
	"completed",
	"archived",
]);
