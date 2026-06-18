CREATE TYPE "public"."assignment_status" AS ENUM('ACTIVE', 'INACTIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('OPERATOR', 'MEMBER');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"org_unit_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"changes" jsonb,
	"ip_address" text,
	"user_agent" text,
	"request_id" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"status" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
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
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text,
	"name" text,
	"is_root" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"org_unit_id" uuid,
	"user_id" uuid,
	"role" "org_role" DEFAULT 'MEMBER',
	"status" "assignment_status" DEFAULT 'ACTIVE',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_org_id" text,
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
CREATE TABLE "auth_identities" (
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
CREATE TABLE "profiles" (
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
CREATE TABLE "users" (
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
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_audit_logs_user_id" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_org_id" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_org_unit_id" ON "audit_logs" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_resource" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_timestamp" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_user_time" ON "audit_logs" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_org_time" ON "audit_logs" USING btree ("organization_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_key_request_hash_unique" ON "idempotency_keys" USING btree ("key","request_hash");--> statement-breakpoint
CREATE INDEX "ix_idempotency_keys_expires" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ix_ou_org" ON "org_units" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ix_ou_org_code" ON "org_units" USING btree ("code","organization_id");--> statement-breakpoint
CREATE INDEX "ix_ou_is_root" ON "org_units" USING btree ("is_root","organization_id");--> statement-breakpoint
CREATE INDEX "ix_org_members_org" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ix_org_members_user" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_org_member_user_org" ON "organization_members" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_org_slug" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_workos_org_id" ON "organizations" USING btree ("workos_org_id");--> statement-breakpoint
CREATE INDEX "ix_org_type" ON "organizations" USING btree ("org_type");--> statement-breakpoint
CREATE INDEX "ix_org_visible" ON "organizations" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "ix_auth_user" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_auth_user_provider" ON "auth_identities" USING btree ("user_id","provider_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_auth_provider_subject" ON "auth_identities" USING btree ("provider_type","provider_subject");--> statement-breakpoint
CREATE INDEX "ix_profiles_external_id" ON "profiles" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "ix_profiles_country" ON "profiles" USING btree ("country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ix_users_phone" ON "users" USING btree ("phone");