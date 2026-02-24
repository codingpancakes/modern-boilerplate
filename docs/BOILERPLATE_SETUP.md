# 🎯 Using This Backend as a Boilerplate

This guide explains how to set up a new project using this backend as a boilerplate template.

---

## 📋 What You Need to Change

### 1. **Project Name & Branding** (Required)

#### Files to Update:
- **`package.json`** - Update `name` and `description`
- **`.env.staging`** - Change `PROJECT_NAME=postway` to your project name
- **`.env.production`** - Change `PROJECT_NAME=postway` to your project name
- **`.env.local`** - Change `PROJECT_NAME=postway` to your project name (if exists)
- **`README.md`** - Update title, description, and all references to "RailBranch" or "postway"

#### Environment Variables to Change:
```bash
# In .env.staging, .env.production, .env.local
PROJECT_NAME=your-project-name  # Change from "postway"
```

**Important:** `PROJECT_NAME` is used for:
- CloudFormation stack names: `{PROJECT_NAME}-{STAGE}-ApiStack`
- S3 bucket names: `{PROJECT_NAME}-{STAGE}-images`
- CloudWatch log groups: `/aws/lambda/{PROJECT_NAME}-{STAGE}-*`
- Secrets Manager paths: `/{PROJECT_NAME}/{STAGE}/database`

---

### 2. **Domain Configuration** (Required)

#### Environment Variables:
```bash
# In .env.staging
HOSTED_ZONE_NAME=your-domain.com
HOSTED_ZONE_ID=Z0123456789ABC  # Your Route53 hosted zone ID
API_DOMAIN=api-staging.your-domain.com
IMAGES_CDN_URL=https://images-staging.your-domain.com
CORS_DOMAIN_PATTERNS=*.your-domain.com,localhost:*

# In .env.production
HOSTED_ZONE_NAME=your-domain.com
HOSTED_ZONE_ID=Z0123456789ABC
API_DOMAIN=api.your-domain.com
IMAGES_CDN_URL=https://images.your-domain.com
CORS_DOMAIN_PATTERNS=*.your-domain.com
```

#### Files to Update:
- **`docs/SETUP_GUIDE.md`** - Replace all `postway.services` and `postway.ai` references
- **`docs/QUICK_REFERENCE.md`** - Update example URLs
- **`src/node/lib/middleware.ts`** - Update CORS patterns if hardcoded

---

### 3. **Database Configuration** (Required)

#### Create New Databases:
1. **Neon (Recommended):** https://neon.tech
   - Create staging database
   - Create production database
   - Get connection strings

2. **Update Environment Variables:**
```bash
# In .env.staging
DATABASE_URL=postgresql://user:pass@staging-host.neon.tech/dbname

# In .env.production
DATABASE_URL=postgresql://user:pass@production-host.neon.tech/dbname

# In .env.local
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/your_db_name?sslmode=disable
```

#### Run Migrations:
```bash
# Generate migrations from schema
pnpm db:generate

# Run migrations
pnpm migrate
```

---

### 4. **Authentication (WorkOS)** (Required)

#### Setup:
1. Create WorkOS account: https://workos.com
2. Create new WorkOS application
3. Get Client ID and API Key

#### Update Environment Variables:
```bash
# In .env.staging
WORKOS_CLIENT_ID=client_staging_xxx
WORKOS_API_KEY=sk_staging_xxx  # Store in AWS Secrets Manager

# In .env.production
WORKOS_CLIENT_ID=client_prod_xxx
WORKOS_API_KEY=sk_prod_xxx  # Store in AWS Secrets Manager

# In .env.local
WORKOS_CLIENT_ID=client_staging_xxx  # Use staging for local dev
```

---

### 5. **AWS Configuration** (Required)

#### Environment Variables:
```bash
# In .env.staging and .env.production
AWS_REGION=us-east-1  # Or your preferred region
CDK_DEFAULT_ACCOUNT=357225328504  # Your AWS account ID
```

#### AWS Secrets Manager:
After first deployment, manually create secrets:
```bash
# Database secret
aws secretsmanager create-secret \
  --name /your-project/staging/database \
  --secret-string '{"url":"postgresql://..."}'

# WorkOS secret
aws secretsmanager create-secret \
  --name /your-project/staging/workos \
  --secret-string '{"clientId":"client_xxx","apiKey":"sk_xxx"}'
```

Or use the sync script:
```bash
pnpm sync-secrets
```

---

### 6. **GitHub Actions (Optional but Recommended)**

#### Setup:
1. Go to GitHub repository → Settings → Secrets and variables → Actions
2. Add these secrets:

