# 📋 Audit Logging Guide

**Purpose:** SOC 2 compliance - Track all user actions for security, compliance, and forensics  
**Retention:** 7 years (compliance requirement)  
**Created:** December 11, 2025

---

## 🎯 Overview

The audit logging system tracks all user actions in the platform for:
- **Security:** Detect unauthorized access and suspicious activity
- **Compliance:** Meet SOC 2 Type II requirements
- **Forensics:** Investigate incidents and data breaches
- **Debugging:** Troubleshoot user-reported issues

---

## 📊 What Gets Logged

### Currently Logged (Phase 1)
- User profile updates (REST + GraphQL)
- Organization changes
- Webhook-triggered user creation/updates
- Permission/membership changes

### Planned (Phase 2)
- Media uploads
- Data exports
- API key operations

### Logged Information
- **Who:** User ID, Organization ID
- **What:** Action type, resource type, resource ID
- **When:** Timestamp (UTC)
- **Where:** IP address, user agent
- **How:** Request ID (X-Ray trace)
- **Changes:** Before/after values (for updates)
- **Result:** Success, failure, or partial

---

## 🔧 Usage

### Option 1: Direct Logging — REST Handlers (Recommended)

```typescript
import { logAudit, AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, AUDIT_STATUS, extractRequestContext } from "../../lib/audit";
import { type AuthenticatedEvent, withAuth } from "../../lib/middleware";
import { getUserIdFromClaims } from "../../lib/auth";
import { createSuccessResponse } from "../../lib/response";
import { getDb } from "../../lib/db";

const handlerFn = async (event: AuthenticatedEvent, context: Context) => {  // Context from "aws-lambda"
  const userId = await getUserIdFromClaims(event);
  const db = await getDb();
  const [result] = await db.insert(table).values({ userId, ...data }).returning();

  void logAudit({
    userId,
    action: AUDIT_ACTIONS.CREATE,
    resourceType: AUDIT_RESOURCE_TYPES.USER,
    resourceId: result.id,
    changes: { after: result },
    ...extractRequestContext(event),
    status: AUDIT_STATUS.SUCCESS,
  });

  return createSuccessResponse(result);
};

export const handler = withAuth(handlerFn);
```

---

### Option 2: GraphQL Resolver Decorator (`auditResolver`)

```typescript
// Import path varies by file depth, e.g. from a resolver:
import { auditResolver, AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from "../../../lib/audit";

const resolvers = {
  Mutation: {
    updateProfile: auditResolver(
      async (parent, args, context) => {
        const validated = profileUpdateSchema.parse(args.input);
        const sanitized = sanitizeObject(validated);
        const [updated] = await context.db
          .update(profiles)
          .set(sanitized)
          .where(eq(profiles.userId, context.userId))
          .returning();
        return updated;
      },
      {
        action: AUDIT_ACTIONS.UPDATE,
        resourceType: AUDIT_RESOURCE_TYPES.PROFILE,
        getResourceId: (result) => result.id,
        getChanges: (result) => ({ after: result }),
      }
    ),
  },
};
```

**Benefits:**
- Automatically logs success and failure
- Handles errors gracefully
- Consistent logging across all resolvers
- Less boilerplate

**Note:** For complex multi-step mutations (e.g. `updateMyAccount` which updates both users and profiles in a transaction), use `void logAudit()` directly instead of `auditResolver`.

---

## 📋 Action Types

```typescript
AUDIT_ACTIONS = {
  // Authentication
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LOGIN_FAILED: "LOGIN_FAILED",
  PASSWORD_RESET: "PASSWORD_RESET",
  MFA_ENABLED: "MFA_ENABLED",
  MFA_DISABLED: "MFA_DISABLED",
  
  // CRUD Operations
  CREATE: "CREATE",
  READ: "READ",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  
  // Bulk Operations
  BULK_CREATE: "BULK_CREATE",
  BULK_UPDATE: "BULK_UPDATE",
  BULK_DELETE: "BULK_DELETE",
  
  // Access Control
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_REVOKED: "PERMISSION_REVOKED",
  ACCESS_DENIED: "ACCESS_DENIED",
  
  // Data Export/Import
  EXPORT: "EXPORT",
  IMPORT: "IMPORT",
  
  // System Events
  WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
  WEBHOOK_FAILED: "WEBHOOK_FAILED",
  API_KEY_CREATED: "API_KEY_CREATED",
  API_KEY_REVOKED: "API_KEY_REVOKED",
}
```

---

## 📋 Resource Types

```typescript
AUDIT_RESOURCE_TYPES = {
  USER: "USER",
  PROFILE: "PROFILE",
  ORGANIZATION: "ORGANIZATION",
  ORGANIZATION_MEMBER: "ORGANIZATION_MEMBER",
  MEDIA: "MEDIA",
  WEBHOOK: "WEBHOOK",
  API_KEY: "API_KEY",
  SETTINGS: "SETTINGS",
}
```

---

## 🔍 Querying Audit Logs

### Get User Activity

```typescript
import { getDb } from "../../lib/db";
import { auditLogs } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

// Get all actions by a user
const db = await getDb();
const userActivity = await db
  .select()
  .from(auditLogs)
  .where(eq(auditLogs.userId, userId))
  .orderBy(desc(auditLogs.timestamp))
  .limit(100);
```

