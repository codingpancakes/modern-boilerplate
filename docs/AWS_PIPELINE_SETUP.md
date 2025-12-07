# 🚀 AWS CodePipeline CI/CD Setup Guide

This guide walks you through setting up AWS-native CI/CD using CodePipeline and CodeBuild.

**Benefits over GitHub Actions:**
- ✅ No GitHub secrets needed (uses AWS IAM roles)
- ✅ Native AWS integration
- ✅ Pay-as-you-go pricing (~$5-10/month)
- ✅ Faster builds (runs in AWS VPC)
- ✅ Better security (no credential management)

---

## 📋 Prerequisites

- AWS CLI configured
- GitHub repository
- AWS account with admin access

---

## Step 1: Create GitHub Connection

AWS needs permission to access your GitHub repository.

### Via AWS Console (Easiest)

1. **Go to CodePipeline Settings**:
   ```
   https://console.aws.amazon.com/codesuite/settings/connections
   ```

2. **Create Connection**:
   - Click "Create connection"
   - Provider: **GitHub**
   - Connection name: `github-postway`
   - Click "Connect to GitHub"
   - Authorize AWS Connector for GitHub
   - Click "Connect"

3. **Copy Connection ARN**:
   ```
   arn:aws:codestar-connections:us-east-1:497537671226:connection/abc123...
   ```

4. **Store Connection ARN in SSM**:
   ```bash
   aws ssm put-parameter \
     --name /github/connection-arn \
     --value "arn:aws:codestar-connections:us-east-1:497537671226:connection/YOUR_CONNECTION_ID" \
     --type String \
     --description "GitHub connection for CodePipeline (shared across all projects)"
   ```

---

## Step 2: Update Secrets Manager

Your pipeline needs access to WorkOS and Database credentials.

### Check Existing Secrets

```bash
# List secrets
aws secretsmanager list-secrets

# View secret (staging)
aws secretsmanager get-secret-value --secret-id postway-staging-workos
aws secretsmanager get-secret-value --secret-id postway-staging-db
```

### If Secrets Don't Exist, Create Them

```bash
# Create WorkOS secret
aws secretsmanager create-secret \
  --name postway-staging-workos \
  --secret-string '{"WORKOS_CLIENT_ID":"client_xxx"}'

# Create DB secret
aws secretsmanager create-secret \
  --name postway-staging-db \
  --secret-string '{"DATABASE_URL":"postgresql://user:pass@host/db"}'
```

---

## Step 3: Deploy the Pipeline Stack

### Update `app.ts`

Add the pipeline stack to your CDK app:

```typescript
// infrastructure/bin/app.ts
import { PipelineStack } from '../lib/pipeline-stack';

// ... existing code ...

// Add after other stacks
const pipelineStack = new PipelineStack(app, `${stackPrefix}-PipelineStack`, {
  env,
  stage,
  githubOwner: 'codingpancakes',
  githubRepo: 'backend-boilerplate-cdk-workos',
  githubBranch: stage === 'production' ? 'main' : 'develop',
  dbSecret: securityStack.dbSecret,
  workosSecret: securityStack.workosSecret,
});

pipelineStack.addDependency(securityStack);
```

### Deploy the Pipeline

```bash
# Deploy staging pipeline
pnpm run deploy:staging

# Or deploy production pipeline
pnpm run deploy:production
```

---

## Step 4: Configure Environment Variables

The pipeline uses environment variables from:

1. **Secrets Manager** (sensitive data):
   - `WORKOS_CLIENT_ID`
   - `DATABASE_URL`

2. **Hardcoded in pipeline-stack.ts** (non-sensitive):
   - `STAGE`
   - `PROJECT_NAME`
   - `IMAGES_BUCKET`
   - `API_DOMAIN`
   - etc.

### Update Environment-Specific Values

Edit `infrastructure/lib/pipeline-stack.ts` and update:

```typescript
environmentVariables: {
  // Update these for your project
  IMAGES_CDN_URL: { value: `https://images-${props.stage}.yourproject.com` },
  API_DOMAIN: { value: `api-${props.stage}.yourproject.com` },
  HOSTED_ZONE_NAME: { value: 'yourproject.com' },
  HOSTED_ZONE_ID: { value: 'Z0123456789ABC' }, // Your Route53 zone ID
  
  // Optional: Add Sentry
  SENTRY_DSN: { value: process.env.SENTRY_DSN || '' },
}
```

---

## Step 5: Test the Pipeline

### Trigger a Build

```bash
# Push to trigger pipeline
git add .
git commit -m "feat: add AWS CodePipeline"
git push origin develop
```

### Monitor the Pipeline

1. **Go to CodePipeline Console**:
   ```
   https://console.aws.amazon.com/codesuite/codepipeline/pipelines
   ```

2. **Click on your pipeline**: `postway-staging-pipeline`

3. **Watch the stages**:
   - ✅ Source (pulls from GitHub)
   - ✅ Build_and_Deploy (runs buildspec.yml)

4. **View logs** in CodeBuild:
   ```
   https://console.aws.amazon.com/codesuite/codebuild/projects
   ```

---

## 🎯 How It Works

### Pipeline Flow

```
GitHub Push → CodePipeline Triggered → CodeBuild Starts
  ↓
