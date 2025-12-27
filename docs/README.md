# Documentation

This folder contains documentation for the RailBranch backend boilerplate.

**Last Updated**: December 27, 2025  
**Status**: Consolidated & Production-Ready

## 🚀 Quick Links

- **[Quick Reference](./QUICK_REFERENCE.md)** - Essential commands for daily use
- **[Setup Guide](./SETUP_GUIDE.md)** - Initial project setup
- **[Testing Guide](./guides/TESTING.md)** - Complete testing guide
- **[GraphQL Guide](./GRAPHQL_GUIDE.md)** - GraphQL implementation & usage

---

## 📁 Documentation Structure

### **Essential Guides**
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Daily commands and workflows
- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Initial project setup
- **[AUDIT_CHECKLIST.md](./AUDIT_CHECKLIST.md)** - Project status & implementation tracking

### **API Documentation**
- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - REST API reference
- **[GRAPHQL_GUIDE.md](./GRAPHQL_GUIDE.md)** - GraphQL schema, resolvers, & usage
- **[api/openapi.json](./api/openapi.json)** - OpenAPI/Swagger specification
- **[api/serve-docs.js](./api/serve-docs.js)** - Local API documentation server

### **Infrastructure & DevOps**
- **[AWS_PIPELINE_SETUP.md](./AWS_PIPELINE_SETUP.md)** - CI/CD setup with CodePipeline
- **[SYNC_SECRETS.md](./SYNC_SECRETS.md)** - Environment variable management
- **[ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)** - Configuration reference
- **[LAMBDA_CONCURRENCY_DLQ.md](./LAMBDA_CONCURRENCY_DLQ.md)** - Lambda optimization guide
- **[SECURITY.md](./SECURITY.md)** - Security best practices

### **Architecture**
- **[architecture/README.md](./architecture/README.md)** - Complete architecture guide with patterns & examples

### **How-To Guides**
- **[guides/TESTING.md](./guides/TESTING.md)** - Unit, integration, & E2E testing
- **[guides/CDK_TEARDOWN.md](./guides/CDK_TEARDOWN.md)** - Infrastructure teardown

---

## 🎯 Quick Start

### **For Developers**
```bash
# Daily workflow
pnpm dev                    # Start local server
pnpm test                   # Run tests in watch mode
pnpm check                  # Lint + typecheck + tests

# View API docs
node docs/api/serve-docs.js # REST API docs
# GraphQL docs: http://localhost:3000/v1/graphql/docs
```

**Read:**
- [Quick Reference](./QUICK_REFERENCE.md) - Daily commands
- [Testing Guide](./guides/TESTING.md) - How to test
- [GraphQL Guide](./GRAPHQL_GUIDE.md) - GraphQL usage
- [Architecture](./architecture/README.md) - Patterns & best practices

### **For DevOps**
```bash
# Deployment
pnpm deploy:staging        # Deploy to staging
pnpm deploy:production     # Deploy to production

# Secrets management
pnpm sync-secrets          # Sync .env to AWS Secrets Manager
```

**Read:**
- [AWS Pipeline Setup](./AWS_PIPELINE_SETUP.md) - CI/CD configuration
- [Sync Secrets](./SYNC_SECRETS.md) - Environment variables
- [Lambda Concurrency](./LAMBDA_CONCURRENCY_DLQ.md) - Performance tuning

---

## 📊 Documentation Status

| Category | Files | Status |
|----------|-------|--------|
| **Setup & Getting Started** | 2 | ✅ Complete |
| **API Documentation** | 3 | ✅ Complete |
| **Testing** | 1 | ✅ Complete |
| **Infrastructure** | 5 | ✅ Complete |
| **Architecture** | 1 | ✅ Complete |
| **How-To Guides** | 2 | ✅ Complete |

**Total**: 14 essential documents (cleaned up from 20+)

---

## 🧹 Documentation Philosophy

We keep documentation:
- ✅ **Relevant** - Only what applies to the current codebase
- ✅ **Concise** - Clear and to the point
- ✅ **Up-to-date** - Reflects the actual implementation
- ✅ **Actionable** - Helps developers understand and use the code
- ✅ **Consolidated** - No duplicate or redundant docs
- ✅ **Focused on final state** - Not historical records

**Deleted**: Redundant testing docs, outdated caching strategy, one-time setup guides
