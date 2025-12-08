# Environment Variables Reference

This document lists all environment variables used in the project and where they are stored in AWS.

## 📋 Table of Contents
- [Local Development (.env files)](#local-development-env-files)
- [AWS SSM Parameter Store](#aws-ssm-parameter-store)
- [AWS Secrets Manager](#aws-secrets-manager)
- [Lambda Runtime Environment](#lambda-runtime-environment)

---

## 🔧 Local Development (.env files)

These variables must be defined in `.env.staging` and `.env.production` files:

### Required Variables
- `PROJECT_NAME` - Project identifier (e.g., "postway")
- `STAGE` - Environment stage ("staging" or "production")
- `AWS_REGION` - AWS region (e.g., "us-east-1")
- `HOSTED_ZONE_ID` - Route53 hosted zone ID
- `HOSTED_ZONE_NAME` - Domain name (e.g., "postway.services")
- `GITHUB_OWNER` - GitHub organization/user
- `GITHUB_REPO` - Repository name
- `GITHUB_BRANCH` - Branch to deploy from
- `WORKOS_CLIENT_ID` - WorkOS client ID (sensitive)
- `DATABASE_URL` - PostgreSQL connection string (sensitive)
- `IMAGES_BUCKET` - S3 bucket for images
- `IMAGES_CDN_URL` - CloudFront CDN URL
- `CORS_DOMAIN_PATTERNS` - CORS allowed domain patterns

### Optional Variables
- `IMAGES_BUCKET_PREFIX` - S3 key prefix for images
- `API_DOMAIN` - Custom API domain
- `CORS_EXACT_ORIGINS` - Exact CORS origins (comma-separated)
- `CORS_PARENT_DOMAINS` - Parent domains for CORS (comma-separated)
- `ALERT_EMAIL` - Email for monitoring alerts

---

## 📦 AWS SSM Parameter Store

Non-sensitive configuration stored in SSM Parameter Store.

### Global Parameters
**Path:** `/github/*`
- `/github/project-name` - Project name (used by CI/CD pipeline)

### Stage-Specific Parameters
**Path:** `/{PROJECT_NAME}/{STAGE}/*`

#### Infrastructure
- `/{PROJECT_NAME}/{STAGE}/hosted-zone-id`
- `/{PROJECT_NAME}/{STAGE}/hosted-zone-name`
- `/{PROJECT_NAME}/{STAGE}/api-domain`

#### GitHub Configuration (CI/CD)
- `/{PROJECT_NAME}/{STAGE}/github-owner`
- `/{PROJECT_NAME}/{STAGE}/github-repo`
- `/{PROJECT_NAME}/{STAGE}/github-branch`

#### Media/Storage
- `/{PROJECT_NAME}/{STAGE}/images-bucket`
- `/{PROJECT_NAME}/{STAGE}/images-bucket-prefix`
- `/{PROJECT_NAME}/{STAGE}/images-cdn-url`

#### CORS Configuration
- `/{PROJECT_NAME}/{STAGE}/cors-domain-patterns`
- `/{PROJECT_NAME}/{STAGE}/cors-exact-origins`
- `/{PROJECT_NAME}/{STAGE}/cors-parent-domains`

#### Monitoring
- `/{PROJECT_NAME}/{STAGE}/alert-email`

---

## 🔐 AWS Secrets Manager

Sensitive credentials stored in Secrets Manager (JSON format).

### WorkOS Credentials
**Secret ID:** `/{PROJECT_NAME}/{STAGE}/workos`

**JSON Structure:**
```json
{
  "clientId": "WORKOS_CLIENT_ID"
}
```

### Database Credentials
**Secret ID:** `/{PROJECT_NAME}/{STAGE}/database`

**JSON Structure:**
```json
{
  "url": "DATABASE_URL"
}
```

---

## 🚀 Lambda Runtime Environment

Environment variables injected into Lambda functions at runtime.

### Core Configuration
- `PROJECT_NAME` - Project identifier
- `NODE_ENV` - Node environment ("production" or "staging")
- `STAGE` - Deployment stage

### Authentication
- `WORKOS_CLIENT_ID` - WorkOS client ID
- `WORKOS_SECRET_ARN` - ARN of WorkOS secret in Secrets Manager

### Database
- `DATABASE_URL` - Direct database URL (if available)
- `DB_SECRET_ARN` - ARN of database secret in Secrets Manager

### Media/Storage
- `IMAGES_BUCKET` - S3 bucket name
- `IMAGES_CDN_URL` - CloudFront distribution URL
- `IMAGES_BUCKET_PREFIX` - S3 key prefix

### CORS Configuration
- `CORS_DOMAIN_PATTERNS` - Regex patterns for allowed domains
- `CORS_EXACT_ORIGINS` - Exact origin URLs
- `CORS_PARENT_DOMAINS` - Parent domain names

---

## 🔄 Syncing Process

### 1. Create/Update `.env.{stage}` files locally
Add all required variables to your environment files.

### 2. Run sync script
```bash
# Sync staging environment
pnpm sync-secrets staging

# Sync production environment
pnpm sync-secrets production
```

### 3. What gets synced where

| Variable | Destination | Type |
|----------|-------------|------|
| `PROJECT_NAME` | SSM: `/github/project-name` | String |
| `HOSTED_ZONE_ID` | SSM: `/{PROJECT_NAME}/{STAGE}/hosted-zone-id` | String |
| `HOSTED_ZONE_NAME` | SSM: `/{PROJECT_NAME}/{STAGE}/hosted-zone-name` | String |
| `GITHUB_OWNER` | SSM: `/{PROJECT_NAME}/{STAGE}/github-owner` | String |
| `GITHUB_REPO` | SSM: `/{PROJECT_NAME}/{STAGE}/github-repo` | String |
| `GITHUB_BRANCH` | SSM: `/{PROJECT_NAME}/{STAGE}/github-branch` | String |
| `IMAGES_BUCKET` | SSM: `/{PROJECT_NAME}/{STAGE}/images-bucket` | String |
| `IMAGES_BUCKET_PREFIX` | SSM: `/{PROJECT_NAME}/{STAGE}/images-bucket-prefix` | String |
| `IMAGES_CDN_URL` | SSM: `/{PROJECT_NAME}/{STAGE}/images-cdn-url` | String |
| `API_DOMAIN` | SSM: `/{PROJECT_NAME}/{STAGE}/api-domain` | String |
| `CORS_DOMAIN_PATTERNS` | SSM: `/{PROJECT_NAME}/{STAGE}/cors-domain-patterns` | String |
| `CORS_EXACT_ORIGINS` | SSM: `/{PROJECT_NAME}/{STAGE}/cors-exact-origins` | String |
| `CORS_PARENT_DOMAINS` | SSM: `/{PROJECT_NAME}/{STAGE}/cors-parent-domains` | String |
| `ALERT_EMAIL` | SSM: `/{PROJECT_NAME}/{STAGE}/alert-email` | String |
| `WORKOS_CLIENT_ID` | Secrets Manager: `/{PROJECT_NAME}/{STAGE}/workos` | JSON |
| `DATABASE_URL` | Secrets Manager: `/{PROJECT_NAME}/{STAGE}/database` | JSON |

---

## 🔍 Verification Commands

### List all SSM parameters for a stage
```bash
aws ssm get-parameters-by-path --path "/postway/staging" --region us-east-1
```

### List all secrets for a stage
```bash
aws secretsmanager list-secrets --filters Key=name,Values=/postway/staging --region us-east-1
```

### Get specific SSM parameter
```bash
aws ssm get-parameter --name "/postway/staging/hosted-zone-name" --region us-east-1
```

### Get specific secret
```bash
aws secretsmanager get-secret-value --secret-id "/postway/staging/workos" --region us-east-1
```

---

## 📝 Notes

1. **Never commit `.env.*` files** - They are gitignored and contain sensitive data
2. **SSM vs Secrets Manager** - Use SSM for non-sensitive config, Secrets Manager for credentials
3. **CI/CD Pipeline** - The `buildspec.yml` loads all variables from SSM/Secrets at build time
4. **Lambda Functions** - Get variables injected by CDK at deployment time
5. **Fail-Fast** - All required variables are validated; missing values cause immediate failure

---

**Last Updated:** December 8, 2025
