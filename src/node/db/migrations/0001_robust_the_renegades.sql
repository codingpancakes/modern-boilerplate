DROP TABLE "contact_channels";--> statement-breakpoint
DROP TABLE "contact_list_members";--> statement-breakpoint
DROP TABLE "contact_lists";--> statement-breakpoint
DROP TABLE "contact_segment_members";--> statement-breakpoint
DROP TABLE "contact_segments";--> statement-breakpoint
DROP TABLE "contact_subscriptions";--> statement-breakpoint
DROP TABLE "contacts";--> statement-breakpoint
DROP TABLE "events";--> statement-breakpoint
DROP TABLE "global_unsubscribes";--> statement-breakpoint
DROP TABLE "campaign_runs";--> statement-breakpoint
DROP TABLE "campaigns";--> statement-breakpoint
DROP TABLE "journey_runs";--> statement-breakpoint
DROP TABLE "journey_step_runs";--> statement-breakpoint
DROP TABLE "journeys";--> statement-breakpoint
DROP TABLE "experiments";--> statement-breakpoint
DROP TABLE "message_channels";--> statement-breakpoint
DROP TABLE "message_events";--> statement-breakpoint
DROP TABLE "messages";--> statement-breakpoint
DROP TABLE "subscription_topics";--> statement-breakpoint
DROP TABLE "template_versions";--> statement-breakpoint
DROP TABLE "templates";--> statement-breakpoint
DROP TABLE "webhook_deliveries";--> statement-breakpoint
DROP TABLE "webhooks";--> statement-breakpoint
DROP TABLE "entity_properties";--> statement-breakpoint
DROP TABLE "group_memberships";--> statement-breakpoint
DROP TABLE "groups";--> statement-breakpoint
DROP TABLE "property_definitions";--> statement-breakpoint
DROP TABLE "property_facets";--> statement-breakpoint
DROP TABLE "resource_owners";--> statement-breakpoint
ALTER TABLE "organization_members" DROP CONSTRAINT "organization_members_org_unit_id_org_units_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "ix_org_slug";--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "org_unit_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_logs_org_time" ON "audit_logs" ("organization_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_idempotency_keys_expires" ON "idempotency_keys" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_auth_user_provider" ON "auth_identities" ("user_id","provider_type");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
