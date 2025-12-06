# 🚀 Caching Strategy

**Status**: Not Implemented (Optional)  
**Priority**: Low (Optimize after launch)  
**When to Add**: When you see performance issues or high costs

---

## 🎯 **Caching Layers**

### **1. CloudFront for API Responses** (Recommended First)

**Use Case**: Cache GET endpoints that return static or semi-static data

**Benefits**:
- ✅ Reduces Lambda invocations (cost savings)
- ✅ Improves response time globally
- ✅ Built-in DDoS protection
- ✅ Easy to implement

**Implementation**:

```typescript
// infrastructure/lib/api-cache-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export interface ApiCacheStackProps extends cdk.StackProps {
  apiUrl: string;
  stage: string;
}

export class ApiCacheStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: ApiCacheStackProps) {
    super(scope, id, props);

    // Cache policy for API responses
    const apiCachePolicy = new cloudfront.CachePolicy(this, 'ApiCachePolicy', {
      cachePolicyName: `api-cache-${props.stage}`,
      comment: 'Cache policy for API GET requests',
      defaultTtl: cdk.Duration.minutes(5),
      minTtl: cdk.Duration.seconds(1),
      maxTtl: cdk.Duration.hours(1),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
        'Authorization',
        'Accept',
        'Accept-Language'
      ),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // Origin request policy
    const originRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      'ApiOriginRequestPolicy',
      {
        originRequestPolicyName: `api-origin-${props.stage}`,
        comment: 'Forward necessary headers to API',
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
          'Authorization',
          'Accept',
          'Accept-Language',
          'User-Agent'
        ),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      }
    );

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'ApiDistribution', {
      comment: `API CDN for ${props.stage}`,
      defaultBehavior: {
        origin: new origins.HttpOrigin(props.apiUrl, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: apiCachePolicy,
        originRequestPolicy: originRequestPolicy,
        compress: true,
      },
      // Only cache GET requests
      additionalBehaviors: {
        '/v1/users/me': {
          origin: new origins.HttpOrigin(props.apiUrl),
          cachePolicy: apiCachePolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
        '/v1/media/images': {
          origin: new origins.HttpOrigin(props.apiUrl),
          cachePolicy: apiCachePolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe
    });

    // Outputs
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });
  }
}
```

**Cache Control Headers** (Add to handlers):

```typescript
// src/node/lib/response.ts
export function createCacheableResponse<T>(
  data: T,
  cacheSeconds: number = 300, // 5 minutes default
  statusCode: number = 200
): SuccessResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
      'Vary': 'Accept-Encoding, Authorization',
    },
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}
```

**Usage in Handlers**:

```typescript
// Cache for 5 minutes
return createCacheableResponse(userData, 300);

// Cache for 1 hour
return createCacheableResponse(publicData, 3600);

// Don't cache (default response)
return createSuccessResponse(sensitiveData);
```

---

### **2. DynamoDB for Session/Token Caching** (If Needed)

**Use Case**: Cache user sessions, JWT tokens, or frequently accessed data

**Benefits**:
- ✅ Fast key-value lookups (single-digit ms)
- ✅ Serverless, auto-scaling
- ✅ Built-in TTL for automatic cleanup
- ✅ Cost-effective for small datasets

**Implementation**:

```typescript
// infrastructure/lib/cache-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class CacheStack extends cdk.Stack {
  public readonly sessionTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // Session cache table
    this.sessionTable = new dynamodb.Table(this, 'SessionCache', {
      tableName: `session-cache-${props.stage}`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sessionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: props.stage === 'production',
    });

    // GSI for looking up by session ID
    this.sessionTable.addGlobalSecondaryIndex({
      indexName: 'sessionId-index',
      partitionKey: {
        name: 'sessionId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
```

**Cache Helper**:

```typescript
// src/node/lib/cache.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CACHE_TABLE_NAME || 'session-cache';

export async function cacheGet<T>(key: string): Promise<T | null> {
  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: { key },
  });

  const result = await docClient.send(command);
  return result.Item?.data as T || null;
}

export async function cacheSet<T>(
  key: string,
  data: T,
  ttlSeconds: number = 3600
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + ttlSeconds;

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      key,
      data,
      ttl,
      createdAt: new Date().toISOString(),
    },
  });

  await docClient.send(command);
}

export async function cacheDelete(key: string): Promise<void> {
  const command = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { key },
  });

  await docClient.send(command);
}
```

