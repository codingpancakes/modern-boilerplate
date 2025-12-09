# 🧪 Testing Strategy

**Framework**: Vitest (unit) + Bash scripts (integration/E2E)  
**Status**: Foundation complete, needs consolidation  
**Last Updated**: December 9, 2025

---

## 📁 **Current Test Organization**

```
tests/
├── unit/                           # Vitest unit tests
│   ├── setup.ts                    # Global test setup
│   └── lib/                        # Library tests
│       ├── validation.test.ts      # ✅ Validation
│       ├── errors.test.ts          # ✅ Error handling
│       └── permissions.test.ts     # ✅ Permissions
│
├── integration/                    # Integration tests (bash)
│   ├── test-handlers.sh            # ✅ All REST handlers
│   ├── test-api-auth.sh            # ✅ Auth flow
│   ├── test-api.sh                 # ✅ Deployed API
│   └── test-middleware.sh          # ✅ Middleware variants
│
├── smoke/                          # Smoke tests (empty - to be moved)
└── manual/                         # Manual test scripts (to be moved)

scripts/                            # ⚠️ TO BE MOVED TO tests/
├── test-health-checks.sh           # → tests/integration/
├── test-image-upload.ts            # → tests/integration/
└── test-throttling.sh              # → tests/integration/
```

---

## 🎯 **Proposed Reorganization**

### **Step 1: Consolidate Integration Tests**

Move all integration tests to `tests/integration/`:

```bash
# Move from scripts/ to tests/integration/
mv scripts/test-health-checks.sh tests/integration/
mv scripts/test-image-upload.ts tests/integration/
mv scripts/test-throttling.sh tests/integration/
```

**Result:**
```
tests/integration/
├── test-handlers.sh            # All REST handlers
├── test-api-auth.sh            # Auth flow
├── test-api.sh                 # Deployed API health
├── test-middleware.sh          # Middleware variants
├── test-health-checks.sh       # ✅ MOVED - Health endpoints
├── test-image-upload.ts        # ✅ MOVED - Image upload flow
└── test-throttling.sh          # ✅ MOVED - Rate limiting
```

### **Step 2: Add GraphQL Tests**

Create GraphQL-specific test files:

```
tests/
├── unit/
│   └── graphql/
│       ├── resolvers/
│       │   ├── users.test.ts       # User resolver unit tests
│       │   └── media.test.ts       # Media resolver unit tests
│       └── context.test.ts         # Context creation tests
│
└── integration/
    └── test-graphql.sh             # GraphQL integration tests
```

### **Step 3: Add E2E Tests**

```
tests/e2e/
├── health-checks.spec.ts           # Health endpoint E2E
├── auth-flow.spec.ts               # Full auth flow
├── image-upload.spec.ts            # Image upload E2E
└── graphql-queries.spec.ts         # GraphQL E2E
```

---

## 📊 **Test Coverage by Type**

### **Unit Tests** (Vitest)
**Target**: 80% code coverage  
**Focus**: Pure functions, business logic, utilities

- ✅ Validation (`lib/validation`)
- ✅ Error handling (`lib/errors`)
- ✅ Permissions (`lib/permissions`)
- 🔜 Sanitization (`lib/sanitize`)
- 🔜 Middleware (`lib/middleware`)
- 🔜 Response helpers (`lib/response`)
- 🔜 GraphQL resolvers (`handlers/graphql/resolvers`)
- 🔜 GraphQL context (`handlers/graphql/context`)

### **Integration Tests** (Bash + curl)
**Target**: All critical user flows  
**Focus**: API endpoints, authentication, data flow

- ✅ REST handlers (`test-handlers.sh`)
- ✅ Auth flow (`test-api-auth.sh`)
- ✅ Deployed API (`test-api.sh`)
- ✅ Middleware (`test-middleware.sh`)
- ✅ Health checks (`test-health-checks.sh`)
- ✅ Image upload (`test-image-upload.ts`)
- ✅ Throttling (`test-throttling.sh`)
- 🔜 GraphQL queries (`test-graphql.sh`)
- 🔜 GraphQL mutations (`test-graphql.sh`)

### **E2E Tests** (Playwright - Future)
**Target**: Critical user journeys  
**Focus**: Full stack, browser automation

- 🔜 User signup/login flow
- 🔜 Profile management
- 🔜 Image upload with preview
- 🔜 GraphQL query execution

---

## 🧪 **GraphQL Testing Approach**

### **1. Unit Tests** (Vitest)

Test resolvers in isolation with mocked dependencies:

```typescript
// tests/unit/graphql/resolvers/users.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolvers } from "@/handlers/graphql/resolvers/users";

describe("User Resolvers", () => {
  describe("Query.me", () => {
    it("should return current user", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: "user-123", email: "test@example.com" }
            ])
          })
        })
      };

      const context = {
        userId: "user-123",
        db: mockDb
      };

      const result = await resolvers.Query.me(null, {}, context);

      expect(result.email).toBe("test@example.com");
    });
  });

  describe("Mutation.updateMe", () => {
    it("should update user fields", async () => {
      const mockDb = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { id: "user-123", firstName: "Updated" }
              ])
            })
          })
        })
      };

      const context = { userId: "user-123", db: mockDb };
      const input = { firstName: "Updated" };

      const result = await resolvers.Mutation.updateMe(null, { input }, context);

      expect(result.firstName).toBe("Updated");
    });
  });
});
```

