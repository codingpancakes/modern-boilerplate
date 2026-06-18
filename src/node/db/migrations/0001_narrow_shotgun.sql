DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "ck_audit_logs_action" CHECK ("action" IN (
  'LOGIN','LOGOUT','LOGIN_FAILED','PASSWORD_RESET','MFA_ENABLED','MFA_DISABLED',
  'CREATE','READ','UPDATE','DELETE',
  'BULK_CREATE','BULK_UPDATE','BULK_DELETE',
  'PERMISSION_GRANTED','PERMISSION_REVOKED','ACCESS_DENIED',
  'EXPORT','IMPORT',
  'WEBHOOK_RECEIVED','WEBHOOK_FAILED','API_KEY_CREATED','API_KEY_REVOKED'
 ));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "ck_audit_logs_resource_type" CHECK ("resource_type" IN (
  'USER','PROFILE','ORGANIZATION','ORGANIZATION_MEMBER','MEDIA','WEBHOOK','API_KEY','SETTINGS'
 ));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "ck_audit_logs_status" CHECK ("status" IS NULL OR "status" IN (
  'SUCCESS','FAILURE','PARTIAL'
 ));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_logs_guard"() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'audit_logs are immutable: UPDATE is not permitted';
 ELSIF TG_OP = 'DELETE' THEN
  IF OLD."timestamp" > now() - interval '7 years' THEN
   RAISE EXCEPTION 'audit_logs are append-only: cannot delete entries within the 7-year retention window';
  END IF;
  RETURN OLD;
 END IF;
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_logs_no_update" ON "audit_logs";--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_update" BEFORE UPDATE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "audit_logs_guard"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_logs_no_delete" ON "audit_logs";--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_delete" BEFORE DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "audit_logs_guard"();
