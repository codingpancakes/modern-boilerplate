DROP INDEX IF EXISTS "ix_channels_kind";--> statement-breakpoint
ALTER TABLE "contact_lists" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_segments" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_segments" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_channels_org_and_unit" ON "contact_channels" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_lists_org" ON "contact_lists" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_lists_org_unit" ON "contact_lists" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_lists_org_and_unit" ON "contact_lists" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_segments_org" ON "contact_segments" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_segments_org_unit" ON "contact_segments" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_segments_org_and_unit" ON "contact_segments" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contacts_org_and_unit" ON "contacts" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_events_org_and_unit" ON "events" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaign_runs_org_and_unit" ON "campaign_runs" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaigns_org" ON "campaigns" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaigns_org_unit" ON "campaigns" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaigns_org_and_unit" ON "campaigns" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journeys_org" ON "journeys" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journeys_org_unit" ON "journeys" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_journeys_org_and_unit" ON "journeys" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_experiments_org" ON "experiments" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_experiments_org_unit" ON "experiments" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_experiments_org_and_unit" ON "experiments" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_channels_org_unit" ON "message_channels" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_channels_org_and_unit" ON "message_channels" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_channels_kind_org" ON "message_channels" ("kind","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_channels_kind_org_unit" ON "message_channels" ("kind","organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_topics_org_unit" ON "subscription_topics" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_topics_org_and_unit" ON "subscription_topics" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_templates_org" ON "templates" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_templates_org_unit" ON "templates" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_templates_org_and_unit" ON "templates" ("organization_id","org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhooks_org" ON "webhooks" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhooks_org_unit" ON "webhooks" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_webhooks_org_and_unit" ON "webhooks" ("organization_id","org_unit_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_segments" ADD CONSTRAINT "contact_segments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_segments" ADD CONSTRAINT "contact_segments_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "experiments" ADD CONSTRAINT "experiments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "experiments" ADD CONSTRAINT "experiments_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
