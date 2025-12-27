ALTER TABLE "contact_channels" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_subscriptions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_runs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journey_runs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journey_step_runs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_channels" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_events" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_topics" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "org_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_subscriptions" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_runs" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "journey_runs" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "journey_step_runs" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "message_channels" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "message_events" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_topics" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "org_unit_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_logs_org_unit_id" ON "audit_logs" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contact_channels_org_unit" ON "contact_channels" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contacts_org_unit" ON "contacts" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_events_org_unit" ON "events" ("org_unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_campaign_runs_org_unit" ON "campaign_runs" ("org_unit_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_subscriptions" ADD CONSTRAINT "contact_subscriptions_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_runs" ADD CONSTRAINT "campaign_runs_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_channels" ADD CONSTRAINT "message_channels_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_events" ADD CONSTRAINT "message_events_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_topics" ADD CONSTRAINT "subscription_topics_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
