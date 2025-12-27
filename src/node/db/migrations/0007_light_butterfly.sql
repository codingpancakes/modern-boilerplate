CREATE TABLE IF NOT EXISTS "global_unsubscribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" "citext",
	"phone" "citext",
	"channel_kind" text NOT NULL,
	"unsubscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"source" text,
	"topic_id" uuid,
	"user_agent" text,
	"ip_address" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_global_unsub_email" ON "global_unsubscribes" ("organization_id","email","channel_kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_global_unsub_phone" ON "global_unsubscribes" ("organization_id","phone","channel_kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_global_unsub_org" ON "global_unsubscribes" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_global_unsub_created" ON "global_unsubscribes" ("unsubscribed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_global_unsub_source" ON "global_unsubscribes" ("organization_id","source");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "global_unsubscribes" ADD CONSTRAINT "global_unsubscribes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "global_unsubscribes" ADD CONSTRAINT "global_unsubscribes_topic_id_subscription_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "subscription_topics"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