### Get Resource History

```typescript
// Get all changes to a specific user
const userHistory = await db
  .select()
  .from(auditLogs)
  .where(
    and(
      eq(auditLogs.resourceType, "USER"),
      eq(auditLogs.resourceId, userId)
    )
  )
  .orderBy(desc(auditLogs.timestamp));
```

### Get Failed Actions

```typescript
// Get all failed actions in the last 24 hours
const failures = await db
  .select()
  .from(auditLogs)
  .where(
    and(
      eq(auditLogs.status, "FAILURE"),
      gte(auditLogs.timestamp, new Date(Date.now() - 24 * 60 * 60 * 1000))
    )
  )
  .orderBy(desc(auditLogs.timestamp));
```

### Get Organization Activity

```typescript
// Get all actions in an organization
const orgActivity = await db
  .select()
  .from(auditLogs)
  .where(eq(auditLogs.organizationId, orgId))
  .orderBy(desc(auditLogs.timestamp))
  .limit(100);
```

---

## 🎯 Best Practices

### DO ✅

1. **Log all mutations** (create, update, delete)
2. **Log authentication events** (login, logout, failures)
3. **Log permission changes** (grants, revokes)
4. **Log data exports** (GDPR/CCPA compliance)
5. **Include before/after values** for updates
6. **Use consistent action/resource types**
7. **Log failures** (with error messages)
8. **Include request context** (IP, user agent, request ID)

### DON'T ❌

1. **Don't log passwords** or sensitive credentials
2. **Don't log PII** in metadata (unless necessary)
3. **Don't log read operations** (too noisy, use CloudWatch instead)
4. **Don't throw errors** if audit logging fails (log and continue)
5. **Don't log health checks** or internal operations
6. **Don't log every GraphQL query** (only mutations)

---

## 🔒 Security Considerations

### Data Retention
- **Retention:** 7 years (SOC 2 requirement)
- **Cleanup:** Automated job (to be implemented)
- **Archive:** Move old logs to Glacier after 1 year (optional)

### Access Control
- **Who can view:** Admins and owners only
- **API endpoint:** `/v1/audit-logs` (to be implemented)
- **Permissions:** Require `audit:read` permission

### Sensitive Data
- **PII:** Avoid logging full PII (use IDs instead)
- **Passwords:** Never log passwords or tokens
- **Encryption:** Database is encrypted at rest
- **Changes:** Sanitize sensitive fields in `changes` object

---

## 📊 Example Audit Log Entry

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "organizationId": "789e0123-e89b-12d3-a456-426614174000",
  "action": "UPDATE",
  "resourceType": "USER",
  "resourceId": "123e4567-e89b-12d3-a456-426614174000",
  "changes": {
    "before": {
      "firstName": "John"
    },
    "after": {
      "firstName": "Johnny"
    }
  },
  "ipAddress": "203.0.113.42",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "requestId": "1-5f8a1234-abcdef1234567890",
  "timestamp": "2025-12-11T08:30:00.000Z",
  "metadata": {
    "source": "rest",
    "handler": "users/update"
  },
  "status": "SUCCESS",
  "errorMessage": null
}
```

---

## 🚀 Deployment

### 1. Run Migration

```bash
# Local development
pnpm migrate

# Production (via CDK)
pnpm deploy:production
# Migration runs automatically via MigrationRunner Lambda
```

### 2. Verify Table

```bash
# Connect to database and verify
psql $DATABASE_URL -c "SELECT COUNT(*) FROM audit_logs;"
```

### 3. Test Logging

```typescript
// Create a test audit log
await logAudit({
  userId: "test-user-id",
  action: AUDIT_ACTIONS.CREATE,
  resourceType: AUDIT_RESOURCE_TYPES.USER,
  resourceId: "test-user-id",
  status: AUDIT_STATUS.SUCCESS,
});
```

---

## 📈 Monitoring

### CloudWatch Metrics (To Be Implemented)

- **Audit Log Rate:** Logs per minute
- **Failed Audits:** Failed audit log writes
- **Table Size:** Monitor table growth

### Alerts (To Be Implemented)

- Alert if audit logging fails
- Alert if suspicious activity detected
- Alert if table size exceeds threshold

---

## 🔄 Future Enhancements

### Phase 1 (Current)
- [x] Audit logs table
- [x] Basic logging utilities
- [x] Middleware and decorators
- [x] Database migration

### Phase 2 (Next)
- [ ] API endpoint to query audit logs
- [ ] Admin UI to view audit logs
- [ ] Automated cleanup job (7 year retention)
- [ ] CloudWatch metrics and alarms

### Phase 3 (Future)
- [ ] Real-time anomaly detection
- [ ] Audit log export (CSV/JSON)
- [ ] Audit log search (Elasticsearch)
- [ ] Compliance reports (SOC 2, GDPR)

---

## 📞 Support

For questions about audit logging:
- **Documentation:** This file
- **Schema:** `src/node/db/schema/audit.ts`
- **Utilities:** `src/node/lib/audit.ts`
- **Migration:** `src/node/db/migrations/` (audit logs migration)

---

**Last Updated:** March 2026  
**Status:** Implemented (Phase 1)  
**SOC 2 Requirement:** Met
