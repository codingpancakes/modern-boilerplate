#!/bin/bash

# Verify Monitoring Setup
# Usage: ./scripts/verify-monitoring.sh [staging|production]

set -e

STAGE=${1:-staging}
REGION=${AWS_REGION:-us-east-1}

echo "🔍 Verifying Monitoring Setup for $STAGE"
echo "Region: $REGION"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "❌ AWS CLI is not installed"
  echo "Install: https://aws.amazon.com/cli/"
  exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
  echo "❌ AWS credentials not configured"
  echo "Run: aws configure"
  exit 1
fi

echo "✅ AWS CLI configured"
echo ""

# 1. Check CloudWatch Alarms
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  Checking CloudWatch Alarms"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ALARM_PREFIX="postway-$STAGE"

# Get all alarms
ALARMS=$(aws cloudwatch describe-alarms \
  --alarm-name-prefix "$ALARM_PREFIX" \
  --region "$REGION" \
  --query 'MetricAlarms[*].[AlarmName,StateValue]' \
  --output text 2>/dev/null || echo "")

if [ -z "$ALARMS" ]; then
  echo "⚠️  No alarms found with prefix: $ALARM_PREFIX"
  echo ""
  echo "💡 Alarms may not be created yet. This is normal if:"
  echo "   - First deployment"
  echo "   - Monitoring stack not deployed"
  echo "   - Different alarm naming convention"
else
  echo "📊 Alarm Status:"
  echo ""
  
  OK_COUNT=0
  ALARM_COUNT=0
  INSUFFICIENT_COUNT=0
  
  while IFS=$'\t' read -r name state; do
    case $state in
      OK)
        echo "   ✅ $name: OK"
        ((OK_COUNT++))
        ;;
      ALARM)
        echo "   🔴 $name: ALARM"
        ((ALARM_COUNT++))
        ;;
      INSUFFICIENT_DATA)
        echo "   ⚪ $name: INSUFFICIENT_DATA"
        ((INSUFFICIENT_COUNT++))
        ;;
      *)
        echo "   ❓ $name: $state"
        ;;
    esac
  done <<< "$ALARMS"
  
  echo ""
  echo "📈 Summary:"
  echo "   OK: $OK_COUNT"
  echo "   ALARM: $ALARM_COUNT"
  echo "   INSUFFICIENT_DATA: $INSUFFICIENT_COUNT"
  echo ""
  
  if [ "$ALARM_COUNT" -gt 0 ]; then
    echo "⚠️  WARNING: $ALARM_COUNT alarm(s) in ALARM state!"
    echo "   Check CloudWatch console for details."
  else
    echo "✅ All alarms are OK or have insufficient data"
  fi
fi

echo ""

# 2. Check CloudWatch Dashboard
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  Checking CloudWatch Dashboard"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DASHBOARD_NAME="postway-$STAGE-dashboard"

DASHBOARD=$(aws cloudwatch get-dashboard \
  --dashboard-name "$DASHBOARD_NAME" \
  --region "$REGION" 2>/dev/null || echo "")

if [ -z "$DASHBOARD" ]; then
  echo "⚠️  Dashboard not found: $DASHBOARD_NAME"
  echo ""
  echo "💡 Create dashboard in CloudWatch console or via CDK"
else
  echo "✅ Dashboard exists: $DASHBOARD_NAME"
  echo ""
  echo "🔗 View dashboard:"
  echo "   https://console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards:name=$DASHBOARD_NAME"
fi

echo ""

# 3. Check Lambda Functions
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  Checking Lambda Functions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FUNCTION_PREFIX="postway-$STAGE"

FUNCTIONS=$(aws lambda list-functions \
  --region "$REGION" \
  --query "Functions[?starts_with(FunctionName, '$FUNCTION_PREFIX')].FunctionName" \
  --output text 2>/dev/null || echo "")

if [ -z "$FUNCTIONS" ]; then
  echo "⚠️  No Lambda functions found with prefix: $FUNCTION_PREFIX"
else
  FUNCTION_COUNT=$(echo "$FUNCTIONS" | wc -w | tr -d ' ')
  echo "📊 Found $FUNCTION_COUNT Lambda functions"
  echo ""
  
  # Check X-Ray tracing
  TRACING_ENABLED=0
  TRACING_DISABLED=0
  
  for func in $FUNCTIONS; do
    TRACING=$(aws lambda get-function-configuration \
      --function-name "$func" \
      --region "$REGION" \
      --query 'TracingConfig.Mode' \
      --output text 2>/dev/null || echo "")
    
    if [ "$TRACING" = "Active" ]; then
      ((TRACING_ENABLED++))
    else
      ((TRACING_DISABLED++))
    fi
  done
  
  echo "🔍 X-Ray Tracing:"
  echo "   Enabled: $TRACING_ENABLED"
  echo "   Disabled: $TRACING_DISABLED"
  echo ""
  
  if [ "$TRACING_DISABLED" -gt 0 ]; then
    echo "⚠️  Some functions don't have X-Ray tracing enabled"
  else
    echo "✅ All functions have X-Ray tracing enabled"
  fi
fi

echo ""

# 4. Check API Gateway
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  Checking API Gateway"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Find API Gateway by name
API_NAME="postway-$STAGE-api"

