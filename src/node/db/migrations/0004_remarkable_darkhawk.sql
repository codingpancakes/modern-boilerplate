UPDATE "users"
SET "status" = upper("status")
WHERE "status" IS NOT NULL
	AND "status" <> upper("status")
	AND upper("status") IN ('ACTIVE', 'PENDING', 'INACTIVE', 'DELETED');--> statement-breakpoint
UPDATE "organizations"
SET "status" = upper("status")
WHERE "status" IS NOT NULL
	AND "status" <> upper("status")
	AND upper("status") IN ('ACTIVE', 'PENDING', 'INACTIVE', 'DELETED');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_status" CHECK (
	"status" IS NULL OR "status" IN ('ACTIVE', 'PENDING', 'INACTIVE', 'DELETED')
) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" VALIDATE CONSTRAINT "ck_users_status";--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "ck_organizations_status" CHECK (
	"status" IS NULL OR "status" IN ('ACTIVE', 'PENDING', 'INACTIVE', 'DELETED')
) NOT VALID;--> statement-breakpoint
ALTER TABLE "organizations" VALIDATE CONSTRAINT "ck_organizations_status";--> statement-breakpoint
DROP INDEX "idempotency_keys_key_request_hash_unique";
