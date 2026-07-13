-- Backfill any legacy NULLs before enforcing NOT NULL, so this migration is
-- safe against a database that predates the defaultNow() timestamps.
UPDATE "organization_members" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
UPDATE "organization_members" SET "updated_at" = COALESCE("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "updated_at" SET NOT NULL;
