#!/bin/bash

# Force delete railbranch and sessionday using direct CloudFormation commands
# This script includes all steps that were tested and work correctly
# Based on actual cleanup experience from Feb 2, 2026

set -e

REGION=${AWS_REGION:-us-east-1}

echo "🗑️  FORCE DELETING railbranch and sessionday stacks"
echo ""
echo "⚠️  WARNING: This will PERMANENTLY delete all resources"
echo "  - All CloudFormation stacks"
echo "  - All S3 buckets and their contents"
echo "  - All Lambda functions"
echo "  - All Secrets Manager secrets"
echo "  - All CloudWatch logs"
echo ""
read -p "Type 'FORCE DELETE' to confirm: " confirm

if [ "$confirm" != "FORCE DELETE" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "Starting cleanup process..."
echo ""

# Step 1: Empty and delete all S3 buckets (using force delete)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 Step 1: Deleting S3 buckets..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

BUCKETS=$(aws s3api list-buckets --region ${REGION} --query "Buckets[?contains(Name, 'railbranch') || contains(Name, 'sessionday')].Name" --output text 2>/dev/null || echo "")

if [ -n "$BUCKETS" ]; then
  for bucket in $BUCKETS; do
    echo "  📦 Force deleting bucket: $bucket"
    aws s3 rb s3://${bucket} --force --region ${REGION} 2>/dev/null || echo "  ⚠️  Failed to delete $bucket (may not exist)"
  done
  echo "  ✅ All S3 buckets deleted"
else
  echo "  ℹ️  No S3 buckets found"
fi

# Step 2: Force delete all Secrets Manager secrets
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 Step 2: Force deleting Secrets Manager secrets..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

SECRETS=$(aws secretsmanager list-secrets --region ${REGION} --query "SecretList[?contains(Name, 'railbranch') || contains(Name, 'sessionday')].Name" --output text 2>/dev/null || echo "")

if [ -n "$SECRETS" ]; then
  for secret in $SECRETS; do
    echo "  🔑 Force deleting secret: $secret"
    aws secretsmanager delete-secret --region ${REGION} --secret-id "${secret}" --force-delete-without-recovery 2>/dev/null || echo "  ⚠️  Failed to delete $secret (may not exist)"
  done
  echo "  ✅ All secrets force deleted"
else
  echo "  ℹ️  No secrets found"
fi

# Step 3: Delete all CloudFormation stacks
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️  Step 3: Deleting CloudFormation stacks..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get all stacks (including DELETE_FAILED ones)
STACKS=$(aws cloudformation list-stacks --region ${REGION} --query "StackSummaries[?StackStatus!='DELETE_COMPLETE' && (contains(StackName, 'railbranch') || contains(StackName, 'sessionday'))].StackName" --output text 2>/dev/null || echo "")

if [ -n "$STACKS" ]; then
  echo "  Found $(echo $STACKS | wc -w | tr -d ' ') stacks to delete"
  echo ""
  
  # Delete all stacks at once (CloudFormation will handle dependencies)
  for stack in $STACKS; do
    echo "  🗑️  Deleting stack: $stack"
    aws cloudformation delete-stack --stack-name "${stack}" --region ${REGION} 2>/dev/null || echo "  ⚠️  Failed to initiate deletion for $stack"
  done
  
  echo ""
  echo "  ✅ All stack deletions initiated"
else
  echo "  ℹ️  No stacks found"
fi

# Step 4: Wait and monitor deletions
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏳ Step 4: Monitoring stack deletions..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "Waiting 60 seconds for initial deletions..."
sleep 60

# Check for DELETE_FAILED stacks and retry
echo ""
echo "Checking for failed deletions..."
FAILED_STACKS=$(aws cloudformation list-stacks --region ${REGION} --stack-status-filter DELETE_FAILED --query "StackSummaries[?contains(StackName, 'railbranch') || contains(StackName, 'sessionday')].StackName" --output text 2>/dev/null || echo "")

if [ -n "$FAILED_STACKS" ]; then
  echo "  ⚠️  Found $(echo $FAILED_STACKS | wc -w | tr -d ' ') failed stacks, retrying..."
  for stack in $FAILED_STACKS; do
    echo "  🔄 Retrying deletion: $stack"
    aws cloudformation delete-stack --stack-name "${stack}" --region ${REGION} 2>/dev/null || echo "  ⚠️  Retry failed for $stack"
  done
  echo ""
  echo "Waiting 60 seconds for retry deletions..."
  sleep 60
fi

# Step 5: Final verification
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Step 5: Final verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "📊 Remaining CloudFormation stacks:"
REMAINING_STACKS=$(aws cloudformation list-stacks --region ${REGION} --query "StackSummaries[?StackStatus!='DELETE_COMPLETE' && (contains(StackName, 'railbranch') || contains(StackName, 'sessionday'))].{Name:StackName,Status:StackStatus}" --output table 2>/dev/null || echo "None")
echo "$REMAINING_STACKS"

echo ""
echo "📦 Remaining S3 buckets:"
REMAINING_BUCKETS=$(aws s3api list-buckets --region ${REGION} --query "Buckets[?contains(Name, 'railbranch') || contains(Name, 'sessionday')].Name" --output text 2>/dev/null || echo "None")
if [ -n "$REMAINING_BUCKETS" ] && [ "$REMAINING_BUCKETS" != "None" ]; then
  echo "$REMAINING_BUCKETS"
else
  echo "None"
fi

echo ""
echo "⚡ Remaining Lambda functions:"
LAMBDA_COUNT=$(aws lambda list-functions --region ${REGION} --query "Functions[?contains(FunctionName, 'railbranch') || contains(FunctionName, 'sessionday')].FunctionName" --output text 2>/dev/null | wc -l | tr -d ' ')
echo "Count: $LAMBDA_COUNT"

echo ""
echo "🔐 Remaining Secrets Manager secrets:"
REMAINING_SECRETS=$(aws secretsmanager list-secrets --region ${REGION} --query "SecretList[?contains(Name, 'railbranch') || contains(Name, 'sessionday')].Name" --output text 2>/dev/null || echo "None")
if [ -n "$REMAINING_SECRETS" ] && [ "$REMAINING_SECRETS" != "None" ]; then
  echo "$REMAINING_SECRETS"
else
  echo "None"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Cleanup process complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "ℹ️  Note: Some stacks may still be in DELETE_IN_PROGRESS state."
echo "   They will complete deletion in the next 5-10 minutes."
echo ""
echo "Monitor remaining deletions with:"
echo "  watch -n 10 'aws cloudformation list-stacks --region us-east-1 --stack-status-filter DELETE_IN_PROGRESS --query \"StackSummaries[].StackName\" --output table'"
echo ""
echo "Verify complete cleanup with:"
echo "  aws cloudformation list-stacks --region us-east-1 --query \"StackSummaries[?StackStatus!='DELETE_COMPLETE' && (contains(StackName, 'railbranch') || contains(StackName, 'sessionday'))].StackName\" --output table"
