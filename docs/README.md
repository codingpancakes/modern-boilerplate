# Documentation

This folder contains documentation for the RailBranch backend boilerplate.

## Structure

### `/architecture` - Architecture Documentation
- **`README.md`** - Complete architecture guide with patterns, best practices, and examples

### `/api` - API Documentation
- **`openapi.json`** - OpenAPI/Swagger specification
- **`serve-docs.js`** - Local API documentation server

### `/guides` - How-To Guides
- **`TESTING.md`** - Complete testing guide (local, staging, production)
- **`CDK_TEARDOWN.md`** - How to tear down AWS infrastructure

---

## Quick Start

### For Developers
- **Architecture & Patterns**: See [`architecture/README.md`](./architecture/README.md)
- **API Reference**: Run `node docs/api/serve-docs.js` to view interactive API docs
- **Handler Templates**: See `templates/` folder in project root

### For DevOps
- **Infrastructure Teardown**: See [`guides/CDK_TEARDOWN.md`](./guides/CDK_TEARDOWN.md)

---

## Documentation Philosophy

We keep documentation:
- ✅ **Relevant** - Only what applies to the current codebase
- ✅ **Concise** - Clear and to the point
- ✅ **Up-to-date** - Reflects the actual implementation
- ✅ **Actionable** - Helps developers understand and use the code
- ✅ **Focused on final state** - Not historical records
