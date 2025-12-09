import { pgEnum } from "drizzle-orm/pg-core";

// Core enums
export const assignmentStatus = pgEnum("assignment_status", [
	"ACTIVE",
	"INACTIVE",
	"ENDED",
]);

export const embedProvider = pgEnum("embed_provider", ["PGVECTOR", "EXTERNAL"]);

export const personaAttrType = pgEnum("persona_attr_type", [
	"JSON",
	"STRING_ARRAY",
	"ENUM",
	"TIMESTAMP",
	"DATE",
	"NUMERIC",
	"INTEGER",
	"BOOLEAN",
	"TEXT",
	"STRING",
]);

export const personaCardinality = pgEnum("persona_cardinality", [
	"MULTI",
	"SINGLE",
]);

export const personaValueSource = pgEnum("persona_value_source", [
	"SYNC",
	"IMPORT",
	"AI",
	"SELF",
]);

export const userType = pgEnum("user_type", ["OPERATOR", "MEMBER"]);

export const orgRole = pgEnum("org_role", [
	"OWNER",
	"ADMIN",
	"MANAGER",
	"MEMBER",
	"VIEWER",
]);

export const ownerType = pgEnum("owner_type", [
	"USER",
	"ORGANIZATION",
	"ORG_UNIT",
	"GROUP",
]);

export const ownershipLevel = pgEnum("ownership_level", [
	"PRIMARY",
	"SHARED",
	"VIEWER",
]);

export const resourceVisibility = pgEnum("resource_visibility", [
	"PRIVATE",
	"SHARED",
	"ORG_UNIT",
	"ORGANIZATION",
	"PUBLIC",
]);

// Messaging platform enums
export const messageStatus = pgEnum("message_status", [
	"QUEUED",
	"SENDING",
	"SENT",
	"DELIVERED",
	"BOUNCED",
	"FAILED",
	"EXPIRED",
]);

export const campaignStatus = pgEnum("campaign_status", [
	"DRAFT",
	"SCHEDULED",
	"RUNNING",
	"PAUSED",
	"COMPLETED",
	"ARCHIVED",
]);

export const journeyStatus = pgEnum("journey_status", [
	"DRAFT",
	"ACTIVE",
	"PAUSED",
	"ARCHIVED",
]);

export const journeyRunStatus = pgEnum("journey_run_status", [
	"ACTIVE",
	"WAITING",
	"COMPLETED",
	"FAILED",
	"CANCELLED",
	"EXPIRED",
]);

export const stepStatus = pgEnum("step_status", [
	"PENDING",
	"PROCESSING",
	"COMPLETED",
	"FAILED",
	"SKIPPED",
	"SCHEDULED",
	"CANCELLED",
]);

export const stepType = pgEnum("step_type", [
	"START",
	"SEND",
	"DELAY",
	"FILTER",
	"USER_UPDATE",
	"INTEGRATION",
]);

export const delayType = pgEnum("delay_type", [
	"TIME_DELAY",
	"HOLD_UNTIL",
	"HOLD_FOR_REPLY",
]);

export const filterType = pgEnum("filter_type", [
	"AB_SPLIT",
	"YES_NO_SPLIT",
	"ATTRIBUTE_SPLIT",
	"SEND_TO_JOURNEY",
]);

export const userUpdateType = pgEnum("user_update_type", [
	"SET_FIELDS",
	"LIST_MEMBERSHIP",
	"SUBSCRIPTION",
]);

export const integrationType = pgEnum("integration_type", [
	"WEBHOOK",
	"SEGMENT",
	"FACEBOOK",
	"CUSTOM",
]);

export const channelType = pgEnum("channel_type", [
	"EMAIL",
	"SMS",
	"PUSH",
	"WEB_PUSH",
	"IN_APP",
	"EMBEDDED",
	"WHATSAPP",
]);

export const contactStatus = pgEnum("contact_status", [
	"ACTIVE",
	"UNSUBSCRIBED",
	"BOUNCED",
	"COMPLAINED",
	"DELETED",
]);

export const subscriptionStatus = pgEnum("subscription_status", [
	"SUBSCRIBED",
	"UNSUBSCRIBED",
	"PENDING",
]);

export const webhookStatus = pgEnum("webhook_status", [
	"ACTIVE",
	"PAUSED",
	"FAILED",
]);

export const experimentStatus = pgEnum("experiment_status", [
	"DRAFT",
	"RUNNING",
	"COMPLETED",
	"ARCHIVED",
]);