API_ID=$(aws apigatewayv2 get-apis \
  --region "$REGION" \
  --query "Items[?Name=='$API_NAME'].ApiId" \
  --output text 2>/dev/null || echo "")

if [ -z "$API_ID" ]; then
  echo "⚠️  API Gateway not found: $API_NAME"
else
  echo "✅ API Gateway found: $API_NAME"
  echo "   API ID: $API_ID"
  echo ""
  
  # Check throttling settings
  STAGE_NAME="\$default"
  
  THROTTLE=$(aws apigatewayv2 get-stage \
    --api-id "$API_ID" \
    --stage-name "$STAGE_NAME" \
    --region "$REGION" \
    --query 'DefaultRouteSettings.ThrottlingRateLimit' \
    --output text 2>/dev/null || echo "")
  
  BURST=$(aws apigatewayv2 get-stage \
    --api-id "$API_ID" \
    --stage-name "$STAGE_NAME" \
    --region "$REGION" \
    --query 'DefaultRouteSettings.ThrottlingBurstLimit' \
    --output text 2>/dev/null || echo "")
  
  if [ -n "$THROTTLE" ] && [ "$THROTTLE" != "None" ]; then
    echo "🚦 Throttling Settings:"
    echo "   Rate Limit: $THROTTLE requests/second"
    echo "   Burst Limit: $BURST requests"
    echo ""
    echo "✅ Throttling is configured"
  else
    echo "⚠️  Throttling settings not found"
    echo "   This might be normal for HTTP API v2"
  fi
fi

echo ""

# 5. Check SNS Topic for Alarms
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  Checking SNS Alarm Topic"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

TOPIC_NAME="postway-$STAGE-alarms"

TOPIC_ARN=$(aws sns list-topics \
  --region "$REGION" \
  --query "Topics[?contains(TopicArn, '$TOPIC_NAME')].TopicArn" \
  --output text 2>/dev/null || echo "")

if [ -z "$TOPIC_ARN" ]; then
  echo "⚠️  SNS topic not found: $TOPIC_NAME"
else
  echo "✅ SNS topic exists: $TOPIC_NAME"
  echo "   ARN: $TOPIC_ARN"
  echo ""
  
  # Check subscriptions
  SUBS=$(aws sns list-subscriptions-by-topic \
    --topic-arn "$TOPIC_ARN" \
    --region "$REGION" \
    --query 'Subscriptions[*].[Protocol,Endpoint]' \
    --output text 2>/dev/null || echo "")
  
  if [ -z "$SUBS" ]; then
    echo "⚠️  No subscriptions configured"
    echo ""
    echo "💡 Add email subscription:"
    echo "   aws sns subscribe \\"
    echo "     --topic-arn $TOPIC_ARN \\"
    echo "     --protocol email \\"
    echo "     --notification-endpoint your-email@example.com"
  else
    echo "📧 Subscriptions:"
    while IFS=$'\t' read -r protocol endpoint; do
      echo "   $protocol: $endpoint"
    done <<< "$SUBS"
  fi
fi

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Verification Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CHECKS_PASSED=0
CHECKS_FAILED=0

# Count checks
if [ -n "$ALARMS" ]; then
  echo "✅ CloudWatch Alarms configured"
  ((CHECKS_PASSED++))
else
  echo "⚠️  CloudWatch Alarms not found"
  ((CHECKS_FAILED++))
fi

if [ -n "$DASHBOARD" ]; then
  echo "✅ CloudWatch Dashboard exists"
  ((CHECKS_PASSED++))
else
  echo "⚠️  CloudWatch Dashboard not found"
  ((CHECKS_FAILED++))
fi

if [ -n "$FUNCTIONS" ]; then
  echo "✅ Lambda Functions deployed"
  ((CHECKS_PASSED++))
else
  echo "⚠️  Lambda Functions not found"
  ((CHECKS_FAILED++))
fi

if [ -n "$API_ID" ]; then
  echo "✅ API Gateway configured"
  ((CHECKS_PASSED++))
else
  echo "⚠️  API Gateway not found"
  ((CHECKS_FAILED++))
fi

if [ -n "$TOPIC_ARN" ]; then
  echo "✅ SNS Alarm Topic exists"
  ((CHECKS_PASSED++))
else
  echo "⚠️  SNS Alarm Topic not found"
  ((CHECKS_FAILED++))
fi

echo ""
echo "Score: $CHECKS_PASSED/5 checks passed"
echo ""

if [ "$CHECKS_PASSED" -eq 5 ]; then
  echo "🎉 All monitoring components are configured!"
elif [ "$CHECKS_PASSED" -ge 3 ]; then
  echo "✅ Core monitoring is working"
  echo "💡 Some optional components are missing"
else
  echo "⚠️  Several monitoring components are missing"
  echo "💡 Check your CDK deployment"
fi

echo ""
echo "🔗 Useful Links:"
echo "   CloudWatch Console: https://console.aws.amazon.com/cloudwatch/home?region=$REGION"
echo "   X-Ray Console: https://console.aws.amazon.com/xray/home?region=$REGION"
echo "   Lambda Console: https://console.aws.amazon.com/lambda/home?region=$REGION"
echo ""
echo "✅ Verification complete!"