```bash
# AWS Credentials
AWS_ACCESS_KEY_ID=<your-access-key>
AWS_SECRET_ACCESS_KEY=<your-secret-key>
AWS_REGION=us-east-1

# Project Configuration
PROJECT_NAME=your-project-name
HOSTED_ZONE_NAME=your-domain.com
HOSTED_ZONE_ID=Z0123456789ABC

# GitHub Configuration
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name
GITHUB_BRANCH=main

# Staging Environment
STAGING_DATABASE_URL=postgresql://...
STAGING_WORKOS_CLIENT_ID=client_xxx
STAGING_IMAGES_BUCKET=your-project-staging-images
STAGING_IMAGES_CDN_URL=https://images-staging.your-domain.com
STAGING_CORS_DOMAIN_PATTERNS=*.your-domain.com,localhost:*
STAGING_API_DOMAIN=api-staging.your-domain.com
STAGING_API_URL=https://api-staging.your-domain.com

# Production Environment
PRODUCTION_DATABASE_URL=postgresql://...
PRODUCTION_WORKOS_CLIENT_ID=client_xxx
PRODUCTION_IMAGES_BUCKET=your-project-production-images
PRODUCTION_IMAGES_CDN_URL=https://images.your-domain.com
PRODUCTION_CORS_DOMAIN_PATTERNS=*.your-domain.com
PRODUCTION_API_DOMAIN=api.your-domain.com
PRODUCTION_API_URL=https://api.your-domain.com
```

#### Files to Update:
- **`.github/workflows/*.yml`** - Update project references if needed

---

### 7. **Monitoring & Error Tracking** (Optional)

#### Sentry Setup:
1. Create Sentry account: https://sentry.io
2. Create new project
3. Get DSN

```bash
# In .env.staging
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=staging

# In .env.production
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=production
```

#### CloudWatch Alarms:
- Already configured in `infrastructure/lib/monitoring-stack.ts`
- Update email addresses in `infrastructure/bin/app.ts`:
```typescript
alertEmail: process.env.ALERT_EMAIL || 'your-email@domain.com'
```

---

### 8. **Database Schema** (Customize)

#### Current Schema:
The boilerplate includes a **customer engagement platform** schema with:
- Users, profiles, organizations
- Contacts, segments, lists
- Journeys, campaigns
- Messages, templates
- Events, webhooks

#### To Customize:
1. **Keep what you need:**
   - User authentication (users, profiles, authIdentities)
   - Audit logging (auditLogs)
   - Organizations (if multi-tenant)

2. **Remove what you don't need:**
   ```bash
   # Delete schema files
   rm src/node/db/schema/contacts.ts
   rm src/node/db/schema/journeys.ts
   rm src/node/db/schema/messaging.ts
   
   # Update schema index
   # Edit src/node/db/schema/index.ts
   ```

3. **Add your own tables:**
   ```bash
   # Create new schema file
   touch src/node/db/schema/your-domain.ts
   
   # Generate migration
   pnpm db:generate
   
   # Run migration
   pnpm migrate
   ```

---

### 9. **API Handlers** (Customize)

#### Current Handlers:
```
src/node/handlers/
├── users/          # User profile management
├── media/          # Image uploads
├── webhooks/       # WorkOS webhooks
├── test/           # Test endpoints
└── utils/          # Health checks
```

#### To Customize:
1. **Keep:**
   - `users/` - User authentication and profiles
   - `webhooks/workos.ts` - WorkOS integration
   - `utils/health.ts` - Health checks

2. **Remove or modify:**
   - `media/` - If you don't need image uploads
   - `test/` - Remove in production

3. **Add your own:**
   ```bash
   # Use templates
   cp templates/user-scoped.ts.template src/node/handlers/your-resource/action.ts
   
   # Register route in infrastructure/lib/routes/
   ```

---

### 10. **Documentation** (Update)

#### Files to Update:
- **`README.md`** - Project overview
- **`docs/SETUP_GUIDE.md`** - Replace all project-specific references
- **`docs/QUICK_REFERENCE.md`** - Update commands and URLs
- **`docs/architecture/README.md`** - Update architecture diagrams
- **`CONTRIBUTING.md`** - Update contribution guidelines

#### Remove Boilerplate Docs:
```bash
rm docs/BOILERPLATE_SETUP.md  # This file, after you're done
```

---

## 🚀 Step-by-Step Setup

### Step 1: Clone and Clean
```bash
# Clone the repository
git clone <your-fork-url> your-project-name
cd your-project-name

# Remove git history (optional - start fresh)
rm -rf .git
git init
git add .
git commit -m "Initial commit from boilerplate"
```

### Step 2: Update Project Name
```bash
# Update package.json
sed -i '' 's/"name": "serverless-backend"/"name": "your-project-name"/' package.json

# Create environment files
cp .env.staging .env.staging.backup
cp .env.production .env.production.backup

# Update PROJECT_NAME in all .env files
# (Do this manually or with sed)
```

