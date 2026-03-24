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

### ✅ Step 5: CDK Stacks (in order)
1. `ApiStack` - Lambda functions, API Gateway
2. `PublicAssetsStack` - Public assets S3 + CloudFront
3. `MediaStack` - Images S3 + CloudFront
4. `MonitoringStack` - X-Ray, CloudWatch dashboards
5. `DatabaseStack` - Migration runner Lambda
6. `SecurityStack` - Secrets Manager (if not already deleted)

### ✅ Step 6: CDK Metadata
- Removes `cdk.out/` directory
- Cleans up local CDK cache

### ✅ Step 7: Verification
- Checks for any remaining resources
- Reports any residuals that need manual cleanup

## Stacks Deployed

Your current CDK app deploys these stacks:

```
postway-{stage}-SecurityStack
  ├── Secrets Manager: workos-api-key
  └── Secrets Manager: database-url

postway-{stage}-DatabaseStack
  └── Lambda: Migration runner

postway-{stage}-MonitoringStack
  ├── X-Ray tracing
  └── CloudWatch dashboards

postway-{stage}-MediaStack
  ├── S3 Bucket: images
  ├── CloudFront Distribution
  └── Route53 Record: images-{stage}.postway.services

postway-{stage}-PublicAssetsStack
  ├── S3 Bucket: public assets
  ├── CloudFront Distribution
  └── Route53 Record: assets-{stage}.postway.services

postway-{stage}-ApiStack
  ├── HTTP API Gateway
  ├── Lambda Functions (all handlers)
  ├── Route53 Record: api-{stage}.postway.services
  └── CloudWatch Log Groups
```

## Manual Verification

After running the script, verify cleanup:

### Check S3 Buckets
```bash
aws s3 ls | grep postway-dev
# Should return nothing
```

### Check CloudFormation Stacks
```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?contains(StackName, 'postway-dev')].StackName"
# Should return empty array
```

### Check Secrets Manager
```bash
aws secretsmanager list-secrets \
  --query "SecretList[?contains(Name, 'postway-dev')].Name"
# Should return empty array
```

### Check CloudFront Distributions
```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Comment, 'postway-dev')].Id"
# May show distributions in "Deploying" state for 15-30 minutes
```

### Check Lambda Functions
```bash
aws lambda list-functions \
  --query "Functions[?contains(FunctionName, 'postway-dev')].FunctionName"
# Should return empty array
```

## Troubleshooting

### S3 Bucket Won't Delete
```bash
# Manually empty and delete
BUCKET_NAME="postway-dev-mediastack-imagesbucket-xxxxx"
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
  --secret-id postway-dev-workos-api-key \
  --force-delete-without-recovery
```

### Stack Deletion Failed
```bash
# Check stack events for errors
aws cloudformation describe-stack-events \
  --stack-name postway-dev-ApiStack \
  --max-items 20

# Force delete (dangerous - may leave resources)
aws cloudformation delete-stack --stack-name postway-dev-ApiStack
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
export PROJECT_NAME=postway
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
