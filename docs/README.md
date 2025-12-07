# Documentation

This folder contains documentation for the RailBranch backend boilerplate.

## 🚀 Quick Links

- **[Quick Reference](./QUICK_REFERENCE.md)** - Essential commands for daily use
- **[AWS Pipeline Setup](./AWS_PIPELINE_SETUP.md)** - CI/CD setup guide
- **[Sync Secrets](./SYNC_SECRETS.md)** - Environment variable management
- **[Setup Guide](./SETUP_GUIDE.md)** - Initial project setup

---

## Structure

### Root Documentation
- **`QUICK_REFERENCE.md`** - Daily commands and workflows
- **`AWS_PIPELINE_SETUP.md`** - Complete CI/CD setup with CodePipeline
- **`SYNC_SECRETS.md`** - Automated secret syncing to AWS
- **`SETUP_GUIDE.md`** - Initial project setup
- **`UNIT_TESTING_GUIDE.md`** - Writing and running tests
- **`CACHING_STRATEGY.md`** - Caching implementation guide

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
- **Daily Commands**: See [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md)
- **Architecture & Patterns**: See [`architecture/README.md`](./architecture/README.md)
- **API Reference**: Run `node docs/api/serve-docs.js` to view interactive API docs
- **Testing**: See [`guides/TESTING.md`](./guides/TESTING.md)

### For DevOps
- **Pipeline Setup**: See [`AWS_PIPELINE_SETUP.md`](./AWS_PIPELINE_SETUP.md)
- **Environment Variables**: See [`SYNC_SECRETS.md`](./SYNC_SECRETS.md)
- **Infrastructure Teardown**: See [`guides/CDK_TEARDOWN.md`](./guides/CDK_TEARDOWN.md)

---

## Documentation Philosophy

We keep documentation:
- ✅ **Relevant** - Only what applies to the current codebase
- ✅ **Concise** - Clear and to the point
- ✅ **Up-to-date** - Reflects the actual implementation
- ✅ **Actionable** - Helps developers understand and use the code
- ✅ **Focused on final state** - Not historical records
