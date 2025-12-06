# 🧪 Unit Testing Guide

**Framework**: Vitest  
**Coverage**: v8  
**Status**: Setup Complete, Tests Needed

---

## 📦 **Installation**

```bash
# Install testing dependencies
pnpm add -D vitest @vitest/ui @vitest/coverage-v8
```

## 🏗️ **Project Structure**

```
tests/
├── unit/
│   ├── setup.ts                    # Global test setup
│   ├── lib/
│   │   ├── validation.test.ts      # ✅ Created
│   │   ├── errors.test.ts          # ✅ Created
│   │   ├── middleware.test.ts      # TODO
│   │   ├── sanitize.test.ts        # TODO
│   │   ├── permissions.test.ts     # TODO
│   │   └── response.test.ts        # TODO
│   └── handlers/
│       ├── users/
│       │   ├── me.test.ts          # TODO
│       │   └── update.test.ts      # TODO
│       └── media/
│           └── upload-image.test.ts # TODO
└── integration/  # (already exists)
```

---

## ⚙️ **Configuration**

### **vitest.config.ts** ✅ Created

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/unit/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "infrastructure/",
        "cdk.out/",
        "**/*.d.ts",
        "**/*.config.ts",
      ],
    },
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/node"),
    },
  },
});
```

### **package.json Scripts**

Add these to your `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run",
    "test:watch": "vitest watch",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:integration": "bash tests/integration/test-handlers.sh"
  }
}
```

---

## 📝 **Example Tests**

### **1. Validation Tests** ✅ Created

`tests/unit/lib/validation.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { validate, parseBody } from "@/lib/validation";
import { userSchemas } from "@/lib/validation/users";

describe("Validation", () => {
  it("should validate correct data", () => {
    const schema = z.object({
      email: z.string().email(),
      name: z.string(),
    });

    const data = { email: "test@example.com", name: "Test User" };
    const result = validate(schema, data);
    
    expect(result).toEqual(data);
  });

  it("should throw ValidationError for invalid data", () => {
    const schema = z.object({ email: z.string().email() });
    const data = { email: "invalid-email" };

    expect(() => validate(schema, data)).toThrow();
  });
});
```

### **2. Error Handling Tests** ✅ Created

`tests/unit/lib/errors.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { ApiError, Errors, formatError } from "@/lib/errors";

describe("Error Handling", () => {
  it("should create Unauthorized error", () => {
    const error = Errors.Unauthorized();
    
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("should format ApiError correctly", () => {
    const error = new ApiError(404, "NOT_FOUND", "Resource not found");
    const response = formatError(error, "test-request-id");

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Resource not found");
  });
});
```

### **3. Middleware Tests** (TODO)

`tests/unit/lib/middleware.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { withAuth } from "@/lib/middleware";

describe("Middleware", () => {
  describe("withAuth", () => {
    it("should pass claims to handler", async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      });

      const wrappedHandler = withAuth(mockHandler);

      const event = {
        requestContext: {
          authorizer: {
            lambda: {
              sub: "user-123",
              email: "test@example.com",
            },
          },
          http: { method: "GET" },
        },
        headers: {},
      } as any;

      const context = {} as any;

      await wrappedHandler(event, context);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          claims: expect.objectContaining({
            sub: "user-123",
          }),
        }),
        context
      );
    });

    it("should return 401 for missing claims", async () => {
      const mockHandler = vi.fn();
      const wrappedHandler = withAuth(mockHandler);

      const event = {
        requestContext: {
          http: { method: "GET" },
        },
        headers: {},
      } as any;

      const result = await wrappedHandler(event, {} as any);

      expect(result.statusCode).toBe(401);
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });
});
```

### **4. Handler Tests** (TODO)

`tests/unit/handlers/users/me.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "@/handlers/users/me";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
}));

describe("GET /users/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return user data", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: "user-123",
                email: "test@example.com",
                firstName: "Test",
                lastName: "User",
              },
            ]),
          }),
        }),
      }),
    };

    const { getDb } = await import("@/lib/db");
    (getDb as any).mockResolvedValue(mockDb);

    const event = {
      claims: { sub: "user-123" },
      requestContext: { http: { method: "GET" } },
    } as any;

    const result = await handler(event, {} as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data.email).toBe("test@example.com");
  });
});
```

---

## 🚀 **Running Tests**

```bash
# Run all tests
pnpm test:unit

# Watch mode (re-run on changes)
pnpm test:watch

# UI mode (interactive)
pnpm test:ui

# Coverage report
pnpm test:coverage

# Run specific test file
pnpm vitest tests/unit/lib/validation.test.ts
```

---

## 📊 **Coverage Goals**

| Category | Target | Priority |
|----------|--------|----------|
| **Validation** | 90%+ | High |
| **Error Handling** | 90%+ | High |
| **Middleware** | 85%+ | High |
| **Handlers** | 75%+ | Medium |
| **Utilities** | 80%+ | Medium |

---

## 🎯 **Testing Priorities**

### **Week 1** (High Priority)
1. ✅ Validation tests
2. ✅ Error handling tests
3. ⏳ Middleware tests
4. ⏳ Sanitization tests

### **Week 2** (Medium Priority)
5. ⏳ Handler tests (users/me, users/update)
6. ⏳ Handler tests (media/upload-image)
7. ⏳ Permission tests
8. ⏳ Response helper tests

### **Week 3** (Nice to Have)
9. ⏳ Database helper tests
10. ⏳ Pagination tests
11. ⏳ Update helper tests

---

## 🔧 **Mocking Strategies**

### **Mock Database**

```typescript
vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([/* mock data */]),
      }),
    }),
  }),
}));
```

### **Mock AWS SDK**

```typescript
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));
```

### **Mock Environment Variables**

Already configured in `tests/unit/setup.ts`:

```typescript
beforeAll(() => {
  process.env.AWS_REGION = "us-east-1";
  process.env.STAGE = "test";
  // ... etc
});
```

---

## 📈 **CI/CD Integration**

Add to your GitHub Actions workflow:

```yaml
- name: Run Unit Tests
  run: pnpm test:unit

- name: Generate Coverage Report
  run: pnpm test:coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/coverage-final.json
```

---

## ✅ **Checklist**

- [x] Install Vitest
- [x] Create vitest.config.ts
- [x] Create test setup file
- [x] Create validation tests
- [x] Create error handling tests
- [ ] Create middleware tests
- [ ] Create handler tests
- [ ] Add test scripts to package.json
- [ ] Set up CI/CD integration
- [ ] Achieve 80%+ coverage

---

**Status**: Foundation complete, tests ready to write  
**Next**: Run `pnpm add -D vitest @vitest/ui @vitest/coverage-v8` and start testing!
