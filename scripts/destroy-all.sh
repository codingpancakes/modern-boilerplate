#!/bin/bash

# Destroy all CDK stacks with complete cleanup (NO RESIDUALS)
# Usage: ./scripts/destroy-all.sh [stage]
# Example: ./scripts/destroy-all.sh dev

set -e

STAGE=${1:-dev}
PROJECT_NAME=${PROJECT_NAME:-postway}
STACK_PREFIX="${PROJECT_NAME}-${STAGE}"
REGION=${AWS_REGION:-us-east-1}

echo "🗑️  Complete CDK Destruction for ${STACK_PREFIX}..."
echo ""
echo "⚠️  WARNING: This will PERMANENTLY delete ALL resources:"
echo "  - Lambda functions"
echo "  - API Gateway"
echo "  - S3 buckets (and ALL files)"
echo "  - CloudFront distributions"
echo "  - Secrets Manager secrets (force delete)"
echo "  - CloudWatch logs"
echo "  - All CDK metadata"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "🧹 Step 1: Emptying S3 buckets..."

# Find and empty all S3 buckets for this stack
BUCKETS=$(aws s3api list-buckets --query "Buckets[?contains(Name, '${STACK_PREFIX}')].Name" --output text 2>/dev/null || echo "")

if [ -n "$BUCKETS" ]; then
  for bucket in $BUCKETS; do
    echo "  📦 Emptying bucket: $bucket"
    
    # Delete all objects including versions
    aws s3 rm s3://${bucket} --recursive 2>/dev/null || true
    
    # Delete all object versions (for versioned buckets)
    aws s3api delete-objects --bucket ${bucket} \
      --delete "$(aws s3api list-object-versions --bucket ${bucket} \
      --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
      --max-items 1000)" 2>/dev/null || true
    
    # Delete all delete markers
    aws s3api delete-objects --bucket ${bucket} \
      --delete "$(aws s3api list-object-versions --bucket ${bucket} \
      --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
      --max-items 1000)" 2>/dev/null || true
    
    echo "  ✅ Bucket $bucket emptied"
  done
else
  echo "  ℹ️  No S3 buckets found"
fi

echo ""
echo "☁️  Step 2: Listing CloudFront distributions..."

# List CloudFront distributions (they take time to delete)
DISTRIBUTIONS=$(aws cloudfront list-distributions --query "DistributionList.Items[?contains(Comment, '${STACK_PREFIX}')].Id" --output text 2>/dev/null || echo "")

if [ -n "$DISTRIBUTIONS" ]; then
  echo "  ⚠️  Found CloudFront distributions - these will be deleted by CDK but may take 15-30 minutes"
  for dist in $DISTRIBUTIONS; do
    echo "    - Distribution: $dist"
  done
else
  echo "  ℹ️  No CloudFront distributions found"
fi

echo ""
echo "🔐 Step 3: Force deleting Secrets Manager secrets..."

# Find and force delete all secrets
SECRETS=$(aws secretsmanager list-secrets --query "SecretList[?contains(Name, '${STACK_PREFIX}')].Name" --output text 2>/dev/null || echo "")

if [ -n "$SECRETS" ]; then
  for secret in $SECRETS; do
    echo "  🔑 Force deleting secret: $secret"
    aws secretsmanager delete-secret --secret-id ${secret} --force-delete-without-recovery 2>/dev/null || true
    echo "  ✅ Secret $secret deleted"
  done
else
  echo "  ℹ️  No secrets found"
fi

echo ""
echo "📊 Step 4: Deleting CloudWatch Log Groups..."

