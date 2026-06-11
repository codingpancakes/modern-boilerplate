# Deploying a New Project from This Boilerplate

A complete guide to setting up and deploying a new system using this CDK backend — from zero to running in AWS.

---

## Table of Contents

1. [What You'll Need](#1-what-youll-need)
2. [AWS Account Setup](#2-aws-account-setup)
3. [Project Configuration](#3-project-configuration)
4. [External Services](#4-external-services)
5. [Environment Files](#5-environment-files)
6. [First Deploy Sequence](#6-first-deploy-sequence)
7. [CI/CD Pipeline](#7-cicd-pipeline)
8. [Verify the Deployment](#8-verify-the-deployment)
9. [Customize Schema and Handlers](#9-customize-schema-and-handlers)
10. [Cleanup Checklist](#10-cleanup-checklist)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What You'll Need

**Accounts to create first:**
- [WorkOS](https://workos.com) — authentication (JWT/SSO)
- [Neon](https://neon.tech) — serverless PostgreSQL
- [Sentry](https://sentry.io) — error tracking (optional but recommended)

**Tools:**
- Node.js 24+ and pnpm
- AWS CLI configured (`aws configure`)
- AWS CDK CLI: `npm install -g aws-cdk`

**AWS prerequisites (must exist before deploy):**
- A Route53 hosted zone for your domain
- Your domain's nameservers pointing to Route53

---

## 2. AWS Account Setup

### IAM permissions

The user or role running CDK needs broad permissions. For simplicity, `AdministratorAccess` works in development. For a tighter production policy, the required services are:

| Service | Permissions needed |
|---|---|
| CloudFormation | Full (`cloudformation:*`) |
| Lambda | `CreateFunction`, `UpdateFunctionCode`, `AddPermission`, `InvokeFunction` |
| API Gateway | Full (`apigateway:*`) |
| S3 | Full (`s3:*`) |
| CloudFront | `CreateDistribution`, `UpdateDistribution`, `CreateInvalidation` |
| Route53 | `ChangeResourceRecordSets`, `GetHostedZone`, `ListHostedZones` |
| ACM | `RequestCertificate`, `DescribeCertificate`, `ListCertificates` |
| Secrets Manager | `CreateSecret`, `GetSecretValue`, `PutSecretValue`, `UpdateSecret` |
| SSM | `PutParameter`, `GetParameter`, `GetParametersByPath` |
| IAM | `CreateRole`, `AttachRolePolicy`, `PassRole`, `PutRolePolicy` |
| CloudWatch | `PutMetricAlarm`, `DescribeAlarms`, `CreateLogGroup`, `PutRetentionPolicy` |
| X-Ray | `PutTraceSegments`, `PutTelemetryRecords` |
| CloudTrail | `CreateTrail`, `StartLogging` |
| CodeBuild / CodePipeline / CodeConnections | Full (if using CI/CD pipeline) |
| Budgets | `ModifyBudget` |

`iam:PassRole` and `iam:CreateRole` are the most commonly forgotten — CDK creates execution roles for Lambda and must be able to assign them.

### CDK bootstrap (required once per account/region)

CDK needs a staging S3 bucket and ECR repository in your account before any deploy can run. This is a one-time operation:

```bash
# Find your account ID
aws sts get-caller-identity --query Account --output text

# Bootstrap
cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
```

If you skip this, `pnpm deploy:staging` will fail with:
```
Error: This stack uses assets, so the toolkit stack must be deployed
```

### Route53 hosted zone

CDK looks up your hosted zone by ID — it does not create it. Create it first:

1. Go to Route53 → Hosted zones → Create hosted zone
2. Enter your domain name (e.g., `yourdomain.com`)
3. Copy the Hosted Zone ID (format: `Z0123456789XXXX`)
4. Update your domain registrar's nameservers to match the NS records Route53 assigned

---

## 3. Project Configuration

### Rename the project

`PROJECT_NAME` drives all AWS resource names: CloudFormation stacks, Lambda function names, S3 buckets, Secrets Manager paths, and CloudWatch log groups. Everything is namespaced as `{PROJECT_NAME}-{STAGE}-*`.

The one-command way:

```bash
pnpm init-project <project-name> <domain> \
  --account YOUR_AWS_ACCOUNT_ID --email you@yourdomain.com \
  --github-owner your-github-user --github-repo your-repo
```

This generates `.env.local`, `.env.staging`, and `.env.production` from the
template in section 5 and sets the `package.json` name. You then fill in the
real secret values (WorkOS, database, hosted zone ID) before deploying.

Doing it manually instead, update `PROJECT_NAME` in:
- `package.json` → `name` field
- `.env.staging`, `.env.production`, `.env.local` → `PROJECT_NAME=your-project`

S3 bucket names are globally unique. If your `PROJECT_NAME` is too generic, the deploy may fail with a bucket conflict — pick something distinctive.

### Verify no stray references remain

Tracked source and docs are name-clean: all naming flows from `PROJECT_NAME`
and your domain in the (gitignored) `.env.*` files, and generated artifacts
(`docs/api/openapi.json`) are re-stamped from those on every build. To verify
nothing from a previous identity lingers in your clone:

```bash
grep -ri "your-old-name" . \
  --include="*.ts" --include="*.md" --include="*.json" --include="*.sh" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=cdk.out
```

Placeholders used throughout the docs (`your-project`, `yourdomain.com`,
`you@yourdomain.com`) are replaced by your real values only in `.env.*` files —
never committed.

### Things hardcoded in source that need attention

**Alert email** — `infrastructure/bin/app.ts`:
`ALERT_EMAIL` has no fallback. If unset, CloudWatch alarms are created but have no notification destination. Set it in your `.env` files:
```bash
ALERT_EMAIL=you@yourdomain.com
```

**Monthly budget** — `infrastructure/bin/app.ts`:
```typescript
monthlyBudget: stage === 'production' ? 200 : 50  // $200 prod, $50 staging
```
Adjust to match your expected AWS spend.

**GitHub vars required at synth time** — `infrastructure/bin/app.ts`:
`GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_BRANCH` are validated at CDK synth time. They must be present in your `.env` file even before you set up CI/CD, otherwise `pnpm deploy:staging` will throw immediately.

---

## 4. External Services

### WorkOS

1. Create an account at [workos.com](https://workos.com)
2. Create a new application
3. Copy the Client ID (different for staging and production)

```bash
# .env.staging
WORKOS_CLIENT_ID=client_staging_xxxxxxxx

# .env.production
WORKOS_CLIENT_ID=client_production_xxxxxxxx
```

### Neon (PostgreSQL)

1. Create an account at [neon.tech](https://neon.tech)
2. Create a project; provision two databases — one for staging, one for production
3. Copy the connection strings (always include `?sslmode=require` for Neon)

```bash
# .env.staging
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/staging_db?sslmode=require

# .env.production
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/production_db?sslmode=require
```

### Sentry (optional)

1. Create a project at [sentry.io](https://sentry.io), choose Node.js
2. Copy the DSN from Project Settings → Client Keys

```bash
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=staging
```

---

## 5. Environment Files

Create `.env.staging` (repeat with production values for `.env.production`):

```bash
# Identity
PROJECT_NAME=your-project
STAGE=staging

# AWS
AWS_REGION=us-east-1
CDK_DEFAULT_ACCOUNT=YOUR_12_DIGIT_AWS_ACCOUNT_ID

# Domain
HOSTED_ZONE_NAME=yourdomain.com
HOSTED_ZONE_ID=Z0123456789YOURID
API_DOMAIN=api-staging.yourdomain.com

# Media / Storage
IMAGES_BUCKET=your-project-staging-images
IMAGES_CDN_URL=https://images-staging.yourdomain.com

# CORS
CORS_DOMAIN_PATTERNS=*.yourdomain.com,localhost:*

# Auth (WorkOS)
WORKOS_CLIENT_ID=client_staging_xxx

# Database (Neon)
DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require

# Monitoring
ALERT_EMAIL=you@yourdomain.com
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=staging

# GitHub (required for CDK to synthesize the pipeline stack)
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name
GITHUB_BRANCH=develop
```

Never commit `.env.*` files — they are gitignored.

---

## 6. First Deploy Sequence

Run these steps in order. Each depends on the previous.

```bash
# 1. Install dependencies
pnpm install

# 2. Bootstrap CDK (one-time per account/region — skip if already done)
cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1

# 3. Push secrets and config to AWS Secrets Manager and SSM Parameter Store
pnpm sync-secrets staging

# 4. Deploy all CDK stacks to staging
pnpm deploy:staging

# 5. Run database migrations against the Neon staging database
pnpm migrate

# 6. Verify
curl https://api-staging.yourdomain.com/v1/health
curl https://api-staging.yourdomain.com/v1/health/detailed
```

CDK resolves stack dependency order automatically. The effective deploy order is:

```
SecurityStack (secrets, IAM)
    ↓
DatabaseStack + MediaStack + MonitoringStack + CostMonitoringStack + CloudTrailStack
    ↓
ApiStack (depends on SecurityStack + MediaStack)
    ↓
PipelineStack (staging/production only, depends on SecurityStack)
```

**After deploy:** DNS propagation for new Route53 records takes 1–5 minutes. ACM certificate validation can take up to 30 minutes if CDK is issuing a new certificate.

---

## 7. CI/CD Pipeline

The project uses AWS CodePipeline (not GitHub Actions). Every push to your branch automatically runs: lint → typecheck → test → migrate → CDK deploy.

The CI/CD pipeline is created automatically by CDK as part of `pnpm deploy:staging`.

Short version:

1. Create a GitHub → AWS connection in the CodePipeline console
2. Store the connection ARN in SSM:
   ```bash
   aws ssm put-parameter \
     --name /github/connection-arn \
     --value "arn:aws:codeconnections:us-east-1:YOUR_ACCOUNT_ID:connection/YOUR_CONNECTION_ID" \
     --type String \
     --region us-east-1
   ```
3. The pipeline stack deploys automatically as part of `pnpm deploy:staging` — no manual CodePipeline setup needed beyond the GitHub connection

---

## 8. Verify the Deployment

```bash
# Health check (no auth required)
curl https://api-staging.yourdomain.com/v1/health | jq .

# Detailed health including database connectivity
curl https://api-staging.yourdomain.com/v1/health/detailed | jq .

# Authenticated endpoint (requires a WorkOS JWT)
curl -H "Authorization: Bearer YOUR_JWT" \
  https://api-staging.yourdomain.com/v1/users/me | jq .

# Confirm security headers are present
curl -I https://api-staging.yourdomain.com/v1/health
# Expected: Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, CSP
```

Check in the AWS console:
- **CloudWatch Logs** → `/aws/lambda/your-project-staging-*` — confirm Lambda invocations are logging
- **X-Ray** → Service Map — confirm traces flowing from Lambda to database
- **CloudWatch Alarms** → confirm all alarms are in OK state
- **SNS** → confirm you've confirmed the email subscription for alarm notifications
- **Secrets Manager** → confirm `/your-project/staging/workos` and `/your-project/staging/database` exist

---

## 9. Customize Schema and Handlers

### What to keep (core infrastructure)

- `src/node/db/schema/users.ts` — auth identities, profiles
- `src/node/db/schema/audit.ts` — SOC 2 audit log (don't remove this)
- `src/node/handlers/users/` — user profile endpoints
- `src/node/handlers/webhooks/workos.ts` — WorkOS user sync
- `src/node/handlers/utils/health.ts` — health checks

### What to remove if you don't need it

```bash
# Example: strip the CRM-specific schema if building something else
# Schema is already clean -- 8 tables: users, profiles, authIdentities,
# organizations, orgUnits, organizationMembers, idempotencyKeys, auditLogs

# Update the schema barrel export
# Edit: src/node/db/schema/index.ts

# Remove test endpoints in production
rm -rf src/node/handlers/test/
```

### Add your own tables

```bash
# Create a new schema file
touch src/node/db/schema/your-domain.ts

# Generate the migration SQL
pnpm db:generate

# Apply to your database
pnpm migrate
```

### Add your own handlers

Templates in `templates/` show the standard handler structure:

```bash
cp templates/user-scoped.ts.template src/node/handlers/your-resource/action.ts
```

Register the route in:
- `infrastructure/lib/routes/protected-routes.ts` — JWT-required endpoints
- `infrastructure/lib/routes/public-routes.ts` — no auth
- `infrastructure/lib/routes/internal-routes.ts` — API key / webhook auth

---

## 10. Cleanup Checklist

- [ ] `pnpm init-project` run (or `PROJECT_NAME` updated in all `.env.*` files and `package.json`)
- [ ] No references to a previous project identity remain (see "Verify no stray references remain")
- [ ] `CDK_DEFAULT_ACCOUNT` set to your actual AWS account ID
- [ ] `ALERT_EMAIL` set so CloudWatch alarms have a notification destination
- [ ] Budget amounts adjusted in `infrastructure/bin/app.ts`
- [ ] Route53 hosted zone created and nameservers configured at your registrar
- [ ] CDK bootstrapped in your account/region (`cdk bootstrap`)
- [ ] GitHub connection ARN stored in SSM
- [ ] Unused schema files removed
- [ ] `test/` handlers removed for production
- [ ] Sentry project pointing to the right project
- [ ] SNS alarm email subscription confirmed
- [ ] Consider archiving this file after setup is complete

---

## 11. Troubleshooting

### "This stack uses assets, so the toolkit stack must be deployed"

CDK bootstrap hasn't been run. Execute:
```bash
cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
```

### "Stack already exists" or CloudFormation conflict

```bash
aws cloudformation list-stacks \
  --region us-east-1 \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
```

Delete conflicting stacks if they're from a previous project attempt.

### S3 bucket name conflict on deploy

S3 names are globally unique. Either pick a more distinctive `PROJECT_NAME` or explicitly set `IMAGES_BUCKET` to a unique value in your `.env` file.

### DNS not resolving after deploy

Wait 5–10 minutes, then:
```bash
dig api-staging.yourdomain.com
```

If ACM certificate validation is pending, check the ACM console — it can take up to 30 minutes.

### WorkOS authentication failing

Common causes:
- Wrong `WORKOS_CLIENT_ID` (staging key used in production or vice versa)
- JWT issuer mismatch — check the authorizer Lambda logs in CloudWatch
- JWKS endpoint unreachable — check Lambda has outbound internet access

### Database connection failing

Common causes:
- Missing `?sslmode=require` on Neon connection strings
- Secrets not synced to Secrets Manager — run `pnpm sync-secrets staging`
- Migrations not run — run `pnpm migrate`

Test DB connectivity:
```bash
curl https://api-staging.yourdomain.com/v1/health/detailed | jq '.data.checks.database'
```

### Pipeline fails: "Secret not found"

Secrets haven't been synced yet. Run:
```bash
pnpm sync-secrets staging   # or production
```

Then re-trigger the pipeline.

### CDK synth fails: "GITHUB_OWNER is required"

`GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_BRANCH` are validated at synth time even if you haven't set up CI/CD yet. Add them to your `.env` file with placeholder values if needed.

---

## Further Reading

- [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) — full reference for every env var
- [SECURITY.md](./SECURITY.md) — security architecture and threat model
- [TESTING.md](./guides/TESTING.md) — unit and integration testing guide
- [CDK_TEARDOWN.md](./guides/CDK_TEARDOWN.md) — how to destroy AWS stacks
