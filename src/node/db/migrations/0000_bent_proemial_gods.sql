DO $$ BEGIN
 CREATE TYPE "assignment_status" AS ENUM('active', 'inactive', 'ended');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "campaign_status" AS ENUM('draft', 'scheduled', 'running', 'paused', 'completed', 'archived');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "channel_type" AS ENUM('email', 'sms', 'push', 'web_push', 'in_app', 'embedded', 'whatsapp');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "contact_status" AS ENUM('active', 'unsubscribed', 'bounced', 'complained', 'deleted');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "delay_type" AS ENUM('time_delay', 'hold_until', 'hold_for_reply');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "embed_provider" AS ENUM('pgvector', 'external');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "experiment_status" AS ENUM('draft', 'running', 'completed', 'archived');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "filter_type" AS ENUM('ab_split', 'yes_no_split', 'attribute_split', 'send_to_journey');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "integration_type" AS ENUM('webhook', 'segment', 'facebook', 'custom');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "journey_run_status" AS ENUM('active', 'waiting', 'completed', 'failed', 'cancelled', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "journey_status" AS ENUM('draft', 'active', 'paused', 'archived');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "message_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "org_role" AS ENUM('owner', 'admin', 'manager', 'member', 'viewer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "owner_type" AS ENUM('user', 'organization', 'org_unit', 'group');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "ownership_level" AS ENUM('primary', 'shared', 'viewer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "persona_attr_type" AS ENUM('json', 'string_array', 'enum', 'timestamp', 'date', 'numeric', 'integer', 'boolean', 'text', 'string');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "persona_cardinality" AS ENUM('multi', 'single');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "persona_value_source" AS ENUM('sync', 'import', 'ai', 'coach', 'self');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "resource_visibility" AS ENUM('private', 'shared', 'org_unit', 'organization', 'public');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "step_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'skipped', 'scheduled', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "step_type" AS ENUM('start', 'send', 'delay', 'filter', 'user_update', 'integration');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "subscription_status" AS ENUM('subscribed', 'unsubscribed', 'pending');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "user_type" AS ENUM('operator', 'member');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "user_update_type" AS ENUM('set_fields', 'list_membership', 'subscription');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "webhook_status" AS ENUM('active', 'paused', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"provider_type" text,
	"provider_subject" text,
	"email_at_provider" "citext",
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"organization_id" uuid,
	"trigger_type" text,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" text,
	"entry_contact_list_id" uuid,
	"entry_contact_segment_id" uuid,
	"target_segment_id" uuid,
	"target_count" bigint,
	"sent_count" bigint,
	"error_count" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"name" text,
	"description" text,
	"campaign_type" text,
	"channel_id" uuid,
	"template_id" uuid,
	"entry_contact_list_id" uuid,
	"entry_contact_segment_id" uuid,
	"schedule_type" text,
	"schedule_config" jsonb,
	"send_config" jsonb,
	"status" "campaign_status" DEFAULT 'draft',
	"visibility" "resource_visibility" DEFAULT 'private',
	"metadata" jsonb,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"organization_id" uuid,
	"channel_id" uuid,
	"channel_kind" text,
	"address" text,
	"status" text,
	"is_primary" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_list_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid,
	"contact_id" uuid,
	"status" text,
	"added_at" timestamp with time zone DEFAULT now(),
	"removed_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"name" text,
	"description" text,
	"list_type" text,
	"is_primary" boolean DEFAULT false,
	"is_system" boolean DEFAULT false,
	"visibility" "resource_visibility" DEFAULT 'private',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_segment_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid,
	"contact_id" uuid,
	"as_of" timestamp with time zone,
	"status" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"name" text,
	"description" text,
	"segment_type" text,
	"definition" jsonb,
	"materialization_mode" text,
	"source" text,
	"visibility" "resource_visibility" DEFAULT 'private',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"organization_id" uuid,
	"topic_id" uuid,
	"contact_channel_id" uuid,
	"channel_kind" text,
	"status" "subscription_status" DEFAULT 'subscribed',
	"source" text,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now(),
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"external_id" text,
	"email" "citext",
	"phone" "citext",
	"first_name" text,
	"last_name" text,
	"locale" text,
	"timezone" text,
	"status" "contact_status" DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"property_def_id" uuid,
	"value_string" text,
	"value_text" text,
	"value_boolean" boolean,
	"value_int" bigint,
	"value_num" numeric,
	"value_date" date,
	"value_timestamp" timestamp with time zone,
	"value_enum" text,
	"value_multi_enum" text[],
	"value_json" jsonb,
	"visibility" text,
	"source" text,
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"contact_id" uuid,
	"event_name" text,
	"event_source" text,
	"event_group" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"message_id" uuid,
	"properties" jsonb,
	"context" jsonb,
	"insert_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"key" text,
	"name" text,
	"description" text,
	"status" "experiment_status" DEFAULT 'draft',
	"winner_criteria" text,
	"winner_metric" text,
	"variants" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"winner_id" text,
	"results" jsonb,
	"visibility" "resource_visibility" DEFAULT 'private',
	"metadata" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid,
	"user_id" uuid,
	"role" text,
	"status" text,
	"joined_at" timestamp with time zone DEFAULT now(),
	"left_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"org_unit_id" uuid,
	"parent_id" uuid,
	"key" text,
	"name" text,
	"kind" text,
	"is_root" boolean DEFAULT false,
	"membership_mode" text,
	"rule" jsonb,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_size" integer,
	"visibility" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journey_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid,
	"organization_id" uuid,
	"contact_id" uuid,
	"journey_version" integer NOT NULL,
	"journey_definition" jsonb,
	"status" "journey_run_status" DEFAULT 'active',
	"current_step_key" text,
	"current_step_index" integer,
	"started_at" timestamp with time zone DEFAULT now(),
	"ended_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_step_key" text,
	"goal_achieved" boolean DEFAULT false,
	"goal_achieved_at" timestamp with time zone,
	"goal_event_name" text,
	"is_holdout" boolean DEFAULT false,
	"holdout_reason" text,
	"context" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journey_step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_run_id" uuid,
	"journey_id" uuid,
	"organization_id" uuid,
	"step_key" text NOT NULL,
	"step_type" "step_type" NOT NULL,
	"step_index" integer,
	"status" "step_status" DEFAULT 'pending',
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"filter_result" jsonb,
	"branch_taken" text,
	"next_step_key" text,
	"campaign_id" uuid,
	"message_id" uuid,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"event_id" text,
	"sqs_message_id" text,
	"evaluation_context" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"name" text,
	"description" text,
	"status" "journey_status" DEFAULT 'draft',
	"entry_mode" text,
	"entry_contact_list_id" uuid,
	"entry_contact_segment_id" uuid,
	"entry_event_name" text,
	"definition" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"settings" jsonb,
	"visibility" "resource_visibility" DEFAULT 'private',
	"metadata" jsonb,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text,
	"name" text,
	"kind" text,
	"provider" text,
	"config" jsonb,
	"is_default" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"message_id" uuid,
	"contact_id" uuid,
	"event_type" text,
	"event_subtype" text,
	"provider_event_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"url" text,
	"ip_address" "inet",
	"user_agent" text,
	"raw_event" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"campaign_id" uuid,
	"campaign_run_id" uuid,
	"journey_id" uuid,
	"journey_run_id" uuid,
	"contact_id" uuid,
	"contact_channel_id" uuid,
	"channel_id" uuid,
	"channel_kind" text,
	"topic_id" uuid,
	"template_id" uuid,
	"template_version_id" uuid,
	"message_key" text,
	"provider_message_id" text,
	"from_address" text,
	"to_address" text,
	"subject" text,
	"send_status" "message_status" DEFAULT 'queued',
	"error_code" text,
	"error_message" text,
	"queued_at" timestamp with time zone,
	"sending_started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"soft_deleted_at" timestamp with time zone,
	"render_context" jsonb,
	"rendered_body_url" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"parent_id" uuid,
	"code" text,
	"name" text,
	"is_root" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"role" "org_role" DEFAULT 'member',
	"status" "assignment_status" DEFAULT 'active',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"slug" text,
	"org_type" text,
	"visibility" text,
	"default_timezone" text,
	"country_code" text,
	"branding" jsonb,
	"metadata" jsonb,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preferred_name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"pronouns" text,
	"external_id" text,
	"location" text,
	"country_code" text,
	"activated_on" date,
	"deactivated_on" date,
	"no_sync" boolean DEFAULT false,
	"photo_url" text,
	"gender" text,
	"lgbtq" boolean,
	"ethnicity" text,
	"languages" text[],
	"onboarding_completed" boolean DEFAULT false,
	"persona" jsonb,
	"snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "property_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_scope" text,
	"owner_org_id" uuid,
	"entity_type" text,
	"profile_kind" text,
	"code" text,
	"name" text,
	"description" text,
	"data_type" text,
	"cardinality" text,
	"allowed_values" jsonb,
	"default_visibility" text,
	"is_indexed" boolean DEFAULT false,
	"is_sensitive" boolean DEFAULT false,
	"status" text,
	"source_allowed" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "property_facets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_org_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"property_code" text,
	"value_text" text,
	"value_num" numeric,
	"value_bool" boolean,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"owner_type" "owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"ownership_level" "ownership_level" DEFAULT 'primary',
	"permissions" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text,
	"name" text,
	"description" text,
	"default_channel_kind" text,
	"is_required" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"version" integer,
	"is_active" boolean DEFAULT true,
	"subject" text,
	"body_html" text,
	"body_text" text,
	"data_schema" jsonb,
	"metadata" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid,
	"key" text,
	"name" text,
	"description" text,
	"kind" text,
	"render_engine" text,
	"current_version_id" uuid,
	"visibility" "resource_visibility" DEFAULT 'private',
	"metadata" jsonb,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext",
	"phone" "citext",
	"first_name" text,
	"last_name" text,
	"type" "user_type" NOT NULL,
	"status" text,
	"default_timezone" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid,
	"event_type" text NOT NULL,
	"event_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending',
	"http_status" integer,
	"response_body" text,
	"error_message" text,
	"attempt_count" integer DEFAULT 0,
	"next_retry_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text,
	"status" "webhook_status" DEFAULT 'active',
	"headers" jsonb,
	"retry_policy" jsonb,
	"last_triggered_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0,
	"visibility" "resource_visibility" DEFAULT 'private',
	"metadata" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_auth_user" ON "auth_identities" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_auth_provider_lookup" ON "auth_identities" ("provider_subject","provider_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaign_runs_campaign" ON "campaign_runs" ("campaign_id","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaign_runs_org" ON "campaign_runs" ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaigns_key" ON "campaigns" ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaigns_status" ON "campaigns" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaigns_visibility" ON "campaigns" ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaigns_created_by" ON "campaigns" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_channels_contact" ON "contact_channels" ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_channels_org_kind" ON "contact_channels" ("channel_kind","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_channels_address" ON "contact_channels" ("address","channel_kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_contact_channels_address" ON "contact_channels" ("contact_id","channel_kind","address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_clm_list" ON "contact_list_members" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_clm_contact" ON "contact_list_members" ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_clm_list_contact" ON "contact_list_members" ("contact_id","list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_lists_key" ON "contact_lists" ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_lists_visibility" ON "contact_lists" ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_csm_segment" ON "contact_segment_members" ("segment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_csm_contact" ON "contact_segment_members" ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_segments_key" ON "contact_segments" ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_segments_visibility" ON "contact_segments" ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_subscriptions_contact" ON "contact_subscriptions" ("contact_id","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_subscriptions_topic" ON "contact_subscriptions" ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_subscriptions_channel" ON "contact_subscriptions" ("contact_channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contacts_org" ON "contacts" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contacts_email" ON "contacts" ("email","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contacts_external" ON "contacts" ("external_id","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contacts_org_email" ON "contacts" ("organization_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contacts_org_status" ON "contacts" ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_contacts_org_email" ON "contacts" ("organization_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_props_entity" ON "entity_properties" ("entity_id","entity_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_props_def_entity" ON "entity_properties" ("entity_type","property_def_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_props_def" ON "entity_properties" ("property_def_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_events_org_time" ON "events" ("occurred_at","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_events_contact_time" ON "events" ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_events_name_time" ON "events" ("event_name","occurred_at","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_events_insert_id" ON "events" ("insert_id","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_experiments_campaign" ON "experiments" ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_experiments_key" ON "experiments" ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_experiments_status" ON "experiments" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_experiments_visibility" ON "experiments" ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_experiments_created_by" ON "experiments" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_gm_group" ON "group_memberships" ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_gm_user" ON "group_memberships" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_gm_status" ON "group_memberships" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_groups_org" ON "groups" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_groups_kind" ON "groups" ("kind","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_groups_key" ON "groups" ("key","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_groups_root" ON "groups" ("is_root","kind","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_key_request_hash_unique" ON "idempotency_keys" ("key","request_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journey_runs_journey" ON "journey_runs" ("journey_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journey_runs_contact" ON "journey_runs" ("contact_id","journey_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journey_runs_status" ON "journey_runs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journey_step_runs_journey_run" ON "journey_step_runs" ("journey_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journey_step_runs_step" ON "journey_step_runs" ("journey_id","step_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journey_step_runs_scheduled" ON "journey_step_runs" ("scheduled_for","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journey_step_runs_status" ON "journey_step_runs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journey_step_runs_event_id" ON "journey_step_runs" ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journeys_key" ON "journeys" ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journeys_status" ON "journeys" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journeys_visibility" ON "journeys" ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journeys_created_by" ON "journeys" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_channels_org" ON "message_channels" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_channels_kind" ON "message_channels" ("kind","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_channels_key" ON "message_channels" ("key","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_message_events_message" ON "message_events" ("event_type","message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_message_events_contact" ON "message_events" ("contact_id","event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_message_events_org_time" ON "message_events" ("occurred_at","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_messages_org" ON "messages" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_messages_campaign" ON "messages" ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_messages_contact" ON "messages" ("contact_id","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_messages_provider" ON "messages" ("provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_messages_status" ON "messages" ("send_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_messages_queued_at" ON "messages" ("queued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_messages_campaign_status" ON "messages" ("campaign_id","send_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_messages_contact_status" ON "messages" ("contact_id","send_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ou_org" ON "org_units" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ou_org_code" ON "org_units" ("code","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ou_is_root" ON "org_units" ("is_root","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_org_members_org" ON "organization_members" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_org_members_user" ON "organization_members" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_org_slug" ON "organizations" ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_org_type" ON "organizations" ("org_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_org_visible" ON "organizations" ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_profiles_external_id" ON "profiles" ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_profiles_country" ON "profiles" ("country_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_propdef_scope" ON "property_definitions" ("owner_org_id","owner_scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_propdef_entity" ON "property_definitions" ("code","entity_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_propdef_status" ON "property_definitions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_facets_text" ON "property_facets" ("entity_type","property_code","value_text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_facets_num" ON "property_facets" ("entity_type","property_code","value_num");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_facets_bool" ON "property_facets" ("entity_type","property_code","value_bool");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_facets_tenant" ON "property_facets" ("entity_type","owner_org_id","property_code","value_text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_facets_entity" ON "property_facets" ("entity_id","entity_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_resource_owners_resource" ON "resource_owners" ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_resource_owners_owner" ON "resource_owners" ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_resource_owner" ON "resource_owners" ("resource_type","resource_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_topics_org" ON "subscription_topics" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_topics_key" ON "subscription_topics" ("key","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_template_versions_template" ON "template_versions" ("template_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_templates_channel" ON "templates" ("channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_templates_key" ON "templates" ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_templates_visibility" ON "templates" ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_templates_created_by" ON "templates" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_users_email" ON "users" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_users_phone" ON "users" ("phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhook_deliveries_webhook" ON "webhook_deliveries" ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhook_deliveries_status" ON "webhook_deliveries" ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhook_deliveries_event" ON "webhook_deliveries" ("event_type","event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhooks_status" ON "webhooks" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhooks_visibility" ON "webhooks" ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhooks_created_by" ON "webhooks" ("created_by_user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_runs" ADD CONSTRAINT "campaign_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_runs" ADD CONSTRAINT "campaign_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_runs" ADD CONSTRAINT "campaign_runs_entry_contact_list_id_contact_lists_id_fk" FOREIGN KEY ("entry_contact_list_id") REFERENCES "contact_lists"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_runs" ADD CONSTRAINT "campaign_runs_entry_contact_segment_id_contact_segments_id_fk" FOREIGN KEY ("entry_contact_segment_id") REFERENCES "contact_segments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_runs" ADD CONSTRAINT "campaign_runs_target_segment_id_contact_segments_id_fk" FOREIGN KEY ("target_segment_id") REFERENCES "contact_segments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channel_id_message_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "message_channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_entry_contact_list_id_contact_lists_id_fk" FOREIGN KEY ("entry_contact_list_id") REFERENCES "contact_lists"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_entry_contact_segment_id_contact_segments_id_fk" FOREIGN KEY ("entry_contact_segment_id") REFERENCES "contact_segments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_channel_id_message_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "message_channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "contact_lists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_segment_members" ADD CONSTRAINT "contact_segment_members_segment_id_contact_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "contact_segments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_segment_members" ADD CONSTRAINT "contact_segment_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_subscriptions" ADD CONSTRAINT "contact_subscriptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_subscriptions" ADD CONSTRAINT "contact_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_subscriptions" ADD CONSTRAINT "contact_subscriptions_topic_id_subscription_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "subscription_topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_subscriptions" ADD CONSTRAINT "contact_subscriptions_contact_channel_id_contact_channels_id_fk" FOREIGN KEY ("contact_channel_id") REFERENCES "contact_channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_properties" ADD CONSTRAINT "entity_properties_property_def_id_property_definitions_id_fk" FOREIGN KEY ("property_def_id") REFERENCES "property_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "experiments" ADD CONSTRAINT "experiments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "experiments" ADD CONSTRAINT "experiments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "groups" ADD CONSTRAINT "groups_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_journey_run_id_journey_runs_id_fk" FOREIGN KEY ("journey_run_id") REFERENCES "journey_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_entry_contact_list_id_contact_lists_id_fk" FOREIGN KEY ("entry_contact_list_id") REFERENCES "contact_lists"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_entry_contact_segment_id_contact_segments_id_fk" FOREIGN KEY ("entry_contact_segment_id") REFERENCES "contact_segments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_channels" ADD CONSTRAINT "message_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_events" ADD CONSTRAINT "message_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_events" ADD CONSTRAINT "message_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_events" ADD CONSTRAINT "message_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_run_id_campaign_runs_id_fk" FOREIGN KEY ("campaign_run_id") REFERENCES "campaign_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_journey_run_id_journey_runs_id_fk" FOREIGN KEY ("journey_run_id") REFERENCES "journey_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_channel_id_contact_channels_id_fk" FOREIGN KEY ("contact_channel_id") REFERENCES "contact_channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_message_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "message_channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_topic_id_subscription_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "subscription_topics"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "template_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_units" ADD CONSTRAINT "org_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_topics" ADD CONSTRAINT "subscription_topics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_channel_id_message_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "message_channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_current_version_id_template_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "template_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
