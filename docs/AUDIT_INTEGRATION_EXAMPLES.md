# 🔍 Audit Logging Integration Examples

**Purpose:** Reference examples showing how to integrate audit logging in your boilerplate  
**Status:** ✅ Implemented in sample endpoints  
**Created:** December 27, 2025  
**Last Updated:** February 1, 2026

---

## 📋 Overview

This boilerplate includes a **fully functional audit logging system** that tracks user actions for:
- **Security:** Detect unauthorized access and suspicious activity
- **Compliance:** Meet SOC 2 Type II requirements
- **Forensics:** Investigate incidents and data breaches
- **Debugging:** Troubleshoot user-reported issues

**Infrastructure:**
- ✅ Database table: `audit_logs` (14 columns, 6 indexes)
- ✅ Utilities: `src/node/lib/audit.ts`
- ✅ Schema: `src/node/db/schema/audit.ts`
- ✅ Migration: `0003_shallow_joystick.sql`

---

## 🎯 Integration Examples

### **Example 1: REST API Handler (Lambda)** ✅ IMPLEMENTED

**File:** `src/node/handlers/users/update.ts`

This example shows audit logging in a REST API handler that updates user profiles. **This is fully implemented and working in production.**

```typescript
import { logAudit, AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, AUDIT_STATUS } from "../../lib/audit";

const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  const userId = await getUserIdFromClaims(event);
  const db = await getDb();
  
  // Fetch BEFORE state for audit trail
  const [currentUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [currentProfile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  
  // Perform updates...
  await db.update(users).set(updates.user).where(eq(users.id, userId));
  await db.update(profiles).set(updates.profile).where(eq(profiles.userId, userId));
  
  // Fetch AFTER state
  const [updatedUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [updatedProfile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  
  // 🔍 AUDIT LOG: Track the update
  await logAudit({
    userId,
    action: AUDIT_ACTIONS.UPDATE,
    resourceType: AUDIT_RESOURCE_TYPES.PROFILE,
    resourceId: userId,
    changes: {
      before: { user: currentUser, profile: currentProfile },
      after: { user: updatedUser, profile: updatedProfile },
    },
    ipAddress: event.requestContext?.http?.sourceIp,
    userAgent: event.headers?.["user-agent"],
    requestId: event.requestContext?.requestId,
    status: AUDIT_STATUS.SUCCESS,
    metadata: {
      updatedFields: {
        user: updates.user ? Object.keys(updates.user) : [],
        profile: updates.profile ? Object.keys(updates.profile) : [],
      },
    },
  });
  
  return createSuccessResponse({ user: updatedUser, profile: updatedProfile });
};
```

