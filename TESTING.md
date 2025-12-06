# Testing Guide

## 🧪 Test Suite Overview

This project includes comprehensive unit tests to ensure code quality and catch regressions early.

### Test Statistics
- **Total Tests**: 29
- **Test Files**: 3
- **Execution Time**: ~270ms
- **Coverage**: Auth helpers, Error handling, Validation schemas

---

## 📦 Available Commands

### Development
```bash
pnpm test          # Run tests in watch mode (auto-rerun on file changes)
pnpm test:ui       # Open visual test UI in browser
```

### CI/CD
```bash
pnpm test:run      # Run tests once (for CI pipelines)
pnpm check         # Run lint + typecheck + tests
pnpm build         # Full build: check + test + compile + docs
```

---

## 🎯 Test Coverage

### 1. Auth Helpers (`tests/unit/lib/auth.test.ts`)
**6 tests** - Validates JWT claims extraction from API Gateway authorizer context

- ✅ Extract claims from lambda authorizer
- ✅ Throw error if `sub` claim missing
- ✅ Throw error if no claims exist
- ✅ Extract WorkOS user ID from claims
- ✅ Extract org ID from claims
- ✅ Handle missing org ID gracefully

**Why it matters**: Ensures authentication doesn't break when refactoring middleware or auth logic.

---

### 2. Error Handling (`tests/unit/lib/errors.test.ts`)
**12 tests** - Validates error creation and formatting

- ✅ Create ApiError with correct status codes
- ✅ Validate all error factory methods (Unauthorized, Forbidden, NotFound, etc.)
- ✅ Format errors correctly for API responses
- ✅ Include request IDs and timestamps
- ✅ Handle unknown errors as 500 Internal Server Error

**Why it matters**: Ensures consistent error responses across all API endpoints. Client apps depend on this format.

---

### 3. Validation Schemas (`tests/unit/lib/validation-schemas.test.ts`)
**11 tests** - Validates Zod schemas for media uploads

- ✅ Accept valid image upload requests
- ✅ Reject invalid content types
- ✅ Reject empty filenames
- ✅ Validate direct upload with base64 data
- ✅ Validate list images query parameters
- ✅ Enforce limit constraints (1-100)
- ✅ Coerce string numbers to integers

**Why it matters**: Prevents invalid data from reaching handlers. Security layer against malicious input.

---

## 🔄 Workflow Integration

### Pre-Commit
```bash
# Before committing code
pnpm check
git add .
git commit -m "feat: add new feature"
```

### CI/CD Pipeline
```yaml
# Recommended GitHub Actions workflow
- run: pnpm install
- run: pnpm check        # Lint + typecheck + tests
- run: pnpm build        # Full build with tests
```

### Before Deployment
```bash
# Ensure everything passes before deploying
pnpm check && pnpm run deploy:staging
```

---

## 📊 Test Output Example

```
✓ tests/unit/lib/validation-schemas.test.ts (11 tests) 3ms
✓ tests/unit/lib/errors.test.ts (12 tests) 6ms
✓ tests/unit/lib/auth.test.ts (6 tests) 2ms

Test Files  3 passed (3)
     Tests  29 passed (29)
  Start at  19:57:53
  Duration  270ms
```

---

## 🚀 Future Test Additions

### Integration Tests (Recommended)
Test deployed Lambda functions against real AWS services:
```typescript
// tests/integration/auth-identity-mapping.test.ts
test('getUserIdFromClaims returns correct internal user ID', async () => {
  // Test with real database connection
  // Verify WorkOS subject maps to internal UUID
});
```

### CDK Infrastructure Tests
Validate CDK stack configuration:
```typescript
// tests/infrastructure/api-stack.test.ts
test('API Gateway has WorkOS authorizer configured', () => {
  const template = Template.fromStack(apiStack);
  // Verify infrastructure is correct
});
```

### E2E Tests
Test complete API flows:
```typescript
// tests/e2e/media-upload.test.ts
test('User can upload and retrieve images', async () => {
  // Test full flow: auth → upload → list → verify
});
```

---

## 🎯 Best Practices

1. **Run tests during development** - Use watch mode (`pnpm test`)
2. **Always run before committing** - Use `pnpm check`
3. **Keep tests fast** - Current suite runs in <300ms
4. **Write tests for bug fixes** - Prevent regressions
5. **Test critical paths** - Auth, validation, error handling

---

## 🐛 Debugging Failed Tests

### View detailed output
```bash
pnpm test:run --reporter=verbose
```

### Run specific test file
```bash
pnpm test tests/unit/lib/auth.test.ts
```

### Run with UI for debugging
```bash
pnpm test:ui
```

---

## 📝 Notes

- Tests use **Vitest** (fast, modern test runner)
- Path aliases configured: `@/*` → `src/node/*`
- Test setup in `tests/unit/setup.ts`
- Configuration in `vitest.config.ts`
- TypeScript paths configured in `tsconfig.json`

---

## ✅ Current Status

- ✅ **29/29 tests passing**
- ✅ **Lint checks passing**
- ✅ **TypeScript checks passing**
- ✅ **Build successful**
- ✅ **Ready for deployment**