Install Dependencies (pnpm install)
  ↓
Run Tests (lint, typecheck, test)
  ↓
Build TypeScript (pnpm build)
  ↓
Run Migrations (pnpm migrate)
  ↓
Deploy CDK Stacks (cdk deploy --all)
  ↓
✅ Deployment Complete!
```

### Build Stages (from buildspec.yml)

1. **Install**: Install Node.js 20, pnpm, dependencies
2. **Pre-build**: Run linter, type check, tests
3. **Build**: Build TypeScript, run migrations, deploy CDK
4. **Post-build**: Log success message

---

## 💰 Cost Estimate

### CodePipeline
- $1/month per active pipeline
- Free tier: 1 pipeline free

### CodeBuild
- $0.005/build minute
- Free tier: 100 build minutes/month
- Average build: 5-10 minutes
- Estimated: ~$5-10/month for moderate usage

**Total**: ~$5-10/month (much cheaper than GitHub Actions for private repos)

---

## 🔒 Security

### IAM Roles (No Credentials Needed!)

The pipeline uses AWS IAM roles, so you don't need to manage credentials:

- ✅ CodeBuild role has admin access (for CDK deployment)
- ✅ Secrets Manager integration (no hardcoded secrets)
- ✅ GitHub connection (OAuth, no tokens)

### Secrets Management

All sensitive data is stored in AWS Secrets Manager:

```typescript
WORKOS_CLIENT_ID: {
  value: `${props.workosSecret.secretArn}:WORKOS_CLIENT_ID::`,
  type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
}
```

---

## 🎨 Customization

### Add More Stages

Edit `pipeline-stack.ts` to add manual approval, testing, etc:

```typescript
stages: [
  { stageName: 'Source', actions: [sourceAction] },
  { stageName: 'Build', actions: [buildAction] },
  { 
    stageName: 'Approve', 
    actions: [new codepipeline_actions.ManualApprovalAction({
      actionName: 'Approve_Deploy',
    })]
  },
  { stageName: 'Deploy', actions: [deployAction] },
]
```

### Add Notifications

Add SNS notifications for pipeline events:

```typescript
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

const topic = new sns.Topic(this, 'PipelineTopic');
topic.addSubscription(new subscriptions.EmailSubscription('your@email.com'));

pipeline.onStateChange('PipelineStateChange', {
  target: new targets.SnsTopic(topic),
});
```

---

## 🆘 Troubleshooting

### Pipeline Fails at Source Stage

**Error**: `Connection is not in AVAILABLE state`

**Fix**: Complete the GitHub connection setup in Step 1

### Build Fails: "Permission Denied"

**Error**: `User is not authorized to perform: cloudformation:CreateStack`

**Fix**: The CodeBuild role needs admin permissions (already configured in pipeline-stack.ts)

### Build Fails: "Secret not found"

**Error**: `Secrets Manager can't find the specified secret`

**Fix**: Create the secrets in Secrets Manager (Step 2)

### Build Timeout

**Error**: `Build timed out after 60 minutes`

**Fix**: Increase timeout in pipeline-stack.ts:

```typescript
const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
  timeout: cdk.Duration.minutes(120), // Increase to 2 hours
  // ...
});
```

---

## 📊 Monitoring

### View Build Logs

```bash
# List recent builds
aws codebuild list-builds-for-project --project-name postway-staging-build

# Get build logs
aws codebuild batch-get-builds --ids <build-id>
```

### CloudWatch Logs

All build logs are automatically sent to CloudWatch:

```
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups
```

Look for: `/aws/codebuild/postway-staging-build`

---

## 🎉 You're Done!

Your AWS-native CI/CD pipeline is ready! Every push to `develop` (or `main` for production) will automatically:

1. ✅ Run tests
2. ✅ Build your code
3. ✅ Deploy to AWS
4. ✅ No secrets management needed!

**Next Steps:**
- Set up production pipeline (same process, different branch)
- Add manual approval for production
- Configure SNS notifications
- Monitor costs in AWS Cost Explorer

---

## 🔗 Useful Links

- **CodePipeline Console**: https://console.aws.amazon.com/codesuite/codepipeline/pipelines
- **CodeBuild Console**: https://console.aws.amazon.com/codesuite/codebuild/projects
- **GitHub Connections**: https://console.aws.amazon.com/codesuite/settings/connections
- **Secrets Manager**: https://console.aws.amazon.com/secretsmanager/home
- **CloudWatch Logs**: https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups
