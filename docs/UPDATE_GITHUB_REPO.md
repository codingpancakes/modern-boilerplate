# 🔄 Update GitHub Repository Connection

This guide shows you how to change the GitHub repository that the AWS CodePipeline uses.

---

## 📋 Prerequisites

- AWS CLI configured with your profile
- Access to AWS Console
- New GitHub repository created

---

## Step 1: Create New GitHub Connection in AWS

### Option A: Using AWS Console (Recommended)

1. **Go to CodePipeline Settings:**
   ```
   https://console.aws.amazon.com/codesuite/settings/connections?region=us-east-1
   ```

2. **Create Connection:**
   - Click "Create connection"
   - Provider: **GitHub**
   - Connection name: `github-railbranch` (or your preferred name)
   - Click "Connect to GitHub"

3. **Authorize GitHub:**
   - Click "Install a new app"
   - Select your GitHub organization/account
   - Choose repositories:
     - **All repositories** OR
     - **Only select repositories** → Select your new repo
   - Click "Install"

4. **Copy the Connection ARN:**
   - After creation, you'll see: `arn:aws:codestar-connections:us-east-1:ACCOUNT_ID:connection/CONNECTION_ID`
   - **Copy this ARN** - you'll need it in Step 2

### Option B: Using AWS CLI

```bash
# Create connection
aws codestar-connections create-connection \
  --provider-type GitHub \
  --connection-name github-railbranch \
  --region us-east-1 \
  --profile outdream

# Output will include the ARN - copy it
# Then complete the handshake in the AWS Console
```

---

## Step 2: Update SSM Parameter Store

Replace the old GitHub connection ARN with the new one:

```bash
# Update the parameter (replace with your new ARN)
aws ssm put-parameter \
  --name "/github/connection-arn" \
  --value "arn:aws:codestar-connections:us-east-1:YOUR_ACCOUNT_ID:connection/YOUR_CONNECTION_ID" \
  --type String \
  --overwrite \
  --region us-east-1 \
  --profile outdream
```

**Verify it was updated:**
```bash
aws ssm get-parameter \
  --name "/github/connection-arn" \
  --region us-east-1 \
  --profile outdream
```

---

## Step 3: Update Repository Info in CDK

Edit `infrastructure/bin/app.ts` (lines 98-100):

**Current:**
```typescript
githubOwner: 'codingpancakes',
githubRepo: 'backend-boilerplate-cdk-workos',
githubBranch: stage === 'production' ? 'main' : 'develop',
```

**Update to your new repo:**
```typescript
githubOwner: 'YOUR_GITHUB_USERNAME_OR_ORG',
githubRepo: 'YOUR_NEW_REPO_NAME',
githubBranch: stage === 'production' ? 'main' : 'develop',
```

**Example:**
```typescript
githubOwner: 'jonathan',
githubRepo: 'RailBranchBackend',
githubBranch: stage === 'production' ? 'main' : 'develop',
```

---

## Step 4: Deploy the Updated Pipeline

```bash
# Deploy staging pipeline
pnpm deploy:staging

# Deploy production pipeline (if needed)
pnpm deploy:production
```

---

## Step 5: Verify the Connection

### Check Pipeline Status:
```bash
# List pipelines
aws codepipeline list-pipelines \
  --region us-east-1 \
  --profile outdream

# Get pipeline details
aws codepipeline get-pipeline \
  --name postway-staging-Pipeline \
  --region us-east-1 \
  --profile outdream
```

### Check in AWS Console:
```
https://console.aws.amazon.com/codesuite/codepipeline/pipelines?region=us-east-1
```

You should see:
- Pipeline name: `postway-staging-Pipeline`
- Source: Your new GitHub repo
- Status: Should trigger on next push

---

## Step 6: Test the Pipeline

```bash
# Push a commit to trigger the pipeline
git add .
git commit -m "test: verify pipeline connection"
git push origin develop  # For staging
```

**Watch the pipeline:**
```
https://console.aws.amazon.com/codesuite/codepipeline/pipelines/postway-staging-Pipeline/view?region=us-east-1
```

---

## 🔍 Troubleshooting

### Connection Status is "Pending"

**Problem:** GitHub connection shows "Pending" status

**Solution:**
1. Go to: https://console.aws.amazon.com/codesuite/settings/connections
2. Click on your connection
3. Click "Update pending connection"
4. Complete the GitHub authorization

---

### Pipeline Fails with "Access Denied"

**Problem:** Pipeline can't access GitHub repo

**Solution:**
1. Check GitHub App permissions:
   - Go to: https://github.com/settings/installations
   - Find "AWS Connector for GitHub"
   - Click "Configure"
   - Ensure your new repo is selected

2. Verify connection ARN in SSM:
   ```bash
   aws ssm get-parameter --name "/github/connection-arn" --region us-east-1 --profile outdream
   ```

---

### Pipeline Not Triggering on Push

**Problem:** Push to GitHub doesn't trigger pipeline

**Solution:**
1. Check webhook in GitHub:
   - Go to your repo → Settings → Webhooks
   - Should see AWS CodePipeline webhook
   - Check recent deliveries for errors

2. Manually trigger pipeline:
   ```bash
   aws codepipeline start-pipeline-execution \
     --name postway-staging-Pipeline \
     --region us-east-1 \
     --profile outdream
   ```

---

## 📝 Quick Reference

### Current Setup
- **Parameter Name:** `/github/connection-arn`
- **Current Owner:** `codingpancakes`
- **Current Repo:** `backend-boilerplate-cdk-workos`
- **Branches:** `develop` (staging), `main` (production)

### Commands Cheat Sheet

```bash
# View current connection ARN
aws ssm get-parameter --name "/github/connection-arn" --region us-east-1 --profile outdream

# Update connection ARN
aws ssm put-parameter --name "/github/connection-arn" --value "NEW_ARN" --overwrite --region us-east-1 --profile outdream

# List GitHub connections
aws codestar-connections list-connections --region us-east-1 --profile outdream

# Trigger pipeline manually
aws codepipeline start-pipeline-execution --name postway-staging-Pipeline --region us-east-1 --profile outdream

# View pipeline status
aws codepipeline get-pipeline-state --name postway-staging-Pipeline --region us-east-1 --profile outdream
```

---

## ✅ Checklist

- [ ] Create new GitHub connection in AWS Console
- [ ] Copy the connection ARN
- [ ] Update SSM parameter `/github/connection-arn`
- [ ] Update `githubOwner` and `githubRepo` in `infrastructure/bin/app.ts`
- [ ] Deploy updated pipeline with `pnpm deploy:staging`
- [ ] Test by pushing a commit
- [ ] Verify pipeline triggers and completes successfully
- [ ] Repeat for production (if needed)

---

## 🎯 Summary

**What you're changing:**
1. GitHub connection ARN in SSM Parameter Store
2. Repository owner and name in CDK code

**Why it's safe:**
- SSM parameter is read at deployment time
- Pipeline will use new repo after next deploy
- No downtime for your API

**Time required:** 10-15 minutes

---

**Need help?** Check the troubleshooting section or AWS CodePipeline logs in CloudWatch.
