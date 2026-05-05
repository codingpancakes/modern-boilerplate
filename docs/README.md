# Documentation

## Setup & Operations
- [Setup Guide](./BOILERPLATE_SETUP.md) — First-time project setup from zero
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) — All env vars, secrets, SSM params
- [CDK Teardown](./guides/CDK_TEARDOWN.md) — How to destroy AWS stacks
- [Lambda & DLQ](./LAMBDA_CONCURRENCY_DLQ.md) — Concurrency settings, dead letter queues

## Security & Compliance
- [Security Model](./SECURITY.md) — Auth, CORS, WAF, origin verification, blue-green deploys, error masking
- [Audit Logging](./AUDIT_LOGGING_GUIDE.md) — Audit trail patterns and integration
- [Data Retention](./DATA_RETENTION_POLICY.md) — Retention policies per data type
- [SOC 2 Checklist](./SOC2_READINESS_CHECKLIST.md) — Compliance readiness tracker

## Development
- [Testing Guide](./guides/TESTING.md) — Unit + integration testing
- [Handler Templates](../templates/README.md) — How to create new handlers
- [Python Handlers](../src/python/README.md) — Python Lambda guide

## AI Rules
Pattern enforcement for AI coding assistants lives in `../.cursor/rules/`.
