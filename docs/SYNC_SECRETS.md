# 🔄 Sync Secrets Script

Automatically sync your `.env` files to AWS Secrets Manager and SSM Parameter Store.

---

## 🚀 Quick Start

```bash
# Sync staging environment
pnpm run sync-secrets staging

# Sync production environment
pnpm run sync-secrets production
```

---

## 📦 What It Does

The script reads your `.env.staging` or `.env.production` file and syncs:

### 1. **Secrets Manager** (Sensitive Data)
- **WorkOS Credentials** → `/{projectName}/{stage}/workos`
  - `WORKOS_CLIENT_ID`
  - `WORKOS_API_KEY`
  - `WORKOS_WEBHOOK_SECRET`

- **Database Credentials** → `/{projectName}/{stage}/database`
  - `DATABASE_URL`

### 2. **SSM Parameter Store** (Configuration)
- `HOSTED_ZONE_ID` → `/{projectName}/{stage}/hosted-zone-id`
- `HOSTED_ZONE_NAME` → `/{projectName}/{stage}/hosted-zone-name`
- `IMAGES_BUCKET` → `/{projectName}/{stage}/images-bucket`
- `IMAGES_CDN_URL` → `/{projectName}/{stage}/images-cdn-url`
- `API_DOMAIN` → `/{projectName}/{stage}/api-domain`
- `CORS_DOMAIN_PATTERNS` → `/{projectName}/{stage}/cors-domain-patterns`
- `CORS_EXACT_ORIGINS` → `/{projectName}/{stage}/cors-exact-origins`
- `CORS_PARENT_DOMAINS` → `/{projectName}/{stage}/cors-parent-domains`

---

## 📝 Example

### Your `.env.staging` file:
```bash
PROJECT_NAME=postway
STAGE=staging
WORKOS_CLIENT_ID=client_staging_123
DATABASE_URL=postgresql://user:pass@staging-db.neon.tech/db
HOSTED_ZONE_ID=Z0123456789ABC
HOSTED_ZONE_NAME=postway.services
IMAGES_BUCKET=postway-staging-images
IMAGES_CDN_URL=https://images-staging.postway.services
API_DOMAIN=api-staging.postway.services
CORS_DOMAIN_PATTERNS=*.postway.services,localhost:*
CORS_EXACT_ORIGINS=https://app-staging.postway.services
CORS_PARENT_DOMAINS=postway.services
```

### Run the script:
```bash
pnpm run sync-secrets staging
```

### Output:
```
🔄 Syncing staging environment variables to AWS Secrets Manager...

📦 Syncing WorkOS Credentials...
   ✓ WORKOS_CLIENT_ID
   ✅ Updated secret: /postway/staging/workos

📦 Syncing Database Credentials...
   ✓ DATABASE_URL
   ✅ Updated secret: /postway/staging/database

📝 Syncing SSM Parameters...
   ✓ Hosted Zone ID
   ✓ Hosted Zone Name
   ✓ Images Bucket
   ✓ Images CDN URL
   ✓ API Domain
   ✓ CORS Domain Patterns
   ✓ CORS Exact Origins
   ✓ CORS Parent Domains

✅ Sync complete!

📋 Summary:
   Stage: staging
   Secrets Manager: /postway/staging/*
   SSM Parameters: /postway/staging/*

🔍 Verify with:
   aws secretsmanager list-secrets --filters Key=name,Values=/postway/staging
   aws ssm get-parameters-by-path --path /postway/staging
```

---

## 🔍 Verify Sync

### View Secrets Manager
```bash
# List all secrets for staging
aws secretsmanager list-secrets --filters Key=name,Values=/postway/staging

# View specific secret
aws secretsmanager get-secret-value --secret-id /postway/staging/workos
aws secretsmanager get-secret-value --secret-id /postway/staging/database
```

### View SSM Parameters
```bash
# List all parameters for staging
aws ssm get-parameters-by-path --path /postway/staging

# View specific parameter
aws ssm get-parameter --name /postway/staging/hosted-zone-id
```

