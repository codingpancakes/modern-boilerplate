# ⚡ AWS Pipeline Quick Start

## 🎯 3-Step Setup

### 1. Create GitHub Connection (5 min)

Go to: https://console.aws.amazon.com/codesuite/settings/connections

- Click "Create connection"
- Choose "GitHub"
- Name: `github-postway`
- Authorize AWS
- **Copy the Connection ARN**

### 2. Store Connection ARN in SSM (1 min)

```bash
aws ssm put-parameter \
  --name /github/connection-arn \
  --value "arn:aws:codestar-connections:us-east-1:497537671226:connection/YOUR_CONNECTION_ID" \
  --type String
```

Replace `YOUR_CONNECTION_ID` with your connection ARN from step 1.

### 3. Deploy Pipeline (5 min)

```bash
# Add pipeline to app.ts (see docs/AWS_PIPELINE_SETUP.md)
# Then deploy:
pnpm run deploy:staging
```

---

## ✅ That's It!

Now every push to `develop` automatically:
1. Runs tests
2. Builds code  
3. Deploys to AWS

**No secrets needed!** AWS handles everything with IAM roles.

---

## 📊 View Your Pipeline

https://console.aws.amazon.com/codesuite/codepipeline/pipelines

---

## 💰 Cost

~$5-10/month (vs $20+ for GitHub Actions private repos)

---

## 📚 Full Guide

See `docs/AWS_PIPELINE_SETUP.md` for complete instructions.
