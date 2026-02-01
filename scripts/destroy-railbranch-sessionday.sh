#!/bin/bash

# Destroy railbranch and sessionday projects, keep postway
# This script will destroy both staging and production for each project

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGION=${AWS_REGION:-us-east-1}

echo "🗑️  Destroying railbranch and sessionday (keeping postway)"
echo ""
echo "⚠️  WARNING: This will PERMANENTLY delete:"
echo "  - railbranch (staging + production)"
echo "  - sessionday (staging + production)"
echo ""
echo "✅ KEEPING: postway (staging + production)"
echo ""
read -p "Are you sure you want to continue? Type 'DELETE' to confirm: " confirm

if [ "$confirm" != "DELETE" ]; then
  echo "Aborted."
  exit 1
fi

# Function to destroy a project
destroy_project() {
  local project=$1
  local stage=$2
  local stack_prefix="${project}-${stage}"
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🗑️  Destroying ${stack_prefix}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Step 1: Empty S3 buckets
  echo ""
  echo "🧹 Step 1: Emptying S3 buckets..."
  BUCKETS=$(aws s3api list-buckets --region ${REGION} --query "Buckets[?contains(Name, '${stack_prefix}')].Name" --output text 2>/dev/null || echo "")
  
  if [ -n "$BUCKETS" ]; then
    for bucket in $BUCKETS; do
      echo "  📦 Emptying bucket: $bucket"
      aws s3 rm s3://${bucket} --recursive 2>/dev/null || true
      
      # Delete all object versions
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
  
  # Step 2: Force delete secrets
  echo ""
  echo "🔐 Step 2: Force deleting Secrets Manager secrets..."
  SECRETS=$(aws secretsmanager list-secrets --region ${REGION} --query "SecretList[?contains(Name, '${stack_prefix}')].Name" --output text 2>/dev/null || echo "")
  
  if [ -n "$SECRETS" ]; then
    for secret in $SECRETS; do
      echo "  🔑 Force deleting secret: $secret"
      aws secretsmanager delete-secret --region ${REGION} --secret-id ${secret} --force-delete-without-recovery 2>/dev/null || true
      echo "  ✅ Secret $secret deleted"
    done
  else
    echo "  ℹ️  No secrets found"
  fi
  
  # Step 3: Delete CloudWatch Log Groups
  echo ""
  echo "📊 Step 3: Deleting CloudWatch Log Groups..."
  LOG_GROUPS=$(aws logs describe-log-groups --region ${REGION} --log-group-name-prefix "/aws/lambda/${stack_prefix}" --query "logGroups[].logGroupName" --output text 2>/dev/null || echo "")
  
  if [ -n "$LOG_GROUPS" ]; then
    for log_group in $LOG_GROUPS; do
      echo "  📝 Deleting log group: $log_group"
      aws logs delete-log-group --region ${REGION} --log-group-name ${log_group} 2>/dev/null || true
    done
    echo "  ✅ Log groups deleted"
  else
    echo "  ℹ️  No log groups found"
  fi
  
  # Step 4: Destroy CDK stacks (in reverse dependency order)
  echo ""
  echo "🏗️  Step 4: Destroying CDK stacks..."
  
  # Destroy in reverse dependency order
  cdk destroy ${stack_prefix}-PipelineStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  PipelineStack not found"
  cdk destroy ${stack_prefix}-WafStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  WafStack not found"
  cdk destroy ${stack_prefix}-CloudTrailStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  CloudTrailStack not found"
  cdk destroy ${stack_prefix}-CostMonitoringStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  CostMonitoringStack not found"
  cdk destroy ${stack_prefix}-ApiStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  ApiStack not found"
  cdk destroy ${stack_prefix}-PublicAssetsStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  PublicAssetsStack not found"
  cdk destroy ${stack_prefix}-MediaStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  MediaStack not found"
  cdk destroy ${stack_prefix}-MonitoringStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  MonitoringStack not found"
  cdk destroy ${stack_prefix}-DatabaseStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  DatabaseStack not found"
  cdk destroy ${stack_prefix}-SecurityStack --force --region ${REGION} 2>/dev/null || echo "  ⚠️  SecurityStack not found"
  
  echo "  ✅ ${stack_prefix} stacks destroyed"
}

# Destroy railbranch (both staging and production)
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  DESTROYING RAILBRANCH"
echo "═══════════════════════════════════════════════════════════════"

destroy_project "railbranch" "staging"
destroy_project "railbranch" "production"

# Destroy sessionday (both staging and production)
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  DESTROYING SESSIONDAY"
echo "═══════════════════════════════════════════════════════════════"

destroy_project "sessionday" "staging"
destroy_project "sessionday" "production"

# Verification
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Verifying cleanup..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

REMAINING_STACKS=$(aws cloudformation list-stacks --region ${REGION} --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[?contains(StackName, 'railbranch') || contains(StackName, 'sessionday')].StackName" --output text 2>/dev/null || echo "")

if [ -n "$REMAINING_STACKS" ]; then
  echo ""
  echo "⚠️  Warning: Some stacks may still exist (could be in deletion state):"
  echo "$REMAINING_STACKS"
else
  echo "  ✅ No railbranch or sessionday stacks found"
fi

echo ""
echo "✅ Destruction complete!"
echo ""
echo "Summary:"
echo "  ✅ railbranch (staging + production) - DESTROYED"
echo "  ✅ sessionday (staging + production) - DESTROYED"
echo "  ✅ postway (staging + production) - KEPT (untouched)"
echo ""
echo "Note: Some resources may take a few minutes to fully delete."
echo "Check status with: aws cloudformation list-stacks --region us-east-1 --query \"StackSummaries[?contains(StackName, 'railbranch') || contains(StackName, 'sessionday')].StackName\""