---

## 🔄 Workflow

### Initial Setup
1. Create `.env.staging` with all your environment variables
2. Run `pnpm run sync-secrets staging`
3. Secrets are created in AWS

### Update Values
1. Edit `.env.staging` with new values
2. Run `pnpm run sync-secrets staging`
3. Secrets are updated in AWS

### Production
1. Create `.env.production` with production values
2. Run `pnpm run sync-secrets production`
3. Production secrets are created/updated

---

## 🎯 Benefits

### ✅ Before (Manual)
```bash
# Create WorkOS secret
aws secretsmanager create-secret \
  --name /postway/staging/workos \
  --secret-string '{"clientId":"client_123","apiKey":"sk_123"}'

# Create database secret
aws secretsmanager create-secret \
  --name /postway/staging/database \
  --secret-string '{"url":"postgresql://..."}'

# Create SSM parameters (one by one)
aws ssm put-parameter --name /postway/staging/hosted-zone-id --value "Z123..."
aws ssm put-parameter --name /postway/staging/hosted-zone-name --value "postway.services"
# ... 6 more commands
```

### ✅ After (Automated)
```bash
pnpm run sync-secrets staging
```

**Saves 10+ minutes per environment!**

---

## 🔒 Security

### Sensitive Data (Secrets Manager)
- ✅ Encrypted at rest
- ✅ IAM-controlled access
- ✅ Automatic rotation support
- ✅ Audit logging

### Configuration (SSM Parameter Store)
- ✅ Free (standard tier)
- ✅ Version history
- ✅ IAM-controlled access
- ✅ Easy to update

### Your `.env` Files
- ⚠️ **Never commit to git** (already in `.gitignore`)
- ✅ Keep local only
- ✅ Sync to AWS when needed

---

## 🆘 Troubleshooting

### Error: "Secret already exists"
The script automatically updates existing secrets. This error shouldn't occur.

### Error: "Access Denied"
```bash
# Ensure your AWS credentials have permissions:
aws iam get-user
```

You need:
- `secretsmanager:CreateSecret`
- `secretsmanager:PutSecretValue`
- `ssm:PutParameter`

### Error: "File not found"
```bash
# Ensure .env file exists:
ls -la .env.staging
```

### Missing Variables
The script will warn you:
```
⚠️  WORKOS_API_KEY not found in .env.staging
```

Add the missing variable to your `.env` file.

---

## 🎨 Customization

### Add More Secrets

Edit `scripts/sync-secrets.ts` and add to `secretMappings`:

```typescript
{
  name: 'Stripe Credentials',
  secretId: `/${projectName}/${stage}/stripe`,
  keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  jsonKeys: {
    secretKey: 'STRIPE_SECRET_KEY',
    webhookSecret: 'STRIPE_WEBHOOK_SECRET',
  },
}
```

### Add More SSM Parameters

Add to `ssmMappings`:

```typescript
{ 
  name: 'Sentry DSN', 
  key: 'SENTRY_DSN', 
  paramName: `/${projectName}/${stage}/sentry-dsn` 
}
```

---

## 💡 Pro Tips

### 1. Sync Before Deployment
```bash
# Update secrets first
pnpm run sync-secrets staging

# Then deploy
pnpm run deploy:staging
```

### 2. Use for Both Environments
```bash
# Sync both at once
pnpm run sync-secrets staging
pnpm run sync-secrets production
```

### 3. Verify After Sync
```bash
# Quick verification
aws secretsmanager get-secret-value --secret-id /postway/staging/workos | jq .SecretString
```

---

## 📊 Cost

### Secrets Manager
- $0.40/secret/month
- 2 secrets per environment = **$0.80/month**

### SSM Parameter Store
- Standard tier: **Free** (up to 10,000 parameters)

**Total: ~$0.80/month per environment**

---

## ✅ Summary

**One command to sync all your environment variables to AWS!**

```bash
pnpm run sync-secrets staging
```

No more manual AWS CLI commands. No more copy-paste errors. Just sync and deploy! 🚀
