DROP INDEX IF EXISTS "ix_auth_provider_lookup";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_auth_provider_subject" ON "auth_identities" ("provider_type","provider_subject");