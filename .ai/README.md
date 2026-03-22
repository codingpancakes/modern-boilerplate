# AI Assistant Guide

Read these files in order:

1. **[CONTEXT.md](./CONTEXT.md)** — Project stack, directory structure, schema, env vars
2. **[PATTERNS.md](./PATTERNS.md)** — All code patterns with examples and checklist

Then look at existing handlers as reference:
- Simple: `src/node/handlers/users/me.ts`
- With S3: `src/node/handlers/media/upload-image.ts`
- GraphQL: `src/node/handlers/graphql/resolvers/users.ts`
- Webhook: `src/node/handlers/webhooks/workos.ts`

Handler templates are in `/templates/` (user-scoped, org-scoped, public).

## Critical Rules

- No try-catch in handlers (middleware handles errors)
- Zod for all input validation
- Drizzle ORM only (no raw SQL)
- `sanitizeObject()` before all DB writes
- `logAudit()` on all mutations
- Filter `status = "ACTIVE"` on all membership queries
- `ServerSideEncryption: "AES256"` on all S3 uploads
- Return CDN URLs, never raw S3 URLs or bucket names
- No secrets or PII in logs
