ALTER TABLE "groups" DROP CONSTRAINT "groups_org_unit_id_org_units_id_fk";
--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "org_unit_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "org_units" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_segments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_channels" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_topics" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_contacts_org_external" ON "contacts" ("organization_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_campaigns_org_key" ON "campaigns" ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_journeys_org_key" ON "journeys" ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_experiments_key_org" ON "experiments" ("key","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_channels_key_org" ON "message_channels" ("key","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_topics_key_org" ON "subscription_topics" ("key","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_templates_org_key" ON "templates" ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_org_slug" ON "organizations" ("slug");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "groups" ADD CONSTRAINT "groups_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
