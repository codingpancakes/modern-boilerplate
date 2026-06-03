DROP TABLE IF EXISTS "contact_channels" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "contact_list_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "contact_lists" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "contact_segment_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "contact_segments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "contact_subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "contacts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "global_unsubscribes" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "campaign_runs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "campaigns" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "journey_runs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "journey_step_runs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "journeys" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "experiments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "message_channels" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "message_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "messages" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_topics" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "template_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "templates" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "webhook_deliveries" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "webhooks" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "entity_properties" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "group_memberships" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "groups" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "property_definitions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "property_facets" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "resource_owners" CASCADE;--> statement-breakpoint
ALTER TABLE "organization_members" DROP CONSTRAINT IF EXISTS "organization_members_org_unit_id_org_units_id_fk";
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
