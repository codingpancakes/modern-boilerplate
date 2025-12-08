# 🚀 Production Setup Guide

This guide walks you through setting up the complete production-ready backend with CI/CD, monitoring, error tracking, and security.

## 📋 Prerequisites

- AWS Account with appropriate permissions
- GitHub repository
- Sentry account (free tier available)
- Node.js 20+ and pnpm installed
- AWS CLI configured

---

## Step 1: GitHub Secrets Configuration

Add these secrets to your GitHub repository (`Settings` → `Secrets and variables` → `Actions`):

### AWS Credentials
```
AWS_ACCESS_KEY_ID=<your-access-key>
AWS_SECRET_ACCESS_KEY=<your-secret-key>
AWS_REGION=us-east-1
```

### Project Configuration
```
PROJECT_NAME=postway
HOSTED_ZONE_NAME=postway.services
HOSTED_ZONE_ID=<your-route53-zone-id>
```

### Staging Environment
```
STAGING_DATABASE_URL=postgresql://user:pass@host/db
STAGING_WORKOS_CLIENT_ID=client_xxx
STAGING_IMAGES_BUCKET=postway-staging-images
STAGING_IMAGES_CDN_URL=https://images-staging.postway.services
STAGING_CORS_DOMAIN_PATTERNS=*.postway.services,localhost:*
STAGING_API_DOMAIN=api-staging.postway.services
STAGING_API_URL=https://api-staging.postway.services
STAGING_TEST_AUTH_TOKEN=<workos-test-token>
```

### Production Environment
```
PRODUCTION_DATABASE_URL=postgresql://user:pass@host/db
PRODUCTION_WORKOS_CLIENT_ID=client_xxx
PRODUCTION_IMAGES_BUCKET=postway-production-images
PRODUCTION_IMAGES_CDN_URL=https://images.postway.services
PRODUCTION_CORS_DOMAIN_PATTERNS=*.postway.ai,*.postway.co
PRODUCTION_API_DOMAIN=api.postway.ai
PRODUCTION_API_URL=https://api.postway.ai
PRODUCTION_TEST_AUTH_TOKEN=<workos-test-token>
```

### Sentry Configuration
```
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=<sentry-auth-token>
SENTRY_ORG=<your-org>
SENTRY_PROJECT=<your-project>
```

---

## Step 2: Sentry Setup

1. **Create Sentry Account**: https://sentry.io/signup/
2. **Create Project**: Choose "Node.js" as platform
3. **Get DSN**: Copy from Project Settings → Client Keys (DSN)
4. **Create Auth Token**: User Settings → Auth Tokens → Create New Token
   - Scopes: `project:releases`, `org:read`
5. **Add to GitHub Secrets**: Add `SENTRY_DSN` and `SENTRY_AUTH_TOKEN`

---

## Step 3: Install Dependencies

```bash
# Install Sentry packages
pnpm add @sentry/node

# Install dev dependencies (if not already installed)
pnpm install
```

---

## Step 4: Environment Files

Create `.env.staging` and `.env.production` files:

### `.env.staging`
```bash
STAGE=staging
AWS_REGION=us-east-1
PROJECT_NAME=postway
WORKOS_CLIENT_ID=client_xxx
DATABASE_URL=postgresql://user:pass@host/db
IMAGES_BUCKET=postway-staging-images
IMAGES_CDN_URL=https://images-staging.postway.services
CORS_DOMAIN_PATTERNS=*.postway.services,localhost:*
API_DOMAIN=api-staging.postway.services
HOSTED_ZONE_NAME=postway.services
HOSTED_ZONE_ID=Z0123456789ABC
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=staging
```

### `.env.production`
```bash
STAGE=production
AWS_REGION=us-east-1
PROJECT_NAME=postway
WORKOS_CLIENT_ID=client_xxx
DATABASE_URL=postgresql://user:pass@host/db
IMAGES_BUCKET=postway-production-images
IMAGES_CDN_URL=https://images.postway.services
CORS_DOMAIN_PATTERNS=*.postway.ai,*.postway.co
API_DOMAIN=api.postway.ai
HOSTED_ZONE_NAME=postway.services
HOSTED_ZONE_ID=Z0123456789ABC
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=production
```

---

## Step 5: GitHub Environments

Configure GitHub Environments for deployment protection:

1. Go to `Settings` → `Environments`
2. Create `staging` environment:
   - No protection rules needed
3. Create `production` environment:
   - Enable "Required reviewers" (add yourself)
   - Enable "Wait timer" (optional, e.g., 5 minutes)

---

## Step 6: Initial Deployment

### Deploy Staging
```bash
# Push to develop branch
git checkout -b develop
git push origin develop

# GitHub Actions will automatically:
# 1. Run tests
# 2. Deploy to staging
# 3. Run smoke tests
```

