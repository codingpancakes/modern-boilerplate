ALTER TABLE "experiments" DROP CONSTRAINT "experiments_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "journey_runs" DROP CONSTRAINT "journey_runs_contact_id_contacts_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "experiments" ADD CONSTRAINT "experiments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
