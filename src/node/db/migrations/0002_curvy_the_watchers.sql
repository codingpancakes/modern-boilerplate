ALTER TYPE "assignment_status" ADD VALUE 'ACTIVE';--> statement-breakpoint
ALTER TYPE "assignment_status" ADD VALUE 'INACTIVE';--> statement-breakpoint
ALTER TYPE "assignment_status" ADD VALUE 'ENDED';--> statement-breakpoint
ALTER TYPE "campaign_status" ADD VALUE 'DRAFT';--> statement-breakpoint
ALTER TYPE "campaign_status" ADD VALUE 'SCHEDULED';--> statement-breakpoint
ALTER TYPE "campaign_status" ADD VALUE 'RUNNING';--> statement-breakpoint
ALTER TYPE "campaign_status" ADD VALUE 'PAUSED';--> statement-breakpoint
ALTER TYPE "campaign_status" ADD VALUE 'COMPLETED';--> statement-breakpoint
ALTER TYPE "campaign_status" ADD VALUE 'ARCHIVED';--> statement-breakpoint
ALTER TYPE "channel_type" ADD VALUE 'EMAIL';--> statement-breakpoint
ALTER TYPE "channel_type" ADD VALUE 'SMS';--> statement-breakpoint
ALTER TYPE "channel_type" ADD VALUE 'PUSH';--> statement-breakpoint
ALTER TYPE "channel_type" ADD VALUE 'WEB_PUSH';--> statement-breakpoint
ALTER TYPE "channel_type" ADD VALUE 'IN_APP';--> statement-breakpoint
ALTER TYPE "channel_type" ADD VALUE 'EMBEDDED';--> statement-breakpoint
ALTER TYPE "channel_type" ADD VALUE 'WHATSAPP';--> statement-breakpoint
ALTER TYPE "contact_status" ADD VALUE 'ACTIVE';--> statement-breakpoint
ALTER TYPE "contact_status" ADD VALUE 'UNSUBSCRIBED';--> statement-breakpoint
ALTER TYPE "contact_status" ADD VALUE 'BOUNCED';--> statement-breakpoint
ALTER TYPE "contact_status" ADD VALUE 'COMPLAINED';--> statement-breakpoint
ALTER TYPE "contact_status" ADD VALUE 'DELETED';--> statement-breakpoint
ALTER TYPE "delay_type" ADD VALUE 'TIME_DELAY';--> statement-breakpoint
ALTER TYPE "delay_type" ADD VALUE 'HOLD_UNTIL';--> statement-breakpoint
ALTER TYPE "delay_type" ADD VALUE 'HOLD_FOR_REPLY';--> statement-breakpoint
ALTER TYPE "embed_provider" ADD VALUE 'PGVECTOR';--> statement-breakpoint
ALTER TYPE "embed_provider" ADD VALUE 'EXTERNAL';--> statement-breakpoint
ALTER TYPE "experiment_status" ADD VALUE 'DRAFT';--> statement-breakpoint
ALTER TYPE "experiment_status" ADD VALUE 'RUNNING';--> statement-breakpoint
ALTER TYPE "experiment_status" ADD VALUE 'COMPLETED';--> statement-breakpoint
ALTER TYPE "experiment_status" ADD VALUE 'ARCHIVED';--> statement-breakpoint
ALTER TYPE "filter_type" ADD VALUE 'AB_SPLIT';--> statement-breakpoint
ALTER TYPE "filter_type" ADD VALUE 'YES_NO_SPLIT';--> statement-breakpoint
ALTER TYPE "filter_type" ADD VALUE 'ATTRIBUTE_SPLIT';--> statement-breakpoint
ALTER TYPE "filter_type" ADD VALUE 'SEND_TO_JOURNEY';--> statement-breakpoint
ALTER TYPE "integration_type" ADD VALUE 'WEBHOOK';--> statement-breakpoint
ALTER TYPE "integration_type" ADD VALUE 'SEGMENT';--> statement-breakpoint
ALTER TYPE "integration_type" ADD VALUE 'FACEBOOK';--> statement-breakpoint
ALTER TYPE "integration_type" ADD VALUE 'CUSTOM';--> statement-breakpoint
ALTER TYPE "journey_run_status" ADD VALUE 'ACTIVE';--> statement-breakpoint
ALTER TYPE "journey_run_status" ADD VALUE 'WAITING';--> statement-breakpoint
ALTER TYPE "journey_run_status" ADD VALUE 'COMPLETED';--> statement-breakpoint
ALTER TYPE "journey_run_status" ADD VALUE 'FAILED';--> statement-breakpoint
ALTER TYPE "journey_run_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "journey_run_status" ADD VALUE 'EXPIRED';--> statement-breakpoint
ALTER TYPE "journey_status" ADD VALUE 'DRAFT';--> statement-breakpoint
ALTER TYPE "journey_status" ADD VALUE 'ACTIVE';--> statement-breakpoint
ALTER TYPE "journey_status" ADD VALUE 'PAUSED';--> statement-breakpoint
ALTER TYPE "journey_status" ADD VALUE 'ARCHIVED';--> statement-breakpoint
ALTER TYPE "message_status" ADD VALUE 'QUEUED';--> statement-breakpoint
ALTER TYPE "message_status" ADD VALUE 'SENDING';--> statement-breakpoint
ALTER TYPE "message_status" ADD VALUE 'SENT';--> statement-breakpoint
ALTER TYPE "message_status" ADD VALUE 'DELIVERED';--> statement-breakpoint
ALTER TYPE "message_status" ADD VALUE 'BOUNCED';--> statement-breakpoint
ALTER TYPE "message_status" ADD VALUE 'FAILED';--> statement-breakpoint
ALTER TYPE "message_status" ADD VALUE 'EXPIRED';--> statement-breakpoint
ALTER TYPE "org_role" ADD VALUE 'OWNER';--> statement-breakpoint
ALTER TYPE "org_role" ADD VALUE 'ADMIN';--> statement-breakpoint
ALTER TYPE "org_role" ADD VALUE 'MANAGER';--> statement-breakpoint
ALTER TYPE "org_role" ADD VALUE 'MEMBER';--> statement-breakpoint
ALTER TYPE "org_role" ADD VALUE 'VIEWER';--> statement-breakpoint
ALTER TYPE "owner_type" ADD VALUE 'USER';--> statement-breakpoint
ALTER TYPE "owner_type" ADD VALUE 'ORGANIZATION';--> statement-breakpoint
ALTER TYPE "owner_type" ADD VALUE 'ORG_UNIT';--> statement-breakpoint
ALTER TYPE "owner_type" ADD VALUE 'GROUP';--> statement-breakpoint
ALTER TYPE "ownership_level" ADD VALUE 'PRIMARY';--> statement-breakpoint
ALTER TYPE "ownership_level" ADD VALUE 'SHARED';--> statement-breakpoint
ALTER TYPE "ownership_level" ADD VALUE 'VIEWER';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'JSON';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'STRING_ARRAY';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'ENUM';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'TIMESTAMP';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'DATE';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'NUMERIC';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'INTEGER';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'BOOLEAN';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'TEXT';--> statement-breakpoint
ALTER TYPE "persona_attr_type" ADD VALUE 'STRING';--> statement-breakpoint
ALTER TYPE "persona_cardinality" ADD VALUE 'MULTI';--> statement-breakpoint
ALTER TYPE "persona_cardinality" ADD VALUE 'SINGLE';--> statement-breakpoint
ALTER TYPE "persona_value_source" ADD VALUE 'SYNC';--> statement-breakpoint
ALTER TYPE "persona_value_source" ADD VALUE 'IMPORT';--> statement-breakpoint
ALTER TYPE "persona_value_source" ADD VALUE 'AI';--> statement-breakpoint
ALTER TYPE "persona_value_source" ADD VALUE 'COACH';--> statement-breakpoint
ALTER TYPE "persona_value_source" ADD VALUE 'SELF';--> statement-breakpoint
ALTER TYPE "resource_visibility" ADD VALUE 'PRIVATE';--> statement-breakpoint
ALTER TYPE "resource_visibility" ADD VALUE 'SHARED';--> statement-breakpoint
ALTER TYPE "resource_visibility" ADD VALUE 'ORG_UNIT';--> statement-breakpoint
ALTER TYPE "resource_visibility" ADD VALUE 'ORGANIZATION';--> statement-breakpoint
ALTER TYPE "resource_visibility" ADD VALUE 'PUBLIC';--> statement-breakpoint
ALTER TYPE "step_status" ADD VALUE 'PENDING';--> statement-breakpoint
ALTER TYPE "step_status" ADD VALUE 'PROCESSING';--> statement-breakpoint
ALTER TYPE "step_status" ADD VALUE 'COMPLETED';--> statement-breakpoint
ALTER TYPE "step_status" ADD VALUE 'FAILED';--> statement-breakpoint
ALTER TYPE "step_status" ADD VALUE 'SKIPPED';--> statement-breakpoint
ALTER TYPE "step_status" ADD VALUE 'SCHEDULED';--> statement-breakpoint
ALTER TYPE "step_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "step_type" ADD VALUE 'START';--> statement-breakpoint
ALTER TYPE "step_type" ADD VALUE 'SEND';--> statement-breakpoint
ALTER TYPE "step_type" ADD VALUE 'DELAY';--> statement-breakpoint
ALTER TYPE "step_type" ADD VALUE 'FILTER';--> statement-breakpoint
ALTER TYPE "step_type" ADD VALUE 'USER_UPDATE';--> statement-breakpoint
ALTER TYPE "step_type" ADD VALUE 'INTEGRATION';--> statement-breakpoint
ALTER TYPE "subscription_status" ADD VALUE 'SUBSCRIBED';--> statement-breakpoint
ALTER TYPE "subscription_status" ADD VALUE 'UNSUBSCRIBED';--> statement-breakpoint
ALTER TYPE "subscription_status" ADD VALUE 'PENDING';--> statement-breakpoint
ALTER TYPE "user_type" ADD VALUE 'OPERATOR';--> statement-breakpoint
ALTER TYPE "user_type" ADD VALUE 'MEMBER';--> statement-breakpoint
ALTER TYPE "user_update_type" ADD VALUE 'SET_FIELDS';--> statement-breakpoint
ALTER TYPE "user_update_type" ADD VALUE 'LIST_MEMBERSHIP';--> statement-breakpoint
ALTER TYPE "user_update_type" ADD VALUE 'SUBSCRIPTION';--> statement-breakpoint
ALTER TYPE "webhook_status" ADD VALUE 'ACTIVE';--> statement-breakpoint
ALTER TYPE "webhook_status" ADD VALUE 'PAUSED';--> statement-breakpoint
ALTER TYPE "webhook_status" ADD VALUE 'FAILED';--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "role" SET DEFAULT 'MEMBER';--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "resource_owners" ALTER COLUMN "ownership_level" SET DEFAULT 'PRIMARY';--> statement-breakpoint
ALTER TABLE "experiments" ALTER COLUMN "status" SET DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "experiments" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "send_status" SET DEFAULT 'QUEUED';--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "status" SET DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';--> statement-breakpoint
ALTER TABLE "journey_runs" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "journey_step_runs" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "journeys" ALTER COLUMN "status" SET DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "journeys" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';--> statement-breakpoint
ALTER TABLE "contact_lists" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';--> statement-breakpoint
ALTER TABLE "contact_segments" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';--> statement-breakpoint
ALTER TABLE "contact_subscriptions" ALTER COLUMN "status" SET DEFAULT 'SUBSCRIBED';--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';