### Deploy Production
```bash
# Merge to main branch
git checkout main
git merge develop
git push origin main

# GitHub Actions will:
# 1. Run tests
# 2. Deploy to production (requires approval)
# 3. Run smoke tests
# 4. Create Sentry release
```

---

## Step 7: Verify Deployment

### Check CloudWatch Alarms
```bash
# View alarms
aws cloudwatch describe-alarms --region us-east-1

# Check alarm history
aws cloudwatch describe-alarm-history --alarm-name postway-production-api-high-5xx-rate
```

### Check API Gateway Throttling
```bash
# View API Gateway metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=postway-production-api \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --period 300 \
  --statistics Sum
```

### Test Endpoints
```bash
# Health check
curl https://api.postway.ai/v1/health

# Authenticated endpoint (requires token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.postway.ai/v1/users/me

# Test rate limiting (should get 429 after limit)
for i in {1..2100}; do
  curl https://api.postway.ai/v1/health
done
```

### Check Sentry
1. Go to Sentry dashboard
2. Verify project is receiving events
3. Check release tracking
4. Set up alert rules

---

## Step 8: Monitoring Setup

### CloudWatch Dashboard
1. Go to CloudWatch → Dashboards
2. Open `postway-production-api-dashboard`
3. Pin to favorites

### Alarm Notifications
1. Go to SNS → Topics
2. Find `postway-production-alarms`
3. Verify email subscription is confirmed
4. (Optional) Add Slack/PagerDuty integration

### X-Ray Traces
1. Go to X-Ray → Service Map
2. Verify traces are being collected
3. Set up trace analytics

---

## Step 9: Security Hardening

### Enable API Gateway Logging (Optional)
```bash
# API Gateway access logs are configured in api-stack.ts
# Logs go to CloudWatch Logs automatically
# View logs:
aws logs tail /aws/apigateway/postway-production-api --follow
```

### Review Security Headers
```bash
# Test security headers
curl -I https://api.postway.ai/v1/health

# Should include:
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
```

### Enable GuardDuty (Recommended)
```bash
# Enable GuardDuty for threat detection
aws guardduty create-detector --enable --region us-east-1
```

---

## Step 10: Cost Optimization

### Enable Cost Explorer
1. Go to AWS Billing → Cost Explorer
2. Enable Cost Explorer
3. Create budget alerts

### Review Lambda Memory
```bash
# Check Lambda memory usage
aws lambda list-functions --region us-east-1 | \
  jq '.Functions[] | {name: .FunctionName, memory: .MemorySize}'

# Right-size based on CloudWatch metrics
```

### Enable S3 Lifecycle Policies
```bash
# Add lifecycle policy to images bucket
aws s3api put-bucket-lifecycle-configuration \
  --bucket postway-production-images \
  --lifecycle-configuration file://lifecycle-policy.json
```

---

## 🎉 You're Done!

Your backend is now production-ready with:

- ✅ CI/CD pipeline (GitHub Actions)
- ✅ Error tracking (Sentry)
- ✅ Monitoring & alerting (CloudWatch)
- ✅ Security (API Gateway throttling, input validation, security headers, HTTPS)
- ✅ Performance optimization (authorizer caching)
- ✅ Automated testing (unit + smoke tests)

---

## 📚 Next Steps

1. **Add More Tests**: Increase coverage to 80%+
2. **Load Testing**: Use k6 or Artillery
3. **Performance Tuning**: Monitor and optimize
4. **Documentation**: Keep docs up to date
5. **Backup Strategy**: Implement database backups

---

## 🆘 Troubleshooting

### Deployment Fails
```bash
# Check GitHub Actions logs
# View CloudFormation events
aws cloudformation describe-stack-events --stack-name postway-production-ApiStack

# Rollback if needed
aws cloudformation cancel-update-stack --stack-name postway-production-ApiStack
```

### High Error Rate
```bash
# Check Sentry for error details
# View CloudWatch Logs
aws logs tail /aws/lambda/postway-production-api --follow

# Check X-Ray traces
aws xray get-trace-summaries --start-time $(date -u -d '1 hour ago' +%s) --end-time $(date +%s)
```

### API Gateway Throttling Legitimate Traffic
```bash
# Check throttled requests
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name 4XXError \
  --dimensions Name=ApiName,Value=postway-production-api \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --period 300 \
  --statistics Sum

# Adjust throttling limits in infrastructure/lib/api-stack.ts if needed
```

---

## 📞 Support

- **Documentation**: `/docs` directory
- **Issues**: GitHub Issues
- **Monitoring**: CloudWatch Dashboard
- **Errors**: Sentry Dashboard