**Usage**:

```typescript
// Check cache first
const cached = await cacheGet<UserProfile>(`user:${userId}`);
if (cached) {
  return createSuccessResponse(cached);
}

// Fetch from database
const user = await db.select()...;

// Store in cache (1 hour)
await cacheSet(`user:${userId}`, user, 3600);

return createSuccessResponse(user);
```

---

### **3. Redis/ElastiCache** (Advanced, If Needed)

**Use Case**: High-traffic applications with complex caching needs

**Benefits**:
- ✅ Sub-millisecond latency
- ✅ Advanced data structures (lists, sets, sorted sets)
- ✅ Pub/sub for real-time features
- ✅ Atomic operations

**When to Use**:
- ❌ **Don't use** if you have < 1000 req/min
- ✅ **Consider** if you have > 10,000 req/min
- ✅ **Use** if you need real-time features (chat, notifications)

**Cost**: ~$15-50/month for small instance

**Implementation** (if needed):

```typescript
// infrastructure/lib/redis-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class RedisStack extends cdk.Stack {
  public readonly cluster: elasticache.CfnCacheCluster;

  constructor(scope: Construct, id: string, props: cdk.StackProps & { vpc: ec2.Vpc }) {
    super(scope, id, props);

    // Security group for Redis
    const securityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Redis cluster',
    });

    // Subnet group
    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: props.vpc.privateSubnets.map(subnet => subnet.subnetId),
    });

    // Redis cluster
    this.cluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: 'cache.t3.micro', // Smallest instance
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: subnetGroup.ref,
      vpcSecurityGroupIds: [securityGroup.securityGroupId],
    });
  }
}
```

---

## 📊 **Caching Decision Matrix**

| Scenario | Solution | Cost | Complexity |
|----------|----------|------|------------|
| **Static API responses** | CloudFront | Low | Low ⭐ |
| **User sessions** | DynamoDB | Very Low | Low ⭐ |
| **Hot data (< 1000 req/min)** | DynamoDB | Very Low | Low ⭐ |
| **Hot data (> 10k req/min)** | Redis | Medium | Medium |
| **Real-time features** | Redis | Medium | High |

---

## 🎯 **Recommended Approach**

### **Phase 1: Launch** (Now)
- ❌ No caching
- ✅ Monitor performance
- ✅ Identify bottlenecks

### **Phase 2: Optimize** (After 1 month)
- ✅ Add CloudFront for GET endpoints
- ✅ Add Cache-Control headers
- ✅ Monitor cache hit rates

### **Phase 3: Scale** (If needed)
- ✅ Add DynamoDB for hot data
- ✅ Implement cache invalidation
- ⚠️ Consider Redis only if > 10k req/min

---

## 📈 **When to Add Caching**

### **Metrics to Watch**

```bash
# Lambda invocation cost
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=your-function \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-31T23:59:59Z \
  --period 86400 \
  --statistics Sum

# Average response time
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=your-function \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-31T23:59:59Z \
  --period 3600 \
  --statistics Average
```

### **Add Caching If**:
- ✅ Lambda costs > $100/month
- ✅ Average response time > 500ms
- ✅ Same data fetched repeatedly
- ✅ Database queries are slow

### **Don't Add Caching If**:
- ❌ Lambda costs < $50/month
- ❌ Response times < 200ms
- ❌ Data changes frequently
- ❌ You have < 1000 users

---

## ✅ **Quick Start (CloudFront Only)**

```bash
# 1. Add Cache-Control headers to handlers
# See createCacheableResponse() above

# 2. Deploy CloudFront (optional)
# Use ApiCacheStack from above

# 3. Update DNS to point to CloudFront
# api.yourdomain.com → CloudFront distribution

# 4. Monitor cache hit rates
aws cloudfront get-distribution-statistics \
  --distribution-id YOUR_DIST_ID
```

---

## 🚦 **Bottom Line**

**For Your Current Scale**:
- ❌ **Don't add caching yet**
- ✅ **Launch first, measure performance**
- ✅ **Add CloudFront if costs > $100/month**
- ✅ **Add DynamoDB cache if response times > 500ms**

**Caching is an optimization, not a requirement.** Your current architecture is solid without it! 🚀

---

**Status**: Documentation complete, implementation optional  
**Next**: Launch, monitor, optimize based on real data
