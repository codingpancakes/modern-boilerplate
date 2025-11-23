DO $$ BEGIN
 CREATE TYPE "assignment_status" AS ENUM('active', 'inactive', 'ended');
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
 CREATE TYPE "user_type" AS ENUM('operator', 'professional', 'member');
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_request_hash_unique" UNIQUE("key","request_hash")
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
CREATE INDEX IF NOT EXISTS "ix_auth_user" ON "auth_identities" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_auth_provider_lookup" ON "auth_identities" ("provider_subject","provider_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_props_entity" ON "entity_properties" ("entity_id","entity_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_props_def_entity" ON "entity_properties" ("entity_type","property_def_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_props_def" ON "entity_properties" ("property_def_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_gm_group" ON "group_memberships" ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_gm_user" ON "group_memberships" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_gm_status" ON "group_memberships" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_groups_org" ON "groups" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_groups_kind" ON "groups" ("kind","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_groups_key" ON "groups" ("key","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_groups_root" ON "groups" ("is_root","kind","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ou_org" ON "org_units" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ou_org_code" ON "org_units" ("code","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ou_is_root" ON "org_units" ("is_root","organization_id");--> statement-breakpoint
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
CREATE INDEX IF NOT EXISTS "ix_users_email" ON "users" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_users_phone" ON "users" ("phone");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