### **2. Integration Tests** (Bash + curl)

Test GraphQL endpoint with real HTTP requests:

```bash
# tests/integration/test-graphql.sh
#!/bin/bash

JWT_TOKEN=$1
API_URL="http://localhost:3000"

echo "🧪 Testing GraphQL Endpoint"

# Test Query: me
echo "Testing Query: me..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ me { id email firstName lastName } }"
  }' \
  $API_URL/v1/graphql)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Query: me - PASSED"
  echo "$BODY" | jq '.data.me'
else
  echo "❌ Query: me - FAILED (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi

# Test Mutation: updateMe
echo "Testing Mutation: updateMe..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation($input: UpdateUserInput!) { updateMe(input: $input) { id firstName } }",
    "variables": {
      "input": { "firstName": "TestUpdated" }
    }
  }' \
  $API_URL/v1/graphql)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Mutation: updateMe - PASSED"
  echo "$BODY" | jq '.data.updateMe'
else
  echo "❌ Mutation: updateMe - FAILED (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi

echo ""
echo "🎉 All GraphQL tests passed!"
```

### **3. Context Tests** (Vitest)

Test GraphQL context creation:

```typescript
// tests/unit/graphql/context.test.ts
import { describe, it, expect, vi } from "vitest";
import { createContext } from "@/handlers/graphql/context";

describe("GraphQL Context", () => {
  it("should create context from Lambda event", async () => {
    const mockEvent = {
      requestContext: {
        authorizer: {
          lambda: {
            sub: "workos-user-123",
            email: "test@example.com",
            org_id: "org-456",
            role: "MEMBER"
          }
        }
      }
    };

    const mockDb = {};
    const context = await createContext({ event: mockEvent, context: {}, db: mockDb });

    expect(context.userId).toBeDefined();
    expect(context.email).toBe("test@example.com");
    expect(context.orgId).toBe("org-456");
    expect(context.role).toBe("MEMBER");
  });

  it("should throw error for missing claims", async () => {
    const mockEvent = {
      requestContext: {}
    };

    await expect(
      createContext({ event: mockEvent, context: {}, db: {} })
    ).rejects.toThrow();
  });
});
```

---

## 🚀 **Running Tests**

### **All Tests**
```bash
# Run everything
pnpm test:all

# Unit tests only
pnpm test:unit

# Integration tests only
pnpm test:integration

# GraphQL tests only
pnpm test:graphql
```

### **Specific Tests**
```bash
# Single unit test file
pnpm vitest tests/unit/graphql/resolvers/users.test.ts

# Single integration test
./tests/integration/test-graphql.sh "JWT_TOKEN"

# Watch mode (unit tests)
pnpm test:watch
```

### **Coverage**
```bash
# Generate coverage report
pnpm test:coverage

# View coverage in browser
open coverage/index.html
```

---

## 📦 **Package.json Scripts**

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run",
    "test:watch": "vitest watch",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:integration": "bash tests/integration/test-all.sh",
    "test:graphql": "bash tests/integration/test-graphql.sh",
    "test:all": "pnpm test:unit && pnpm test:integration",
    "check": "pnpm lint && pnpm typecheck && pnpm test:unit"
  }
}
```

---

## ✅ **Implementation Checklist**

### **Phase 1: Consolidation** (1 hour)
- [ ] Move `scripts/test-*.sh` to `tests/integration/`
- [ ] Update script paths in documentation
- [ ] Create `tests/integration/test-all.sh` master script
- [ ] Update package.json scripts

### **Phase 2: GraphQL Unit Tests** (4 hours)
- [ ] Create `tests/unit/graphql/` directory
- [ ] Add user resolver tests
- [ ] Add media resolver tests
- [ ] Add context creation tests
- [ ] Achieve 80%+ coverage for GraphQL code

### **Phase 3: GraphQL Integration Tests** (2 hours)
- [ ] Create `tests/integration/test-graphql.sh`
- [ ] Test all queries (me, user, images, organizations)
- [ ] Test all mutations (updateMe, updateProfile, updateMyAccount)
- [ ] Test error cases (unauthorized, validation errors)

### **Phase 4: E2E Tests** (8 hours - Future)
- [ ] Install Playwright
- [ ] Create E2E test structure
- [ ] Add critical user journey tests
- [ ] Integrate with CI/CD

---

## 🎯 **Testing Priorities**

### **Week 1** (Immediate)
1. ✅ Consolidate test scripts
2. ✅ Add GraphQL unit tests
3. ✅ Add GraphQL integration tests

### **Week 2** (High Priority)
4. Add missing handler unit tests
5. Add missing middleware unit tests
6. Improve test coverage to 80%+

### **Week 3** (Nice to Have)
7. Add E2E tests with Playwright
8. Add performance/load tests
9. Add CI/CD integration

---

## 📈 **Success Metrics**

- **Unit Test Coverage**: 80%+ (currently ~40%)
- **Integration Test Coverage**: All endpoints tested
- **GraphQL Test Coverage**: 90%+ (resolvers + context)
- **CI/CD**: All tests pass before merge
- **Test Speed**: Unit tests < 10s, Integration < 60s

---

**Status**: Ready for consolidation and GraphQL testing  
**Next**: Run consolidation script and add GraphQL tests
