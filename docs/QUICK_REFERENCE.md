# 🚀 Quick Reference Guide

Essential commands for daily development and deployment.

---

## 📦 Environment Setup

### Sync Environment Variables to AWS

```bash
# Sync staging secrets and parameters
pnpm sync-secrets

# This syncs from .env.staging to:
# - AWS Secrets Manager (WORKOS_CLIENT_ID, DATABASE_URL)
# - AWS SSM Parameter Store (HOSTED_ZONE_ID, API_DOMAIN, etc.)
```

See [SYNC_SECRETS.md](./SYNC_SECRETS.md) for details.

---

## 🔗 GitHub Connection Setup

### First Time Setup

```bash
# 1. Create connection in AWS Console
open "https://console.aws.amazon.com/codesuite/settings/connections"

# 2. After creating, store the ARN in SSM
aws ssm put-parameter \
  --name /github/connection-arn \
  --value "arn:aws:codeconnections:us-east-1:YOUR_ACCOUNT_ID:connection/YOUR_CONNECTION_ID" \
  --type String \
  --description "GitHub connection for CodePipeline (shared across all projects)" \
  --region us-east-1 \
  --overwrite
```

### Reuse Existing Connection

```bash
# List existing connections
aws codeconnections list-connections --region us-east-1

# Update SSM with existing connection ARN
aws ssm put-parameter \
  --name /github/connection-arn \
  --value "arn:aws:codeconnections:us-east-1:YOUR_ACCOUNT_ID:connection/EXISTING_ID" \
  --type String \
  --region us-east-1 \
  --overwrite
```

---

## 🚀 Deployment

### Deploy to Staging

```bash
# Deploy all stacks to staging
pnpm deploy:staging
```

### Deploy to Production

```bash
# 1. Merge develop to main
git checkout main
git pull origin main
git merge develop
git push origin main

# 2. Sync develop back with main
git checkout develop
git pull origin main
git push origin develop

# 3. Deploy production (optional - pipeline auto-deploys)
pnpm deploy:production
```

---

## 🧪 Testing

### Test Staging API

```bash
# Quick health check
curl https://api-staging.yourdomain.com/v1/health/detailed | jq .

# Basic API tests (no auth needed)
./tests/integration/test-api.sh staging

# Full integration tests (requires JWT)
./tests/integration/test-handlers.sh staging "YOUR_JWT_TOKEN"
```

### Test Production API

```bash
# Health check
curl https://api.yourdomain.com/v1/health/detailed | jq .

# Basic tests
./tests/integration/test-api.sh production

# Full tests
./tests/integration/test-handlers.sh production "YOUR_JWT_TOKEN"
```

---

## 🗄️ Database

### Run Migrations

```bash
pnpm migrate
```

### Reset Database (⚠️ Destructive)

```bash
# Drop all tables and recreate
pnpm db:drop
pnpm db:generate
pnpm migrate
```

---

## 🔍 Monitoring

### Check Pipeline Status

```bash
# Staging pipeline
aws codepipeline get-pipeline-state \
  --name {PROJECT_NAME}-staging-pipeline \
  --region us-east-1

# Production pipeline
aws codepipeline get-pipeline-state \
  --name {PROJECT_NAME}-production-pipeline \
  --region us-east-1
```

### View Pipeline in Console

```bash
# Staging
open "https://console.aws.amazon.com/codesuite/codepipeline/pipelines/{PROJECT_NAME}-staging-pipeline/view"

# Production
open "https://console.aws.amazon.com/codesuite/codepipeline/pipelines/{PROJECT_NAME}-production-pipeline/view"
```

### Trigger Pipeline Manually

```bash
# Staging
aws codepipeline start-pipeline-execution \
  --name {PROJECT_NAME}-staging-pipeline \
  --region us-east-1

# Production
aws codepipeline start-pipeline-execution \
  --name {PROJECT_NAME}-production-pipeline \
  --region us-east-1
```

---

## 📝 Development

### Local Development

```bash
# Start local dev server
pnpm dev

# Server runs at http://localhost:3000
```

### Run Tests Locally

```bash
# Unit tests
pnpm test:run

# Lint
pnpm lint

# Type check
pnpm typecheck

# All checks
pnpm check
```

### Build

```bash
# Build TypeScript
pnpm build

# Watch mode
pnpm watch
```

---

## 🔐 Secrets Management

### View Secrets

```bash
# List all secrets
aws secretsmanager list-secrets --region us-east-1

# View specific secret
aws secretsmanager get-secret-value \
  --secret-id /{PROJECT_NAME}/staging/workos \
  --region us-east-1 \
  --query SecretString \
  --output text | jq .
```

### View SSM Parameters

```bash
# List all parameters
aws ssm get-parameters-by-path \
  --path /{PROJECT_NAME}/staging \
  --region us-east-1

# View specific parameter
aws ssm get-parameter \
  --name /{PROJECT_NAME}/staging/api-domain \
  --region us-east-1
```

---

## 🌿 Git Workflow

### Keep Branches Synced

```bash
# After merging develop to main
git checkout develop
git pull origin main
git push origin develop

# Now develop and main are at 0/0 (no behind/ahead)
```

### Check Branch Status

```bash
git fetch origin
git status
```

---

## 📚 Documentation

- [AWS Pipeline Setup](./AWS_PIPELINE_SETUP.md) - Full CI/CD setup guide
- [Sync Secrets](./SYNC_SECRETS.md) - Environment variable management
- [Setup Guide](./SETUP_GUIDE.md) - Initial project setup
- [Testing Guide](./guides/TESTING.md) - Writing and running tests

---

## 🆘 Troubleshooting

### Pipeline Failed

```bash
# Check build logs
aws codebuild batch-get-builds \
  --ids $(aws codepipeline get-pipeline-state \
    --name {PROJECT_NAME}-staging-pipeline \
    --region us-east-1 \
    --query 'stageStates[1].actionStates[0].latestExecution.externalExecutionId' \
    --output text) \
  --region us-east-1
```

### Clear CDK Context

```bash
# If CDK is using stale values
pnpm cdk context --clear
```

### Database Connection Issues

```bash
# Test database connectivity
curl https://api-staging.yourdomain.com/v1/health/detailed | jq '.data.checks.database'
```

---

## 💡 Pro Tips

1. **Always sync secrets before deploying:**
   ```bash
   pnpm sync-secrets && pnpm deploy:staging
   ```

2. **Test staging before production:**
   ```bash
   ./tests/integration/test-handlers.sh staging "JWT"
   ```

3. **Keep branches synced to avoid conflicts:**
   ```bash
   git checkout develop && git pull origin main && git push
   ```

4. **Use health endpoint to verify deployments:**
   ```bash
   curl https://api-staging.yourdomain.com/v1/health/detailed | jq .
   ```
