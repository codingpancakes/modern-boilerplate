# CDK Complete Teardown Guide

## Quick Commands

### Destroy Everything (No Residuals)
```bash
# For dev environment
./scripts/destroy-all.sh dev

# For staging environment
./scripts/destroy-all.sh staging

# For production environment
./scripts/destroy-all.sh production
```

## What Gets Deleted

The `destroy-all.sh` script performs a **complete cleanup** with NO residuals:

### ✅ Step 1: S3 Buckets
- Empties ALL objects (including versions)
- Deletes all delete markers
- Removes buckets completely

### ✅ Step 2: CloudFront Distributions
- Lists distributions (CDK will delete them)
- Note: Takes 15-30 minutes to fully delete

### ✅ Step 3: Secrets Manager
- **Force deletes** secrets (no recovery window)
- No 7-30 day retention period

### ✅ Step 4: CloudWatch Logs
- Deletes all Lambda log groups
- Removes all log data

### ✅ Step 5: CDK Stacks (in teardown order)
1. `PipelineStack` - CI/CD pipeline (if exists)
2. `ApiStack` - Lambda functions, API Gateway, WAF
3. `PublicAssetsStack` - Public assets S3 + CloudFront
4. `MediaStack` - Images S3 + CloudFront
5. `MonitoringStack` - X-Ray, CloudWatch dashboards
6. `CostMonitoringStack` - AWS Budgets
7. `CloudTrailStack` - CloudTrail + S3 bucket
8. `DatabaseStack` - Migration runner Lambda
9. `SecurityStack` - Secrets Manager, IAM roles

### ✅ Step 6: CDK Metadata
- Removes `cdk.out/` directory
- Cleans up local CDK cache

### ✅ Step 7: Verification
- Checks for any remaining resources
- Reports any residuals that need manual cleanup

## Stacks Deployed

Your current CDK app deploys these stacks:

```
{PROJECT_NAME}-{stage}-SecurityStack
  ├── Secrets Manager: /{PROJECT_NAME}/{stage}/workos
  └── Secrets Manager: /{PROJECT_NAME}/{stage}/database

{PROJECT_NAME}-{stage}-DatabaseStack
  └── Lambda: Migration runner

{PROJECT_NAME}-{stage}-MonitoringStack
  ├── X-Ray tracing
  └── CloudWatch dashboards

{PROJECT_NAME}-{stage}-CostMonitoringStack
  └── AWS Budgets + SNS alerts

{PROJECT_NAME}-{stage}-CloudTrailStack
  └── CloudTrail + S3 bucket with lifecycle

{PROJECT_NAME}-{stage}-MediaStack
  ├── S3 Bucket: images
  ├── CloudFront Distribution
  └── Route53 Record: images-{stage}.{domain}

{PROJECT_NAME}-{stage}-PublicAssetsStack
  ├── S3 Bucket: public assets
  ├── CloudFront Distribution
  └── Route53 Record: assets-{stage}.{domain}

{PROJECT_NAME}-{stage}-ApiStack
  ├── HTTP API Gateway
  ├── Lambda Functions (all handlers)
  ├── WAFv2 WebACL (CloudFront scope)
  ├── Route53 Record: {api-domain}
  └── CloudWatch Log Groups

{PROJECT_NAME}-{stage}-PipelineStack (staging/production only)
  ├── CodePipeline
  ├── CodeBuild
  └── CodeDeploy (blue-green)
```

## Manual Verification

After running the script, verify cleanup:

### Check S3 Buckets
```bash
aws s3 ls | grep {PROJECT_NAME}-dev
# Should return nothing
```

### Check CloudFormation Stacks
```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?contains(StackName, '{PROJECT_NAME}-dev')].StackName"
# Should return empty array
```

### Check Secrets Manager
```bash
aws secretsmanager list-secrets \
  --query "SecretList[?contains(Name, '{PROJECT_NAME}-dev')].Name"
# Should return empty array
```

### Check CloudFront Distributions
```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Comment, '{PROJECT_NAME}-dev')].Id"
# May show distributions in "Deploying" state for 15-30 minutes
```

### Check Lambda Functions
```bash
aws lambda list-functions \
  --query "Functions[?contains(FunctionName, '{PROJECT_NAME}-dev')].FunctionName"
# Should return empty array
```

## Troubleshooting

### S3 Bucket Won't Delete
```bash
# Manually empty and delete
BUCKET_NAME="{PROJECT_NAME}-dev-mediastack-imagesbucket-xxxxx"
aws s3 rm s3://${BUCKET_NAME} --recursive
aws s3 rb s3://${BUCKET_NAME} --force
```

### CloudFront Distribution Stuck
```bash
# Check status
aws cloudfront get-distribution --id DISTRIBUTION_ID

# Wait for it to finish deploying, then:
aws cloudfront delete-distribution --id DISTRIBUTION_ID --if-match ETAG
```

### Secret Still Exists
```bash
# Force delete without recovery
aws secretsmanager delete-secret \
  --secret-id "/{PROJECT_NAME}/dev/workos" \
  --force-delete-without-recovery
```

### Stack Deletion Failed
```bash
# Check stack events for errors
aws cloudformation describe-stack-events \
  --stack-name {PROJECT_NAME}-dev-ApiStack \
  --max-items 20

# Force delete (dangerous - may leave resources)
aws cloudformation delete-stack --stack-name {PROJECT_NAME}-dev-ApiStack
```

## After Cleanup

Once everything is destroyed, you can redeploy using your existing deployment method:

```bash
# For staging
pnpm deploy:staging

# For production
pnpm deploy:production
```

## Cost Savings

After complete teardown, you'll have **ZERO AWS costs** for:
- ✅ Lambda invocations
- ✅ API Gateway requests
- ✅ S3 storage
- ✅ CloudFront data transfer
- ✅ CloudWatch logs storage
- ✅ Secrets Manager secrets

Only the **Neon database** (external) will continue to incur costs if you keep it running.

## Emergency: Delete Everything Immediately

If you need to delete everything RIGHT NOW without confirmation:

```bash
# WARNING: NO CONFIRMATION PROMPT
export STAGE=dev
export PROJECT_NAME=railbranch   # or your PROJECT_NAME
export STACK_PREFIX="${PROJECT_NAME}-${STAGE}"

# Empty all buckets
for bucket in $(aws s3api list-buckets --query "Buckets[?contains(Name, '${STACK_PREFIX}')].Name" --output text); do
  aws s3 rm s3://${bucket} --recursive
done

# Delete all stacks
cdk destroy --all --force

# Force delete all secrets
for secret in $(aws secretsmanager list-secrets --query "SecretList[?contains(Name, '${STACK_PREFIX}')].Name" --output text); do
  aws secretsmanager delete-secret --secret-id ${secret} --force-delete-without-recovery
done
```