**Key Points:**
- ✅ Captures before/after state for complete audit trail
- ✅ Includes request context (IP, user agent, request ID)
- ✅ Logs metadata about which fields were updated
- ✅ Never throws errors (audit logging won't break main flow)

---

### **Example 2: GraphQL Mutation (Using Decorator)** ✅ IMPLEMENTED

**File:** `src/node/handlers/graphql/resolvers/users.ts`

This example shows the `auditResolver` decorator for GraphQL mutations. **This is fully implemented and working in production.**

```typescript
import { auditResolver, AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from "../../../lib/audit";

export const userResolvers = {
  Mutation: {
    // 🔍 Wrapped with auditResolver decorator
    updateMe: auditResolver(
      async (
        _parent: unknown,
        { input }: { input: Record<string, unknown> },
        context: GraphQLContext,
      ) => {
        // Validate input
        const validated = userSchemas.update.parse(input);
        const sanitized = sanitizeObject(validated);
        
        // Update user
        const [updated] = await context.db
          .update(users)
          .set({
            ...sanitized,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(users.id, context.userId))
          .returning();
        
        return updated;
      },
      {
        // Audit configuration
        action: AUDIT_ACTIONS.UPDATE,
        resourceType: AUDIT_RESOURCE_TYPES.USER,
        getResourceId: (result) => result.id,
        getChanges: (result) => ({ after: result }),
        getMetadata: (_result, args) => ({
          updatedFields: Object.keys(args.input),
        }),
      },
    ),
    
    // Another example with profile updates
    updateProfile: auditResolver(
      async (
        _parent: unknown,
        { input }: { input: Record<string, unknown> },
        context: GraphQLContext,
      ) => {
        const sanitized = sanitizeObject(input);
        
        const [updated] = await context.db
          .update(profiles)
          .set({
            ...sanitized,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(profiles.userId, context.userId))
          .returning();
        
        return updated;
      },
      {
        action: AUDIT_ACTIONS.UPDATE,
        resourceType: AUDIT_RESOURCE_TYPES.PROFILE,
        getResourceId: (result) => result.userId,
        getChanges: (result) => ({ after: result }),
        getMetadata: (_result, args) => ({
          updatedFields: Object.keys(args.input),
        }),
      },
    ),
  },
};
```

**Key Points:**
- ✅ Automatically logs success and failure
- ✅ Extracts userId and organizationId from GraphQL context
- ✅ Handles errors gracefully (logs failure then re-throws)
- ✅ Clean, declarative syntax with minimal boilerplate

---

## 📊 What Gets Logged

Every audit log entry includes:

| Field | Description | Example |
|-------|-------------|---------|
| `userId` | User who performed the action | `"d584b644-6317-45a9-a062-d8123bf828ed"` |
| `organizationId` | Organization context (optional) | `"789e0123-e89b-12d3-a456-426614174000"` |
| `action` | Type of action performed | `"UPDATE"`, `"CREATE"`, `"DELETE"` |
| `resourceType` | Type of resource affected | `"USER"`, `"PROFILE"`, `"MEDIA"` |
| `resourceId` | ID of the affected resource | `"456e7890-e89b-12d3-a456-426614174000"` |
| `changes` | Before/after values | `{ before: {...}, after: {...} }` |
| `ipAddress` | Client IP address | `"203.0.113.42"` |
| `userAgent` | Client user agent | `"Mozilla/5.0..."` |
| `requestId` | X-Ray trace ID | `"1-5f8a1234-abcdef1234567890"` |
| `timestamp` | When the action occurred | `"2025-12-27T15:30:00.000Z"` |
| `metadata` | Additional context (JSONB) | `{ updatedFields: ["firstName"] }` |
| `status` | Success/failure/partial | `"SUCCESS"`, `"FAILURE"` |
| `errorMessage` | Error details (if failed) | `"Validation failed: invalid email"` |

---

## 🎯 Available Actions

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

## 📋 Available Resource Types

```typescript
AUDIT_RESOURCE_TYPES = {
  USER: "USER",
  PROFILE: "PROFILE",
  ORGANIZATION: "ORGANIZATION",
  ORGANIZATION_MEMBER: "ORGANIZATION_MEMBER",
  CONTACT: "CONTACT",
  CONTACT_LIST: "CONTACT_LIST",
  JOURNEY: "JOURNEY",
  CAMPAIGN: "CAMPAIGN",
  MESSAGE: "MESSAGE",
  MESSAGE_TEMPLATE: "MESSAGE_TEMPLATE",
  MEDIA: "MEDIA",
  WEBHOOK: "WEBHOOK",
  API_KEY: "API_KEY",
  SETTINGS: "SETTINGS",
}
```

---

## 🚀 How to Add Audit Logging to Your Endpoints

### **For REST API Handlers:**

1. Import audit utilities:
   ```typescript
   import { logAudit, AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, AUDIT_STATUS } from "../../lib/audit";
   ```

2. Fetch before state (if tracking changes):
   ```typescript
   const [before] = await db.select().from(table).where(eq(table.id, id)).limit(1);
   ```

3. Perform your operation

4. Fetch after state:
   ```typescript
   const [after] = await db.select().from(table).where(eq(table.id, id)).limit(1);
   ```

5. Log the audit event:
   ```typescript
   await logAudit({
     userId: context.userId,
     action: AUDIT_ACTIONS.UPDATE,
     resourceType: AUDIT_RESOURCE_TYPES.YOUR_RESOURCE,
     resourceId: id,
     changes: { before, after },
     ipAddress: event.requestContext?.http?.sourceIp,
     userAgent: event.headers?.["user-agent"],
     requestId: event.requestContext?.requestId,
     status: AUDIT_STATUS.SUCCESS,
   });
   ```

### **For GraphQL Mutations:**

1. Import audit decorator:
   ```typescript
   import { auditResolver, AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from "../../../lib/audit";
   ```

2. Wrap your resolver:
   ```typescript
   yourMutation: auditResolver(
     async (parent, args, context) => {
       // Your mutation logic
       return result;
     },
     {
       action: AUDIT_ACTIONS.CREATE,
       resourceType: AUDIT_RESOURCE_TYPES.YOUR_RESOURCE,
       getResourceId: (result) => result.id,
       getChanges: (result) => ({ after: result }),
     },
   ),
   ```

---

## 🔍 Querying Audit Logs

### Get User Activity
```typescript
const userActivity = await db
  .select()
  .from(auditLogs)
  .where(eq(auditLogs.userId, userId))
  .orderBy(desc(auditLogs.timestamp))
  .limit(100);
```

### Get Resource History
```typescript
const resourceHistory = await db
  .select()
  .from(auditLogs)
  .where(
    and(
      eq(auditLogs.resourceType, "PROFILE"),
      eq(auditLogs.resourceId, profileId)
    )
  )
  .orderBy(desc(auditLogs.timestamp));
```

### Get Failed Actions
```typescript
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

---

## ✅ Best Practices

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

## 📈 Next Steps

### Current Audit Logging Coverage

**✅ Implemented:**
- ✅ `users/update.ts` - User profile updates (REST)
- ✅ `graphql/resolvers/users.ts` - `updateMe`, `updateProfile` mutations
- ✅ `webhooks/workos.ts` - User lifecycle events (create, update)

**❌ Not Yet Implemented:**
- [ ] `media/upload-image.ts` - Track presigned URL generation
- [ ] `media/upload-image-direct.ts` - Track direct file uploads
- [ ] `graphql/resolvers/media.ts` - `generateImageUploadUrl` mutation

**📊 Coverage:** 3 of 6 mutation handlers (50%)

### Expand Audit Logging Coverage
Add audit logging to remaining endpoints:
- [ ] `media/upload-image.ts` - Track presigned URL generation (1 hour)
- [ ] `media/upload-image-direct.ts` - Track direct uploads (1 hour)
- [ ] `media/generateImageUploadUrl` (GraphQL) - Track presigned URL generation (30 min)
- [ ] Any other mutations you add to your application

### Create Admin UI
Build an admin interface to:
- [ ] View audit logs
- [ ] Filter by user, action, resource type
- [ ] Export audit logs (CSV/JSON)
- [ ] Search audit logs

### Add Automated Cleanup
Implement retention policy:
- [ ] Create Lambda function to archive old logs
- [ ] Move logs older than 1 year to S3 Glacier
- [ ] Delete logs older than 7 years (SOC 2 requirement)

---

## 📞 Reference Documentation

- **Full Guide:** [AUDIT_LOGGING_GUIDE.md](./AUDIT_LOGGING_GUIDE.md)
- **Schema:** `src/node/db/schema/audit.ts`
- **Utilities:** `src/node/lib/audit.ts`
- **Migration:** `src/node/db/migrations/0003_shallow_joystick.sql`
- **SOC 2 Checklist:** [SOC2_READINESS_CHECKLIST.md](./SOC2_READINESS_CHECKLIST.md)

---

**Last Updated:** February 1, 2026  
**Status:** ✅ Phase 1 Complete (50% handler coverage)  
**Node.js Version:** 24.x (Lambda Runtime: NODEJS_24_X)  
**Compliance:** SOC 2 Type II ready (core infrastructure)
