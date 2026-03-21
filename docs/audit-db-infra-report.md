# Deep Audit Report: Database Schema, Infrastructure, Scripts & Local Dev

**Date:** 2026-03-21  
**Scope:** `src/node/db/`, `infrastructure/`, `scripts/`, `local-dev/server.ts`, `docker-compose.yml`

---

## Table of Contents
1. [Database Schema Issues](#1-database-schema-issues)
2. [Infrastructure (CDK) Issues](#2-infrastructure-cdk-issues)
3. [Scripts Issues](#3-scripts-issues)
4. [Local Dev Issues](#4-local-dev-issues)
5. [Summary Matrix](#5-summary-matrix)

---

## 1. Database Schema Issues

### 1.1 — Missing NOT NULL Constraints on Critical Fields

| # | File | Field(s) | Impact | Severity |
|---|------|----------|--------|----------|
| 1 | `schema/users.ts` | `email` (citext) | Users can be created with no email. The `ux_users_email` unique index doesn't prevent multiple NULLs (Postgres unique allows multiple NULLs). Downstream code almost certainly assumes `email` is present for login, notifications, and audit logs. | **Data Integrity** |
| 2 | `schema/users.ts` | `status` (text) | Status is a free-form text field with no NOT NULL and no default. Code that filters by status will miss rows with NULL. Should at minimum have `.notNull().default("ACTIVE")`. | **Data Integrity** |
| 3 | `schema/organizations.ts` | `name`, `slug`, `status` | Organization records can exist with no name, no slug, and no status. `slug` has a unique index but multiple NULL slugs are allowed. | **Data Integrity** |
| 4 | `schema/contacts.ts` | `email`, `phone` — both nullable | A contact can be created with *no* email and *no* phone, making them unreachable. There's no application-level CHECK constraint ensuring at least one is present. The `ux_contacts_org_email` unique index won't prevent duplicate NULL-email contacts. | **Data Integrity** |
| 5 | `schema/contacts.ts` | `status` | Default is `"ACTIVE"` but no `.notNull()` — can be explicitly set to NULL. | **Code Quality** |
| 6 | `schema/messaging.ts` | `messages.channelKind` | Text field, nullable. Should use the `channelType` enum and be NOT NULL since every message must be sent via some channel. | **Data Integrity** |
| 7 | `schema/contacts.ts` | `contactChannels.channelKind`, `contactChannels.status` | Free-form text fields for channel kind and status. Should use enums (`channelType`, `contactStatus`) and be NOT NULL. | **Data Integrity** |
| 8 | `schema/contacts.ts` | `contactListMembers.listId`, `contactListMembers.contactId` | Nullable foreign keys — member rows can exist with no list or no contact. Both should be `.notNull()`. | **Bug** |
| 9 | `schema/contacts.ts` | `contactSegmentMembers.segmentId`, `contactSegmentMembers.contactId` | Same issue as list members — nullable FK references on a join table. | **Bug** |
| 10 | `schema/contacts.ts` | `contactChannels.contactId` | A contact channel row can have a NULL `contactId`, orphaning the channel record. Should be `.notNull()`. | **Bug** |
| 11 | `schema/contacts.ts` | `contactSubscriptions.contactId` | Same pattern — subscription can exist without a contact. | **Bug** |
| 12 | `schema/organizations.ts` | `groupMemberships.groupId`, `groupMemberships.userId` | Join table FKs are nullable. | **Bug** |
| 13 | `schema/organizations.ts` | `organizationMembers.userId` | An org membership record can exist with no user. | **Bug** |
| 14 | `schema/messaging.ts` | `webhookDeliveries.webhookId` | Delivery can exist with no parent webhook — orphaned record. | **Bug** |
| 15 | `schema/messaging.ts` | `templateVersions.templateId` | Version can exist without a parent template. | **Bug** |
| 16 | `schema/journeys.ts` | `journeyRuns.journeyId`, `journeyRuns.contactId` | A journey run can have no journey and no contact. | **Bug** |
| 17 | `schema/journeys.ts` | `journeyStepRuns.journeyRunId` | A step run can exist with no parent journey run. | **Bug** |
| 18 | `schema/journeys.ts` | `campaignRuns.campaignId` | A campaign run can exist with no parent campaign. | **Bug** |

### 1.2 — Missing CHECK Constraints

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `schema/contacts.ts` | `globalUnsubscribes` — comment says "at least one of email/phone must be provided" but there's no CHECK constraint. Both can be NULL simultaneously. | **Data Integrity** |
| 2 | `schema/journeys.ts` | `journeyRuns.journeyVersion` — integer with no CHECK. Can be 0 or negative. | **Code Quality** |
| 3 | `schema/messaging.ts` | `webhookDeliveries.attemptCount`, `webhooks.failureCount` — no CHECK `>= 0`. | **Code Quality** |
| 4 | `schema/journeys.ts` | `campaigns` / `journeys` — `version` can be zero even though `.default(1)`. | **Code Quality** |
| 5 | `schema/organizations.ts` | `groups.maxSize` — no CHECK `> 0`. Zero or negative maxSize is nonsensical. | **Code Quality** |

### 1.3 — Text Fields That Should Use Enums

| # | File | Field | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `schema/users.ts` | `users.status` | Should use an enum (e.g., `ACTIVE`, `SUSPENDED`, `DELETED`). Free text allows inconsistent values. | **Data Integrity** |
| 2 | `schema/organizations.ts` | `organizations.status`, `organizations.visibility`, `organizations.orgType` | All free text. `visibility` already has a `resourceVisibility` enum available. `status` and `orgType` should also be enums. | **Data Integrity** |
| 3 | `schema/contacts.ts` | `contactChannels.channelKind`, `contactChannels.status` | `channelType` and `contactStatus` enums exist but aren't used here. | **Data Integrity** |
| 4 | `schema/messaging.ts` | `messages.channelKind` | `channelType` enum exists. | **Data Integrity** |
| 5 | `schema/contacts.ts` | `contactListMembers.status`, `contactSegmentMembers.status` | Free text where bounded values are expected. | **Code Quality** |
| 6 | `schema/organizations.ts` | `groupMemberships.role`, `groupMemberships.status` | Free text. | **Code Quality** |
| 7 | `schema/organizations.ts` | `entityProperties.visibility`, `entityProperties.source` | Free text where enums would be safer. | **Code Quality** |
| 8 | `schema/messaging.ts` | `webhookDeliveries.status` | Uses free text `"pending"` default (lowercase) while all enum values in the codebase use UPPERCASE. Inconsistency. | **Code Quality** |

### 1.4 — Missing Indexes for Common Query Patterns

| # | File | Query Pattern | Impact | Severity |
|---|------|---------------|--------|----------|
| 1 | `schema/contacts.ts` | `contacts.phone` + `organizationId` lookup | There's an index on email+org but no composite index for phone+org lookups. If contacts are looked up by phone (SMS campaigns), this will be a sequential scan. | **Performance** |
| 2 | `schema/organizations.ts` | `organizationMembers` — no unique index on `(organizationId, userId)` | A user can be added to the same org multiple times, creating duplicate memberships. | **Data Integrity** |
| 3 | `schema/organizations.ts` | `groupMemberships` — no unique index on `(groupId, userId)` | Same — duplicate memberships possible. | **Data Integrity** |
| 4 | `schema/contacts.ts` | `contactSubscriptions` — no unique index on `(contactId, topicId, channelKind)` | A contact can have duplicate subscription records for the same topic+channel. | **Data Integrity** |
| 5 | `schema/journeys.ts` | `journeyRuns` — no index on `(journeyId, contactId, status)` | Checking if a contact is already in a journey (re-entry prevention) requires scanning all runs. | **Performance** |
| 6 | `schema/journeys.ts` | `journeyStepRuns` — no index on `(journeyRunId, stepKey)` | Looking up a specific step in a run requires scanning all step runs for that run. | **Performance** |
| 7 | `schema/messaging.ts` | `messages` — no index on `(journeyId, journeyRunId)` | Retrieving messages for a journey run has no supporting index. | **Performance** |
| 8 | `schema/audit.ts` | `auditLogs` — no composite index on `(organizationId, timestamp)` | The most common audit query (org events over time range) has no supporting composite index. | **Performance** |
| 9 | `schema/contacts.ts` | `contacts.deletedAt` — no index for soft-delete filtering | Every query filtering `WHERE deleted_at IS NULL` (active contacts) must scan the entire table. A partial index `WHERE deleted_at IS NULL` would be very effective. | **Performance** |
| 10 | `schema/organizations.ts` | `idempotencyKeys.expiresAt` — no index for cleanup | Expired keys cleanup requires a sequential scan. | **Performance** |

### 1.5 — Foreign Key and Referential Integrity Issues

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `schema/users.ts` | `authIdentities.userId` — nullable and no `notNull()` | An auth identity can exist with no user — orphaned SSO mapping. | **Bug** |
| 2 | `schema/users.ts` | `authIdentities` — no unique index on `(providerType, providerSubject)` | The same external SSO identity can be linked to multiple users, causing authentication ambiguity. | **Data Integrity** |
| 3 | `schema/organizations.ts` | `orgUnits.parentId` self-reference — `onDelete: "set null"` | Setting parent to NULL can break hierarchy traversal. No cycle prevention. | **Logic Error** |
| 4 | `schema/organizations.ts` | `groups.parentId` self-reference — `onDelete: "set null"` | Same issue as orgUnits. | **Logic Error** |
| 5 | `schema/organizations.ts` | `propertyDefinitions.ownerOrgId` — no FK reference to `organizations.id` | This is a soft reference. Deleted organizations would leave orphaned property definitions. | **Data Integrity** |
| 6 | `schema/organizations.ts` | `entityProperties.entityId` — no FK reference (polymorphic) | Expected for polymorphic associations, but there's no application-level cleanup logic visible. | **Operational** |
| 7 | `schema/organizations.ts` | `propertyFacets.ownerOrgId`, `propertyFacets.entityId` — no FK references | Same soft-reference issue. | **Data Integrity** |

### 1.6 — Migration Journal Anomaly

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `migrations/meta/_journal.json` | Two migrations with prefix `0002` exist: `0002_thick_thor_girl` (idx:1) and `0002_curvy_the_watchers` (idx:2). Both have `"idx"` values 1 and 2 but the file naming convention suggests they were generated from the same sequence number. | **Operational** |
| 2 | `migrations/meta/_journal.json` | There is no `0001_*` migration. Journal jumps from idx 0 (tag `0000_*`) to idx 1 (tag `0002_*`). This suggests a migration was deleted or renumbered. | **Operational** |

### 1.7 — `updatedAt` Timestamps Lack Auto-Update Trigger

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | Multiple schema files | All `updatedAt` columns have `.defaultNow()` which only sets the default on INSERT. There's no database-level trigger or Drizzle hook to auto-update `updatedAt` on UPDATE. If application code forgets to set it, `updatedAt` will show creation time, not last modification time. | **Data Integrity** |

### 1.8 — Soft-Delete Inconsistency

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | Multiple files | Some tables use `deletedAt` for soft-delete (contacts, contactLists, journeys, campaigns, templates, etc.) while others have no soft-delete (users, profiles, auditLogs, groupMemberships). `messages` has `softDeletedAt` (different column name). Inconsistent naming and approach. | **Code Quality** |

---

## 2. Infrastructure (CDK) Issues

### 2.1 — Lambda Timeout and Memory Sizing

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/api-stack.ts` | **WorkOS Authorizer has 30s timeout** — Authorizers should be fast (cold start + JWKS fetch). If JWKS endpoint is slow, all authenticated requests will time out. 30s is too generous; a stuck authorizer will hold all clients waiting. Consider 10s max. | **Performance** |
| 2 | `lib/api-stack.ts` | **GraphQL handler at 512MB/30s** — GraphQL resolvers can fan out to many DB queries. 30s may not be enough for complex queries and 512MB may be tight with Apollo Server cold start. Consider 1024MB / 60s. | **Operational** |
| 3 | `lib/routes/public-routes.ts` | **OPTIONS handler at 256MB/3s** — CORS preflight is a simple response. 256MB is wasteful for returning static headers. 128MB/1s would suffice and save cost. | **Performance** |
| 4 | `lib/routes/route-builder.ts` | **Default memorySize is 512MB for all handlers** — This is applied uniformly. Simple handlers (health, list-images) don't need 512MB. | **Performance** |

### 2.2 — CORS Configuration: `allowOrigins: ["*"]`

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/api-stack.ts` | API Gateway `corsPreflight` uses `allowOrigins: ["*"]`. While the comment explains this is for gateway-level errors (401/403), it means ANY origin can trigger preflight-visible responses from the gateway itself. Lambda-level CORS does additional checking, but the gateway-level wildcard weakens the security posture. | **Code Quality** |

### 2.3 — WAF SizeRestrictions_BODY Exclusion

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/api-stack.ts` | `SizeRestrictions_BODY` is excluded from the AWS Common Rule Set to support GraphQL/image uploads. This disables body size checking for ALL routes, not just upload routes. An attacker could send very large payloads to any endpoint (webhooks, health checks, etc.). Consider using scope-down statements or WAF rules that exclude only specific paths. | **Code Quality** |

### 2.4 — Public Assets Bucket: Public Read Access

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/public-assets-stack.ts` | `publicReadAccess: true` with `blockPublicAccess` all set to `false`. The CloudFront distribution is the intended access point. Direct S3 access bypasses CloudFront caching and WAF protections. Modern best practice is to use OAI/OAC and block all public S3 access. | **Code Quality** |

### 2.5 — S3 Bucket Deployment Creates Excessive Resources

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/public-assets-stack.ts` | `BucketDeployment` is called 10 times (once per folder) to create `.gitkeep` placeholder files. Each `BucketDeployment` creates a Lambda function and a Custom Resource. That's 10 extra Lambda functions just for empty placeholders. Use a single deployment with multiple sources. | **Performance** |

### 2.6 — Hardcoded Process Environment in CDK Constructs

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/api-stack.ts` | `WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID \|\| ""` — This is set at CDK synthesis time and baked into the Lambda env vars. If the env var is missing at synth time, it becomes an empty string in the deployed Lambda, causing silent authentication failures. | **Operational** |
| 2 | `lib/api-stack.ts` | `IMAGES_BUCKET`, `IMAGES_CDN_URL`, `IMAGES_BUCKET_PREFIX`, `CORS_*` — Same issue. Silent empty string defaults if env vars are missing. | **Operational** |

### 2.7 — Missing Stack Dependencies

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `infrastructure/bin/app.ts` | `databaseStack.addDependency(securityStack)` — good. But `apiStack` does NOT depend on `databaseStack`. If DB migrations fail, the API stack still deploys with potentially missing schema. | **Operational** |
| 2 | `infrastructure/bin/app.ts` | CloudTrail stack does not depend on any other stack, but the S3 bucket it creates uses the same PROJECT_NAME. No issue, just noting independence. | **Code Quality** |

### 2.8 — Missing CloudFront Certificate Region Constraint

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/media-stack.ts` | Comment says "ACM certificate for CloudFront (must be in us-east-1)" but the certificate is created in the stack's region (determined by `env.region`). If the stack is deployed in `us-west-2`, the certificate will be created there and CloudFront association will fail. | **Bug** |
| 2 | `lib/public-assets-stack.ts` | Same issue — certificate is created in the stack's region, not us-east-1. | **Bug** |

### 2.9 — Unused Code in Media Stack

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/media-stack.ts` | `getImageResizerCode()` is a private method returning Lambda@Edge code as a string. It is never called. Dead code. | **Code Quality** |

### 2.10 — LogRetention Aspect Race Condition

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/utils/log-retention-aspect.ts` | `applyLogRetention()` is called in the constructor of both `ApiStack` and `DatabaseStack` BEFORE CDK has finished visiting all constructs. The `visit()` method collects Lambda functions during synthesis, but `applyLogRetention()` runs immediately. It may miss functions added after the call. | **Bug** |

### 2.11 — Pipeline Stack IAM Role Syntax Error

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/pipeline-stack.ts` | The STS AssumeRole resource pattern uses `` `arn:aws:iam::${this.account}:role/cdk-*-deploy-role-...` `` — note the double colon `iam::` is correct for IAM ARN format, but there's a subtle issue: `this.account` may be undefined at synth time if `CDK_DEFAULT_ACCOUNT` is not set. The `env` object uses `process.env.CDK_DEFAULT_ACCOUNT` which could be undefined. | **Operational** |

### 2.12 — Missing Alarm for Migration Runner

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/database-stack.ts` / `lib/monitoring-stack.ts` | The migration runner Lambda has a 5-minute timeout but there's no alarm or notification if it fails. Migration failures are silent — the Lambda just exits with an error. | **Operational** |

### 2.13 — Python Handler No Architecture Consistency

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/api-stack.ts` | Python test and profile handlers use `lambda.Architecture.ARM_64` but the WorkOS authorizer Lambda (NodejsFunction) doesn't specify architecture, defaulting to `X86_64`. Mixed architectures increase cold start variability and complicate debugging. | **Code Quality** |

### 2.14 — CloudTrail Bucket Has No Versioning

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `lib/cloudtrail-stack.ts` | `versioned: false` — CloudTrail logs are immutable audit records. S3 versioning should be enabled to prevent accidental deletion or tampering. This is typically required for SOC 2 compliance. | **Data Integrity** |

---

## 3. Scripts Issues

### 3.1 — `drop-all-tables.ts`: Stale Table List

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `scripts/drop-all-tables.ts` | Hardcoded DROP TABLE statements reference tables that no longer exist in the schema (`sessions`, `session_participants`, `session_external_events`, `session_dialin`, `session_assets`, `appointments`, `calendars`, `external_calendars`, `external_calendar_accounts`, `telephony_numbers`, `rtc_webhook_events`). Meanwhile, it's **missing** many current tables: `contacts`, `contact_lists`, `contact_list_members`, `contact_segments`, `contact_segment_members`, `contact_channels`, `contact_subscriptions`, `events`, `global_unsubscribes`, `journeys`, `campaigns`, `campaign_runs`, `journey_runs`, `journey_step_runs`, `message_channels`, `subscription_topics`, `templates`, `template_versions`, `messages`, `message_events`, `experiments`, `webhooks`, `webhook_deliveries`, `organization_members`, `resource_owners`, `audit_logs`. | **Bug** |
| 2 | `scripts/drop-all-tables.ts` | Enum DROP statements are also stale — missing all the new enums added in `enums.ts` (`message_status`, `campaign_status`, `journey_status`, etc.). | **Bug** |

### 3.2 — `sync-secrets.ts`: SSM Command Injection

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `scripts/sync-secrets.ts` | SSM parameters are set via string interpolation: `--value "${envVars[mapping.key]}"`. If an env var value contains double quotes, backticks, or shell metacharacters (e.g., `$(...)`), this could lead to command injection or broken commands. The `secretsmanager` calls correctly use `file:///dev/stdin` piping, but SSM calls do not. | **Bug** |

### 3.3 — `migrate.ts`: Incorrect Secret Format for Lambda

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `scripts/migrate.ts` | When running as a Lambda (via `DB_SECRET_ARN`), the code expects the secret to contain `username`, `password`, `host`, `port`, `dbname` fields and constructs a connection string. But `sync-secrets.ts` stores the database secret as `{ "url": "..." }` — a single `url` field. The Lambda migration runner will fail because `secret.username` is undefined. | **Bug** |

### 3.4 — `drizzle-migrate.js`: References Non-Existent Schema Path

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `scripts/drizzle-migrate.js` | `SCHEMA_PATH = 'src/node/db/schema.ts'` — this file doesn't exist. The schema is at `src/node/db/schema/index.ts`. The backup/restore/compatibility flow operates on a non-existent file. The script will fail silently (backup nothing, modify nothing). | **Bug** |

### 3.5 — `deploy.ts`: Uses `npm` Instead of `pnpm`

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `scripts/deploy.ts` | `execSync('npm run build', ...)` and `execSync('npm run migrate', ...)` — but the project uses `pnpm` (evidenced by `pnpm-lock.yaml`). Using `npm` may resolve different dependency versions or fail if `node_modules` was installed by `pnpm`. | **Bug** |

### 3.6 — `reset-db.ts`: No Environment Guard

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `scripts/reset-db.ts` | This script drops the entire `public` schema. It reads from `.env.local` but doesn't check `NODE_ENV` or `STAGE`. If `.env.local` accidentally points to a production DATABASE_URL, running this script destroys the production database with no confirmation prompt. | **Operational** |

### 3.7 — `destroy-all.sh` and `force-delete-stacks.sh`: Different Search Patterns

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `scripts/destroy-all.sh` vs `scripts/force-delete-stacks.sh` | `destroy-all.sh` searches for resources matching `${PROJECT_NAME}-${STAGE}` (stack prefix), while `force-delete-stacks.sh` searches for just `${PROJECT_NAME}`. The `force-delete-stacks.sh` approach is more aggressive and could delete resources from ALL stages (staging AND production) if they share the same project name. | **Operational** |

---

## 4. Local Dev Issues

### 4.1 — `local-dev/server.ts`: Duplicated GraphQL Auth Logic

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `local-dev/server.ts` | The GraphQL POST and GET handlers contain identical duplicated code (~30 lines each) for looking up internal user IDs from provider subjects. This should be extracted into a middleware or helper function. | **Code Quality** |

### 4.2 — `local-dev/server.ts`: Incorrect Health Route Handler Path

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `local-dev/server.ts` | Health route is mapped to `'../src/node/handlers/health'` but the actual import is from `'../src/node/handlers/utils/health'`. The `handlerMap` has the wrong key, so `loadHandler()` will never match and the health endpoint will return 500. | **Bug** |

### 4.3 — `docker-compose.yml`: Missing `citext` Extension

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `docker-compose.yml` | The local Postgres container is vanilla `postgres:15-alpine`. The schema uses the `citext` extension (case-insensitive text), but there's no init script to create the extension. If a developer runs the local DB, all `citext` columns will fail. `reset-db.ts` creates the extension, but `docker-compose` doesn't. | **Operational** |

### 4.4 — `docker-compose.yml`: Local DB Likely Unused

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `docker-compose.yml` | The local dev server (`local-dev/server.ts`) loads env from `.env.local` which likely points to a Neon Postgres instance (given `@neondatabase/serverless` is used everywhere). The docker-compose Postgres is configured with `postgres/postgres` credentials but nothing in the codebase references these credentials. It may be entirely unused dead infrastructure. | **Code Quality** |

### 4.5 — `local-dev/server.ts`: Token Logged to Console

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| 1 | `local-dev/server.ts` | Line `console.log('🔑 INTERCEPTED TOKEN:', token)` logs the full JWT access token. Also logs full JWT payload. While this is local-dev only, if logs are captured or the local server is exposed (ngrok, etc.), this leaks auth tokens. | **Code Quality** |

---

## 5. Summary Matrix

| Severity | Count | Key Highlights |
|----------|-------|----------------|
| **Bug** | 18 | Nullable FKs on join tables, stale drop-all-tables script, migrate.ts secret format mismatch, broken local health route, ACM certificate region |
| **Data Integrity** | 15 | Missing NOT NULL on critical fields, missing unique constraints on membership tables, no check constraint on globalUnsubscribes, text fields that should be enums |
| **Performance** | 7 | Missing indexes for phone lookups, soft-delete filtering, journey run queries; oversized Lambda memory for simple handlers |
| **Operational** | 8 | No migration failure alarm, no env guard on reset-db, force-delete-stacks too aggressive, silent empty env vars |
| **Code Quality** | 13 | Duplicated GraphQL logic, unused image resizer code, inconsistent soft-delete naming, CORS wildcard, console token logging |
| **Logic Error** | 2 | Self-referencing FKs with set null on delete (hierarchy breakage) |
| **Total** | **63** | |

### Top Priority Fixes (recommended order)

1. **Add `.notNull()` to all join-table foreign keys** (#8-18 in §1.1) — prevents orphaned records immediately
2. **Fix `migrate.ts` secret format** (§3.3) — Lambda migration runner is broken
3. **Fix `drop-all-tables.ts`** (§3.1) — current script is stale; use `reset-db.ts` or update table list
4. **Add unique constraints** on membership tables (§1.4 #2-4) — prevents duplicate memberships
5. **Fix CloudFront ACM certificate region** (§2.8) — will cause deployment failures in non-us-east-1 regions
6. **Fix local health route path** (§4.2) — local dev health endpoint returns 500
7. **Add `authIdentities` unique constraint** on `(providerType, providerSubject)` (§1.5 #2) — prevents SSO identity collision
8. **Fix `deploy.ts` to use `pnpm`** (§3.5) — deployment may use wrong dependencies
9. **Guard `reset-db.ts` against production** (§3.6) — prevent accidental data loss
10. **Fix `sync-secrets.ts` SSM command injection** (§3.2) — shell metacharacter injection risk
