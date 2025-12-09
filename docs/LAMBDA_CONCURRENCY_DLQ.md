# Lambda Concurrency & Dead Letter Queues

**Implemented:** December 9, 2025  
**Status:** Production-Ready

---

## 🎯 **Reserved Concurrency Limits**

### **What It Does**
Limits how many instances of each Lambda function can run simultaneously, protecting your database from connection exhaustion and preventing runaway costs.

### **Implementation**

| Handler Type | Concurrency | Rationale |
|-------------|-------------|-----------|
| **GraphQL** | 30 | Primary API, high traffic expected |
| **User Endpoints** (`/v1/users/me`) | 30 | User-facing, high traffic |
| **Media Operations** (`/v1/media/*`) | 20 | Moderate traffic, S3 operations |
| **Webhooks** (`/v1/webhooks/*`) | 10 | Background processing, can queue |
| **CORS Preflight** (`OPTIONS`) | 10 | Utility endpoint |
| **Health Checks** (`/v1/health`) | 5 | Low traffic, monitoring only |
| **GraphQL Docs** (`/graphql/docs`) | 5 | Low traffic, developer tool |

**Total Reserved:** ~140 concurrent executions  
**AWS Account Limit:** 1,000 concurrent executions (default)  
**Remaining Capacity:** 860 for future handlers

---

## 💀 **Dead Letter Queue (DLQ)**

### **What It Does**
Captures failed Lambda invocations for debugging and manual replay. Critical for webhooks where events can't be replayed by external systems.

### **Implementation**

**Queue Name:** `{PROJECT_NAME}-{STAGE}-webhook-dlq`  
**Retention:** 14 days  
**Encryption:** SQS-managed  
**Attached To:** WorkOS webhook handler

### **Why Only Webhooks?**

| Endpoint Type | DLQ Needed? | Reason |
|--------------|-------------|---------|
| **Webhooks** | ✅ Yes | External events can't be replayed |
| **API Endpoints** | ❌ No | Clients can retry failed requests |
| **Health Checks** | ❌ No | Failures don't matter |
| **GraphQL** | ❌ No | Clients handle retries |

---

## 📊 **Monitoring**

### **CloudWatch Metrics to Watch**

```bash
# Check for throttled requests
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Throttles \
  --dimensions Name=FunctionName,Value=your-function-name \
  --start-time 2025-12-09T00:00:00Z \
  --end-time 2025-12-09T23:59:59Z \
  --period 3600 \
  --statistics Sum

# Check DLQ message count
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/webhook-dlq \
  --attribute-names ApproximateNumberOfMessages
```

### **Alerts to Set Up**

1. **Throttles > 0** → Increase concurrency limit
2. **DLQ Messages > 0** → Webhook handler failing, investigate
3. **Duration increasing** → May need more concurrency or optimization

---

## 🔧 **Adjusting Limits**

### **When to Increase Concurrency**

- **Throttles metric > 0** in CloudWatch
- **API latency increasing** during peak traffic
- **User complaints** about slow responses

### **When to Decrease Concurrency**

- **Database connection errors** (`too many connections`)
- **Cost concerns** (more concurrency = more cost)
- **Downstream service rate limits** being hit

### **How to Adjust**

```typescript
// In route-builder.ts or specific route files
const handler = routeBuilder.createHandler({
  name: "HandlerName",
  path: "handlers/path.ts",
  reservedConcurrentExecutions: 50, // Increase from 30
});
```

Then redeploy:
```bash
pnpm deploy:staging  # Test first
pnpm deploy:production  # After validation
```

---

## 🐛 **Debugging Failed Webhooks**

### **1. Check DLQ for Messages**

```bash
# Get messages from DLQ
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/webhook-dlq \
  --max-number-of-messages 10
```

### **2. Inspect Message Content**

```json
{
  "requestContext": { ... },
  "body": "{ webhook payload }",
  "errorMessage": "Database connection failed",
  "errorType": "Error",
  "stackTrace": [ ... ]
}
```

### **3. Fix Bug & Manually Replay**

```bash
# After fixing the bug, replay the event
aws lambda invoke \
  --function-name your-webhook-handler \
  --payload file://failed-event.json \
  response.json
```

### **4. Purge DLQ After Resolution**

```bash
aws sqs purge-queue \
  --queue-url https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/webhook-dlq
```

---

## 💰 **Cost Impact**

### **Reserved Concurrency**
- **No additional cost** - you're just limiting what you already pay for
- **Benefit:** Prevents runaway costs from infinite loops or DDoS

### **DLQ (SQS)**
- **Free Tier:** 1 million requests/month
- **After Free Tier:** $0.40 per million requests
- **Storage:** $0.40 per GB-month
- **Expected Cost:** < $1/month (webhooks are infrequent)

---

## ✅ **Benefits**

### **Reserved Concurrency**
- ✅ **Database Protection** - Prevents connection exhaustion
- ✅ **Cost Control** - Limits maximum spend
- ✅ **Fair Allocation** - Critical handlers get priority
- ✅ **Predictable Performance** - No sudden spikes

### **Dead Letter Queue**
- ✅ **Zero Data Loss** - Failed events are captured
- ✅ **Debugging** - See exactly what failed and why
- ✅ **Manual Replay** - Reprocess after bug fixes
- ✅ **Monitoring** - Alert when DLQ has messages

---

## 📚 **References**

- [AWS Lambda Reserved Concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- [AWS Lambda DLQ](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html#invocation-dlq)
- [SQS Pricing](https://aws.amazon.com/sqs/pricing/)

---

**Status:** Implemented and production-ready! 🚀
