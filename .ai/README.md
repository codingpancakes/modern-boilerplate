# AI Assistant Guides

This directory contains guides specifically designed for AI coding assistants to understand and work with this codebase effectively.

## 📚 Available Guides

### 1. [CONTEXT.md](./CONTEXT.md) - **Start Here**
**Purpose:** Provides complete project context for AI assistants.

**Contains:**
- Project overview and tech stack
- Directory structure explanation
- Key concepts and patterns
- Environment variables
- Authentication flow
- Database schema overview
- Common tasks
- Important rules (DO/DON'T)

**When to read:** First time working with the project, or when you need to understand the big picture.

---

### 2. [PATTERNS.md](./PATTERNS.md) - **Code Standards**
**Purpose:** Defines all coding patterns and standards to follow.

**Contains:**
- Handler patterns (user-scoped, org-scoped, public)
- Validation pattern (Zod)
- Database pattern (Drizzle ORM)
- Error handling pattern
- Logging pattern
- Response format pattern
- Swagger documentation pattern
- File naming conventions
- Import order

**When to read:** Before writing any code. Reference this constantly to ensure consistency.

---

### 3. [TEMPLATES.md](./TEMPLATES.md) - **How-To Guide**
**Purpose:** Step-by-step guide for using handler templates.

**Contains:**
- Template selection guide
- Complete walkthrough for creating new handlers
- Template customization examples
- Common patterns (pagination, file upload, etc.)
- Checklist for new handlers

**When to read:** When creating a new API endpoint or handler.

---

## 🎯 Quick Reference

### For Creating a New Handler

1. **Read:** [TEMPLATES.md](./TEMPLATES.md) - Follow the step-by-step guide
2. **Reference:** [PATTERNS.md](./PATTERNS.md) - Ensure code follows standards
3. **Check:** [CONTEXT.md](./CONTEXT.md) - Verify environment setup

### For Understanding the Project

1. **Read:** [CONTEXT.md](./CONTEXT.md) - Get the big picture
2. **Browse:** `../src/node/handlers/` - See examples
3. **Reference:** [PATTERNS.md](./PATTERNS.md) - Understand the patterns

### For Debugging

1. **Check:** [CONTEXT.md](./CONTEXT.md) - Verify environment variables
2. **Review:** [PATTERNS.md](./PATTERNS.md) - Ensure following patterns
3. **Test:** `../tests/README.md` - Run integration tests

---

## 🤖 AI Assistant Workflow

### Initial Setup (First Time)
```
1. Read CONTEXT.md completely
2. Skim PATTERNS.md to understand standards
3. Review one example handler (e.g., users/me.ts)
4. You're ready to contribute!
```

### Creating New Code
```
1. Determine handler type (user-scoped, org-scoped, public)
2. Follow TEMPLATES.md step-by-step
3. Reference PATTERNS.md for specific patterns
4. Validate against checklist in TEMPLATES.md
```

### Reviewing/Modifying Code
```
1. Check if code follows PATTERNS.md
2. Verify handler structure matches template
3. Ensure all validations use Zod
4. Confirm database queries use Drizzle ORM
5. Check error handling (no try-catch)
```

---

## 📋 Key Principles

### ✅ Always Do
- Use templates from `/templates/` directory
- Follow patterns in PATTERNS.md
- Use Zod for all validation
- Use Drizzle ORM for database
- Let middleware handle errors
- Add comprehensive Swagger docs
- Write tests for new handlers

### ❌ Never Do
- Use raw SQL queries
- Use try-catch in handlers
- Parse JSON manually
- Skip input validation
- Hardcode values
- Use `any` types
- Skip documentation

---

## 🔍 Finding Information

| Need to find... | Look in... |
|----------------|------------|
| Project overview | CONTEXT.md |
| Code patterns | PATTERNS.md |
| How to create handler | TEMPLATES.md |
| Example handlers | `../src/node/handlers/` |
| Validation schemas | `../src/node/lib/validation.ts` |
| Database schema | `../src/node/db/schema.ts` |
| Testing guide | `../tests/README.md` |
| Contributing guide | `../CONTRIBUTING.md` |

---

## 💡 Tips for AI Assistants

### Understanding Context
- Always read CONTEXT.md first
- Project uses middleware pattern - no try-catch in handlers
- All validation uses Zod schemas
- Database uses Drizzle ORM - never raw SQL

### Writing Code
- Start with appropriate template
- Follow exact patterns from PATTERNS.md
- Reference existing handlers for examples
- Add comprehensive logging
- Include Swagger documentation

### Common Mistakes to Avoid
- ❌ Using try-catch blocks in handlers
- ❌ Parsing JSON manually instead of using `parseBody()`
- ❌ Writing raw SQL instead of using Drizzle
- ❌ Forgetting to add Zod schema
- ❌ Not registering route in local-dev/server.ts
- ❌ Skipping tests

### Best Practices
- ✅ Use templates as starting point
- ✅ Follow patterns consistently
- ✅ Add persistent logging context
- ✅ Validate all inputs
- ✅ Return standardized responses
- ✅ Write comprehensive tests

---

## 🆘 Troubleshooting

### "I don't know which template to use"
→ Read TEMPLATES.md section "Choose the Right Template"

### "I don't know how to validate input"
→ Read PATTERNS.md section "Validation Pattern"

### "I don't know how to query the database"
→ Read PATTERNS.md section "Database Pattern"

### "I don't know what error to throw"
→ Read PATTERNS.md section "Error Handling Pattern"

### "I need to see an example"
→ Look at `../src/node/handlers/users/me.ts` (simple example)
→ Look at `../src/node/handlers/media/upload-image.ts` (with S3)

---

## 📚 Additional Resources

- **Main README:** `../README.md`
- **Contributing Guide:** `../CONTRIBUTING.md`
- **Testing Guide:** `../tests/README.md`
- **Template Guide:** `../templates/README.md`
- **Architecture Docs:** `../docs/architecture/`

---

## 🎓 Learning Path

### Beginner
1. Read CONTEXT.md
2. Read one example handler
3. Follow TEMPLATES.md to create simple handler

### Intermediate
1. Read PATTERNS.md completely
2. Create handlers with validation
3. Add database queries

### Advanced
1. Create organization-scoped handlers
2. Add file upload functionality
3. Implement complex business logic

---

**Remember:** These guides are designed to help you write consistent, high-quality code. Always refer back to them when in doubt!