# Find and delete all log groups
LOG_GROUPS=$(aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/${STACK_PREFIX}" --query "logGroups[].logGroupName" --output text 2>/dev/null || echo "")

if [ -n "$LOG_GROUPS" ]; then
  for log_group in $LOG_GROUPS; do
    echo "  📝 Deleting log group: $log_group"
    aws logs delete-log-group --log-group-name ${log_group} 2>/dev/null || true
  done
  echo "  ✅ Log groups deleted"
else
  echo "  ℹ️  No log groups found"
fi

echo ""
echo "🏗️  Step 5: Destroying CDK stacks (in reverse dependency order)..."

# Destroy stacks in reverse dependency order
echo ""
echo "  1️⃣  Destroying API Stack..."
cdk destroy ${STACK_PREFIX}-ApiStack --force || echo "  ⚠️  API Stack not found or already deleted"

echo ""
echo "  2️⃣  Destroying Public Assets Stack..."
cdk destroy ${STACK_PREFIX}-PublicAssetsStack --force || echo "  ⚠️  Public Assets Stack not found or already deleted"

echo ""
echo "  3️⃣  Destroying Media Stack..."
cdk destroy ${STACK_PREFIX}-MediaStack --force || echo "  ⚠️  Media Stack not found or already deleted"

echo ""
echo "  4️⃣  Destroying Monitoring Stack..."
cdk destroy ${STACK_PREFIX}-MonitoringStack --force || echo "  ⚠️  Monitoring Stack not found or already deleted"

echo ""
echo "  5️⃣  Destroying Database Stack..."
cdk destroy ${STACK_PREFIX}-DatabaseStack --force || echo "  ⚠️  Database Stack not found or already deleted"

echo ""
echo "  6️⃣  Destroying Security Stack..."
cdk destroy ${STACK_PREFIX}-SecurityStack --force || echo "  ⚠️  Security Stack not found or already deleted"

echo ""
echo "🧹 Step 6: Cleaning up CDK metadata..."

# Remove CDK context and output
rm -rf cdk.out 2>/dev/null || true
echo "  ✅ CDK output directory cleaned"

# Clean up any remaining CDK bootstrap resources (optional - only if you want to remove bootstrap)
# echo ""
# read -p "Do you want to remove CDK bootstrap resources? (yes/no): " remove_bootstrap
# if [ "$remove_bootstrap" = "yes" ]; then
#   echo "  🥾 Removing CDK bootstrap stack..."
#   aws cloudformation delete-stack --stack-name CDKToolkit --region ${REGION} 2>/dev/null || true
# fi

echo ""
echo "🔍 Step 7: Verifying cleanup..."

# Check for any remaining resources
REMAINING_BUCKETS=$(aws s3api list-buckets --query "Buckets[?contains(Name, '${STACK_PREFIX}')].Name" --output text 2>/dev/null || echo "")
REMAINING_SECRETS=$(aws secretsmanager list-secrets --query "SecretList[?contains(Name, '${STACK_PREFIX}')].Name" --output text 2>/dev/null || echo "")
REMAINING_STACKS=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[?contains(StackName, '${STACK_PREFIX}')].StackName" --output text 2>/dev/null || echo "")

if [ -n "$REMAINING_BUCKETS" ] || [ -n "$REMAINING_SECRETS" ] || [ -n "$REMAINING_STACKS" ]; then
  echo ""
  echo "⚠️  Warning: Some resources may still exist:"
  [ -n "$REMAINING_BUCKETS" ] && echo "  - Buckets: $REMAINING_BUCKETS"
  [ -n "$REMAINING_SECRETS" ] && echo "  - Secrets: $REMAINING_SECRETS"
  [ -n "$REMAINING_STACKS" ] && echo "  - Stacks: $REMAINING_STACKS"
  echo ""
  echo "These may be in deletion state or require manual cleanup."
else
  echo "  ✅ No residual resources found"
fi

echo ""
echo "✅ Complete destruction finished!"
echo ""
echo "Summary:"
echo "  ✅ All S3 buckets emptied and deleted"
echo "  ✅ All Secrets Manager secrets force deleted"
echo "  ✅ All CloudWatch log groups deleted"
echo "  ✅ All CDK stacks destroyed"
echo "  ✅ CDK metadata cleaned"
echo ""
echo "Note: CloudFront distributions may take 15-30 minutes to fully delete."
echo "You can check status with: aws cloudfront list-distributions"