### Step 3: Update Domains
```bash
# Update all domain references
# Search for "postway" and replace with your domain
grep -r "postway" . --exclude-dir=node_modules --exclude-dir=.git
```

### Step 4: Setup Databases
```bash
# Create Neon databases
# Update DATABASE_URL in .env files

# Generate and run migrations
pnpm install
pnpm db:generate
pnpm migrate
```

### Step 5: Setup WorkOS
```bash
# Create WorkOS application
# Update WORKOS_CLIENT_ID in .env files
```

### Step 6: Deploy Staging
```bash
# Deploy to AWS
pnpm deploy:staging

# Sync secrets to AWS Secrets Manager
pnpm sync-secrets
```

### Step 7: Test
```bash
# Test health endpoint
curl https://api-staging.your-domain.com/v1/health

# Test authenticated endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api-staging.your-domain.com/v1/users/me
```

### Step 8: Deploy Production
```bash
# Deploy to production
pnpm deploy:production

# Sync production secrets
ENV_FILE=.env.production pnpm sync-secrets
```

---

## 🧹 Cleanup Checklist

After setup, remove boilerplate-specific items:

- [ ] Update `package.json` name and description
- [ ] Update `README.md` title and content
- [ ] Replace all "postway" references with your project name
- [ ] Replace all "railbranch" references with your project name
- [ ] Update domain names in all files
- [ ] Remove unused database schema files
- [ ] Remove unused API handlers
- [ ] Update documentation
- [ ] Remove `docs/BOILERPLATE_SETUP.md` (this file)
- [ ] Update `CONTRIBUTING.md`
- [ ] Remove example test data
- [ ] Update CloudWatch alarm emails
- [ ] Update Sentry project name
- [ ] Remove boilerplate-specific comments

---

## 📊 Quick Reference: Files to Change

### Must Change (Core Identity)
1. `package.json` - name, description
2. `.env.staging` - PROJECT_NAME, domains, credentials
3. `.env.production` - PROJECT_NAME, domains, credentials
4. `.env.local` - PROJECT_NAME, local DB
5. `README.md` - all content
6. `docs/SETUP_GUIDE.md` - all examples

### Should Change (Customization)
7. `src/node/db/schema/*.ts` - your data model
8. `src/node/handlers/*` - your API endpoints
9. `infrastructure/bin/app.ts` - alert emails
10. `docs/architecture/README.md` - your architecture

### Optional Change (Branding)
11. `CONTRIBUTING.md` - contribution guidelines
12. `.github/workflows/*.yml` - CI/CD customization
13. `docs/QUICK_REFERENCE.md` - command examples
14. `tests/integration/*.sh` - test scripts

---

## 🎯 Common Pitfalls

### 1. **Stack Name Conflicts**
If you get "Stack already exists" errors:
```bash
# Check existing stacks
aws cloudformation list-stacks --region us-east-1

# Delete old stacks if needed
./scripts/force-delete-stacks.sh
```

### 2. **S3 Bucket Name Conflicts**
S3 bucket names are globally unique. If deployment fails:
- Change `PROJECT_NAME` to something more unique
- Or manually specify bucket names in environment variables

### 3. **Domain Not Resolving**
After deployment, DNS propagation takes time:
- Wait 5-10 minutes for Route53 changes
- Check DNS: `dig api-staging.your-domain.com`
- Verify ACM certificate is issued

### 4. **Database Connection Fails**
Common issues:
- Wrong connection string format
- Missing SSL parameters
- Firewall blocking connections
- Check Neon dashboard for connection details

### 5. **WorkOS Authentication Fails**
Common issues:
- Wrong Client ID
- JWT not properly formatted
- JWKS endpoint not accessible
- Check WorkOS dashboard for configuration

---

## 💡 Tips

1. **Start Small:** Deploy with minimal schema first, then add features
2. **Test Locally:** Always test locally before deploying
3. **Use Staging:** Deploy to staging first, test thoroughly
4. **Monitor Costs:** Set up AWS Budgets (already configured)
5. **Version Control:** Commit after each major change
6. **Document Changes:** Update docs as you customize
7. **Keep Audit Logs:** Don't remove the audit logging system
8. **Use Templates:** Use handler templates for consistency

---

## 🆘 Need Help?

- **AWS Issues:** Check CloudWatch logs
- **Database Issues:** Check Neon dashboard
- **Auth Issues:** Check WorkOS dashboard
- **Deployment Issues:** Check GitHub Actions logs
- **General Issues:** Check existing documentation in `docs/`

---

**Good luck with your new project! 🚀**
