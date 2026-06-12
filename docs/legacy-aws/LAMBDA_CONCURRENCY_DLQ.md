> **LEGACY** — described the pre-atomic AWS stack; superseded by [docs/CLOUDFLARE_SETUP.md](../CLOUDFLARE_SETUP.md).

# Lambda Concurrency & Dead Letter Queues

**Last Updated:** March 2026  
**Status:** Production-Ready

---

## Lambda Concurrency

### **Current Approach: Unreserved Pool**

All Lambda handlers use the **unreserved concurrency pool** (no `reservedConcurrentExecutions` set). This means Lambda automatically allocates concurrency from the account-wide pool as needed.

**AWS Account Limit:** 1,000 concurrent executions (default, adjustable via support)

**Why unreserved:**
- Simpler to manage — no risk of one handler starving another
- AWS Lambda handles burst scaling automatically
- Reserved concurrency can be re-introduced per-handler if traffic patterns require it

### **When to Add Reserved Concurrency**

Consider adding `reservedConcurrentExecutions` to a handler if:
- Database connection exhaustion occurs (`too many connections`)
- A single handler is consuming all account concurrency
- You need guaranteed capacity for a critical handler

```typescript
// In route-builder.ts or specific route files
const handler = routeBuilder.createHandler({
  name: "HandlerName",
  path: "handlers/path.ts",
  reservedConcurrentExecutions: 50,
});
```

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
  --start-time $(date -u -v-1d '+%Y-%m-%dT00:00:00Z') \
  --end-time $(date -u '+%Y-%m-%dT23:59:59Z') \
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

## Monitoring Concurrency

### **Key CloudWatch Metrics**

- **ConcurrentExecutions** — how many Lambda instances are running simultaneously
- **Throttles** — requests that were rejected due to concurrency limits
- **Duration** — if increasing, may indicate concurrency pressure

### **When to Act**

- **Throttles > 0** — consider reserved concurrency or requesting a higher account limit
- **Database connection errors** — add reserved concurrency to limit concurrent DB connections
- **Cost concerns** — reserved concurrency caps the maximum spend for a handler

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

### **Concurrency (Unreserved)**
- **No additional cost** — Lambda scales from the shared pool
- **Benefit:** Simplest approach; handlers share account-wide capacity

### **DLQ (SQS)**
- **Free Tier:** 1 million requests/month
- **After Free Tier:** $0.40 per million requests
- **Storage:** $0.40 per GB-month
- **Expected Cost:** < $1/month (webhooks are infrequent)

---

## ✅ **Benefits**

### **Concurrency**
- Auto-scales from shared account pool (current approach)
- Reserved concurrency available as a knob if needed
- API Gateway throttling provides the first line of defense

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

**Status:** Production-ready
