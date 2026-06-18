> **NOTE** — this checklist describes the **current Cloudflare stack** (Workers, R2,
> Queues, the `scripts/deploy.ts` canary, Sentry, Cloudflare Account Audit Logs, and
> the application `audit_logs` table). The **Observability & Evidence Trail** section
> immediately below maps each old AWS control to its Cloudflare replacement. App-level
> controls (audit trail, validation, sanitization, RBAC, idempotency) carried over
> unchanged. Note: an **application-level per-IP rate limiter** is in place
> (`RATE_LIMITER` binding + `lib/hono/rate-limit.ts`); it is per-colo and pairs with
> Cloudflare zone rate-limiting rules and platform DDoS (see `docs/SECURITY.md`).

# 🔒 SOC 2 Compliance Readiness Checklist

## Observability & Evidence Trail (Cloudflare mapping)

What an auditor asks for, and where it lives on the current stack:

| Evidence | AWS (before) | Cloudflare (now) | Status |
|---|---|---|---|
| **Application audit trail** (who did what to data) | RDS audit table | `audit_logs` — immutable (UPDATE/in-window-DELETE rejected), **7-year** retention, secret-redacted, written on every mutation via `logAudit` | ✅ present |
| **Infra / account change log** | CloudTrail | **Cloudflare Account Audit Logs** (built-in, all plans, dashboard → Manage Account → Audit Log) — records API tokens, deploys, R2/queue/secret changes | ✅ built-in |
| **Request / platform logs** | CloudWatch Logs | **Workers Logs** (`[observability] enabled` in `wrangler.toml`) — invocations, console output, errors; in-dashboard, short retention | ✅ enabled |
| **Error alerting** | CloudWatch Alarms → SNS | **Sentry** (`app.onError` → `captureException`) + Cloudflare notifications | ✅ wired (set a Sentry alert rule) |
| **Deploy safety / change mgmt** | CodeDeploy blue-green | `scripts/deploy.ts` — health-gated canary + auto-rollback; CI gate on every push | ✅ present |
| **Async failure durability** | SQS DLQ | Cloudflare **Queues** `max_retries=5` → dead-letter queue → Sentry + `WEBHOOK_FAILED` audit | ✅ present |
| **Long-term log export** (optional forensics) | CloudWatch → S3 | **Logpush → R2** | ⬜ optional — see below |

**Logpush note:** exporting Workers request logs to R2/external for long-term retention
is **Enterprise-gated** and configured via the Cloudflare dashboard/API (not `wrangler`).
It is *not* required for the audit evidence above — the application `audit_logs` table is
the primary SOC 2 record and already has 7-year retention. Add Logpush only if you need
raw request-log forensics beyond Workers Logs' window; on Workers Paid the code-level
alternative is a Tail Worker (`tail_consumers`) shipping trace events to R2.

---


**Generated:** December 10, 2025  
**Last Updated:** March 2026  
**Current Status:** ~72% Ready (Audit logging Phase 1 complete)  
**Runtime:** Cloudflare Workers (`nodejs_compat`, Node.js 24.x APIs)  
**Estimated Time to Compliance:** 55-75 hours (1.5-2 weeks)

---

## 📋 SOC 2 Trust Service Criteria Overview

SOC 2 compliance is based on 5 Trust Service Criteria (TSC):
1. **Security** - Protection against unauthorized access
2. **Availability** - System is available for operation and use
3. **Processing Integrity** - System processing is complete, valid, accurate, timely
4. **Confidentiality** - Confidential information is protected
5. **Privacy** - Personal information is collected, used, retained, disclosed appropriately

---

## ✅ WHAT YOU ALREADY HAVE (~72%)

### Security (80% Complete)

#### ✅ Access Controls
- [x] **WorkOS JWT Authentication** - Enterprise SSO ready; verified in `requireAuth()` middleware (RS256-pinned, JWKS-cached, `client_id` audience binding)
- [x] **Request authorization** - Every protected domain runs `requireAuth()` in the Worker (`src/node/lib/hono/auth.ts` → `authorizers/verify-token.ts`) — no separate gateway/authorizer
- [x] **Least-privilege account access** - Cloudflare account roles + scoped API tokens (account-level config); no AWS IAM
- [x] **Secrets Management** - Cloudflare Workers secrets (`wrangler secret put`, stdin-only sync); no hardcoded credentials, none in `wrangler.toml` or git
- [x] **MFA Support** - WorkOS handles MFA for user authentication
- [x] **Session Management** - Stateless JWT tokens with expiration

#### ✅ Network Security
- [x] **HTTPS Enforcement** - Cloudflare TLS termination + HSTS header on every response
- [x] **CORS Configuration** - Strict dynamic origin validation, no wildcards (`src/node/lib/cors.ts`)
- [x] **Rate Limiting** - Application-level per-IP limiter in the Worker (`RATE_LIMITER` binding + `src/node/lib/hono/rate-limit.ts`, 429 past 100 req/60s; see `docs/SECURITY.md`). Per-colo/approximate, so it pairs with Cloudflare zone rate-limiting rules (per-path/global) — both layers are in use.
- [x] **DDoS Protection** - Cloudflare always-on DDoS mitigation + optional WAF managed rulesets (account-level config, not code)

#### ✅ Data Protection
- [x] **Encryption at Rest** - Cloudflare R2 object storage encrypted at rest
- [x] **Encryption in Transit** - TLS 1.2+ for all connections (Cloudflare edge + Neon)
- [x] **Database Encryption** - Neon Postgres with encryption
- [x] **Input Validation** - Zod schemas + sanitization
- [x] **SQL Injection Prevention** - Drizzle ORM with parameterized queries
- [x] **XSS Prevention** - Comprehensive sanitization utilities (`src/node/lib/sanitize.ts`)

#### ✅ Monitoring & Logging
- [x] **Application audit trail** - `audit_logs` table, immutable, 7-year retention, written on every mutation via `logAudit` (the primary SOC 2 evidence record)
- [x] **Account / infra change log** - Cloudflare Account Audit Logs (built-in; API tokens, deploys, R2/queue/secret changes)
- [x] **Request / platform logs** - Workers Logs (`[observability] enabled` in `wrangler.toml`)
- [x] **Error alerting** - Sentry (`app.onError` → `captureException`) + Cloudflare notifications
- [ ] **Distributed tracing** - Not configured; optional Tail Worker (`tail_consumers`) is the Workers-native path if needed
- [x] **Cost / usage visibility** - Cloudflare dashboard usage + billing alerts (account-level)

### Availability (90% Complete)

#### ✅ High Availability
- [x] **Global edge runtime** - Workers run across Cloudflare's global network; no single region/AZ to lose
- [x] **Auto-scaling** - Workers scale horizontally with no concurrency ceiling (no Lambda pool to exhaust)
- [x] **Health Checks** - `/v1/health` and `/v1/health/detailed` endpoints (the latter gates every canary deploy)
- [x] **Dead Letter Queues** - Cloudflare Queues `max_retries=5` → dead-letter queue → Sentry + `WEBHOOK_FAILED` audit
- [x] **Deploy safety** - Health-gated canary + auto-rollback (`scripts/deploy.ts`) so a bad version self-reverts
- [x] **Observability** - Workers Logs + Sentry for real-time health visibility

#### ✅ Disaster Recovery
- [x] **Config as code** - `wrangler.toml` (Worker config, bindings, cron triggers) is versioned in git; deploys are reproducible
- [x] **Database Backups** - Neon automatic backups + point-in-time restore
- [x] **Atomic versioned deploys** - Cloudflare keeps prior Worker versions; `wrangler rollback` reverts in seconds
- [x] **Account audit trail** - Cloudflare Account Audit Logs (built-in, all plans)

### Processing Integrity (70% Complete)

#### ✅ Data Validation
- [x] **Input Validation** - Zod schemas for all inputs
- [x] **Error Handling** - Consistent error responses
- [x] **Transaction Support** - Interactive DB transactions via the `neon-serverless` (WebSocket) driver; multi-step writes (provisioning, profile/org mutations) commit atomically or roll back
- [x] **Idempotency Keys** - (if implemented for critical operations)

---

## ❌ WHAT'S MISSING FOR SOC 2 (~28%)

### 🔴 CRITICAL GAPS (Must Have)

#### 1. **Application-Level Audit Logging** ✅ PHASE 1 COMPLETE
**SOC 2 Requirement:** CC6.3, CC7.2 - Log all user actions

**Status:** ✅ Phase 1 Complete (December 11, 2025 - February 1, 2026)

**What Was Implemented:**
- ✅ `auditLogs` table with 14 columns and 6 indexes
- ✅ Tracks: userId, organizationId, action, resourceType, resourceId
- ✅ Captures: changes (before/after), IP address, user agent, request ID
- ✅ Includes: timestamp, metadata, status, error messages
- ✅ Foreign keys to users and organizations (with SET NULL on delete)

**Files Created:**
- `src/node/db/schema/audit.ts` - Audit logs table schema
- `src/node/lib/audit.ts` - Audit logging utilities
- `src/node/db/migrations/` - Database migration (audit logs table)
- `docs/AUDIT_LOGGING_GUIDE.md` - Complete usage documentation

**Features:**
- ✅ Direct logging: `logAudit()` function
- ✅ Request context extraction: `extractRequestContext()`
- ✅ GraphQL decorator: `auditResolver()` wrapper
- ✅ Standard action types: LOGIN, CREATE, UPDATE, DELETE, etc.
- ✅ Standard resource types: USER, PROFILE, ORGANIZATION, MEDIA, WEBHOOK, etc.
- ✅ Automatic request context extraction
- ✅ Error handling (never breaks main flow)

**Current Handler Coverage (50%):**
- ✅ REST: `users/update.ts` (full audit with before/after)
- ✅ GraphQL: `updateMe`, `updateProfile` (with auditResolver)
- ✅ Webhooks: `workos.ts` (user create/update events)
- ❌ REST: `media/upload-image.ts` (not yet implemented)
- ❌ REST: `media/upload-image-direct.ts` (not yet implemented)
- ❌ GraphQL: `generateImageUploadUrl` (not yet implemented)

**Next Steps:**
1. ✅ Migration deployed: `pnpm migrate`
2. ⚠️ Expand to media handlers (3 hours remaining)
3. Add audit log query API endpoint (6 hours, optional)
4. Add automated cleanup job for 7-year retention (4 hours, optional)

**Time Spent:** ~8 hours (Phase 1)  
**Remaining:** ~3 hours (Phase 2 - media handlers)  
**Priority:** ✅ PHASE 1 COMPLETE, Phase 2 recommended

---

#### 2. **Data Retention & Deletion Policies** ✅ COMPLETE
**SOC 2 Requirement:** CC6.5, P4.2 - Define and enforce data retention

**Status:** Documented in `docs/DATA_RETENTION_POLICY.md`

**What's Implemented:**
- ✅ Application `audit_logs`: 7-year retention, automated purge job (`handlers/utils/audit-retention.ts` cron trigger)
- ✅ Workers Logs: in-dashboard, short platform retention (extend via Logpush → R2 if needed)
- ✅ Cloudflare Account Audit Logs: platform-retained account/infra change record
- ✅ Webhook failures: Cloudflare Queues DLQ (`max_retries=5`)
- ✅ Janitor cron (`handlers/utils/janitor.ts`) cleans expired idempotency/transient rows
- ✅ Data retention policy documented (`docs/DATA_RETENTION_POLICY.md`)

**Optional Enhancements (only if needed for GDPR/CCPA):**
- Soft delete for users (4 hours) — add `deletedAt` column + cleanup job
- Data export API (4 hours) — `GET /v1/users/me/export`

---

#### 3. **Incident Response Plan** ⚠️ MISSING
**SOC 2 Requirement:** CC7.3, CC7.4 - Document incident response procedures

**What's Missing:**
- No documented incident response plan
- No security incident runbook
- No breach notification procedures
- No incident escalation matrix

**What You Need:**
```markdown
# Incident Response Plan

## Detection
- Sentry alert rule fires (errors/regressions)
- Cloudflare notification (security/availability events)
- On-call engineer notified

## Assessment
- Review Workers Logs (in-dashboard)
- Review Sentry issue + breadcrumbs
- Review application `audit_logs` for the affected resource/user
- Analyze Cloudflare Account Audit Logs for unauthorized account/infra changes
- Determine severity (P0-P4)

## Containment
- Rotate compromised credentials
- Block malicious IPs
- Disable affected accounts
- Roll back to last known good state

## Recovery
- Deploy fixes
- Verify system health
- Monitor for 24 hours

## Post-Mortem
- Document root cause
- Update runbooks
- Implement preventive measures
```

**Estimated Time:** 8 hours  
**Priority:** CRITICAL

---

#### 4. **Vendor Risk Management** ⚠️ MISSING
**SOC 2 Requirement:** CC9.2 - Assess third-party vendors

**What's Missing:**
- No vendor security assessment documentation
- No vendor SOC 2 reports on file
- No vendor SLA documentation

**Your Vendors:**
- Cloudflare — Workers, R2, Queues, WAF/DDoS (SOC 2 compliant ✅)
- WorkOS (SOC 2 compliant ✅)
- Neon (SOC 2 compliant ✅)
- Sentry (SOC 2 compliant ✅)

**What You Need:**
- Collect SOC 2 reports from all vendors
- Document vendor security assessments
- Maintain vendor inventory
- Review vendor compliance annually

**Estimated Time:** 4 hours  
**Priority:** CRITICAL

---

#### 5. **Security Scanning in CI/CD** ⚠️ MISSING
**SOC 2 Requirement:** CC8.1 - Detect and respond to security threats

**What Exists:**
- ✅ `pnpm check` (Biome lint + TypeScript strict + tests) gates every push in CI

**What's Missing:**
- No dependency vulnerability gate (`pnpm audit`) in CI
- No SAST (Static Application Security Testing)

**What You Need:**
```yaml
# Add to the GitHub Actions workflow
- name: Dependency Scanning
  run: |
    pnpm audit --audit-level=high
    # Or use Snyk, Dependabot, etc.

- name: SAST Scanning
  run: |
    # Use Semgrep, SonarQube, or CodeQL
```
(There is no infrastructure-as-code to scan — config lives in `wrangler.toml`,
managed by the Cloudflare platform.)

**Estimated Time:** 6 hours  
**Priority:** HIGH

---

#### 6. **Backup & Recovery Testing** ⚠️ MISSING
**SOC 2 Requirement:** A1.2 - Test backup and recovery procedures

**What's Missing:**
- No documented backup procedures
- No recovery time objective (RTO) defined
- No recovery point objective (RPO) defined
- No disaster recovery drills performed

**What You Need:**
- Document backup procedures
- Define RTO (e.g., 4 hours) and RPO (e.g., 1 hour)
- Test database restore quarterly
- Test infrastructure redeployment
- Document recovery procedures

**Estimated Time:** 8 hours  
**Priority:** HIGH

---

#### 7. **Change Management Process** ⚠️ MISSING
**SOC 2 Requirement:** CC8.1 - Manage changes to systems

**What's Missing:**
- No formal change approval process
- No change log/changelog
- No rollback procedures documented

**What You Need:**
- Implement pull request reviews (already have GitHub ✅)
- Require approval for production deployments
- Maintain CHANGELOG.md
- Document rollback procedures
- Track all infrastructure changes

**Estimated Time:** 4 hours  
**Priority:** MEDIUM

---

#### 8. **Employee Background Checks** ⚠️ MISSING
**SOC 2 Requirement:** CC1.4 - Screen personnel

**What You Need:**
- Background checks for all employees with production access
- Document screening procedures
- Maintain records of checks performed

**Estimated Time:** N/A (HR process)  
**Priority:** MEDIUM

---

#### 9. **Security Awareness Training** ⚠️ MISSING
**SOC 2 Requirement:** CC1.4 - Train personnel on security

**What You Need:**
- Annual security training for all employees
- Phishing awareness training
- Document training completion
- Test employee awareness

**Estimated Time:** N/A (HR process)  
**Priority:** MEDIUM

---

#### 10. **Penetration Testing** ⚠️ MISSING
**SOC 2 Requirement:** CC7.1 - Test security controls

**What You Need:**
- Annual penetration test by third party
- Vulnerability assessment
- Remediate findings
- Document results

**Estimated Time:** N/A (hire third party)  
**Cost:** $5,000-$15,000  
**Priority:** HIGH

---

### 🟡 NICE TO HAVE (Not Required but Helpful)

#### 11. **Data Loss Prevention (DLP)**
- Monitor for sensitive data leakage
- Prevent accidental exposure of PII/secrets

**Estimated Time:** 12 hours

---

#### 12. **Encryption Key Management**
- Cloudflare manages encryption keys for Workers secrets and R2 at rest
- Document secret-rotation procedure (rotate = `wrangler secret put`, which redeploys)
- Key/secret access is recorded in Cloudflare Account Audit Logs

**Estimated Time:** 8 hours

---

#### 13. **Network controls**
- N/A at the infra layer — the Worker runs at the edge with no VPC/subnets to segment
- DB access is over TLS to Neon; restrict Neon access by IP allowlist / connection limits if required

**Estimated Time:** 4 hours

---

#### 14. **Least-privilege account access**
- Use scoped Cloudflare API tokens (not the global key) for CI/deploy
- Assign minimal Cloudflare account roles; review access periodically
- (No AWS IAM; nothing to de-privilege there)

**Estimated Time:** 4 hours

---

## 📊 SOC 2 READINESS SUMMARY

### By Trust Service Criteria

| Criteria | Current | Missing | Readiness |
|----------|---------|---------|-----------|
| **Security** | 80% | Audit logs, scanning, pen test | 🟡 |
| **Availability** | 90% | Backup testing, DR drills | 🟢 |
| **Processing Integrity** | 70% | Audit logs, data validation | 🟡 |
| **Confidentiality** | 85% | DLP, key management | 🟢 |
| **Privacy** | 75% | Just need documentation + optional GDPR | 🟡 |

### Overall Readiness: ~72%

---

## 🎯 IMPLEMENTATION ROADMAP

### Phase 1: Critical Gaps (1.5-2 weeks)
**Must complete before SOC 2 audit**

1. **Application Audit Logging** — Phase 1 COMPLETE
   - `auditLogs` table, `logAudit()`, `auditResolver()` implemented
   - Remaining: expand coverage to media handlers (~3 hours)

2. **Data Retention Documentation** — COMPLETE
   - Documented in `docs/DATA_RETENTION_POLICY.md`
   - Optional: Add GDPR features if needed (8 hours)

3. **Incident Response Plan** (8 hours) - **DOCUMENTATION**
   - Write incident response procedures
   - Create runbooks
   - Define escalation matrix
   - Test incident response

4. **Vendor Risk Management** (4 hours) - **COLLECT REPORTS**
   - Collect vendor SOC 2 reports
   - Document vendor assessments
   - Create vendor inventory

5. **Security Scanning** (6 hours) - **CODE/CONFIG**
   - Add Snyk/Dependabot
   - Add SAST scanning
   - Add IaC scanning

6. **Backup Testing** (8 hours) - **DOCUMENTATION + TESTING**
   - Document backup procedures
   - Define RTO/RPO
   - Test database restore
   - Test infrastructure redeploy

**Total: 35 hours (1 week) - Down from 46 hours!**

---

### Phase 2: High Priority (2 weeks)

7. **Penetration Testing** (hire third party)
   - Schedule annual pen test
   - Remediate findings
   - Document results

8. **Change Management** (4 hours)
   - Document change process
   - Create CHANGELOG.md
   - Document rollback procedures

9. **Security Training** (HR process)
   - Implement annual training
   - Track completion

**Total: 4 hours + pen test**

---

### Phase 3: Nice to Have (1 week)

10. **DLP** (12 hours)
11. **Secret/key management procedure** (8 hours)
12. **Network controls (Neon access restriction)** (4 hours)
13. **Least-privilege account access** (4 hours)

**Total: 28 hours**

---

## 💰 ESTIMATED COSTS

### One-Time Costs
- **Penetration Testing:** $5,000-$15,000
- **SOC 2 Audit:** $15,000-$50,000 (depends on auditor)
- **Total:** $20,000-$65,000

### Ongoing Costs
- **Annual Pen Test:** $5,000-$15,000
- **Annual SOC 2 Audit:** $10,000-$30,000 (renewal)
- **Security Training:** $500-$2,000/year
- **Total:** $15,500-$47,000/year

---

## 📋 DOCUMENTATION REQUIRED

### Policies & Procedures
- [ ] Information Security Policy
- [ ] Access Control Policy
- [x] Data Retention & Deletion Policy
- [ ] Incident Response Plan
- [ ] Disaster Recovery Plan
- [ ] Change Management Procedures
- [ ] Vendor Risk Management Policy
- [ ] Security Awareness Training Program
- [ ] Backup & Recovery Procedures

### Technical Documentation
- [ ] System Architecture Diagram
- [ ] Data Flow Diagrams
- [ ] Network Topology
- [ ] Encryption Standards
- [ ] Monitoring & Alerting Configuration
- [ ] Audit Log Retention
- [ ] Access Control Matrix

### Evidence Collection
- [ ] Application audit logs (7 years)
- [ ] Cloudflare Account Audit Logs export
- [ ] Access reviews (quarterly)
- [ ] Vulnerability scans (monthly)
- [ ] Penetration test reports (annual)
- [ ] Training completion records
- [ ] Vendor SOC 2 reports
- [ ] Incident response records

---

## ✅ NEXT STEPS

### Immediate Actions (This Week)
1. ~~Create `auditLogs` table and middleware~~ (DONE)
2. ~~Document data retention policy~~ (DONE)
3. Write incident response plan
4. Collect vendor SOC 2 reports

### Short Term (This Month)
5. Add security scanning to CI/CD
6. Test backup and recovery procedures
7. Document change management process
8. Schedule penetration test

### Long Term (Next Quarter)
9. Complete all policy documentation
10. Conduct SOC 2 readiness assessment
11. Hire SOC 2 auditor
12. Begin formal audit process

---

## 📞 RESOURCES

### SOC 2 Auditors
- Deloitte
- PwC
- KPMG
- Vanta (automated compliance)
- Drata (automated compliance)

### Security Tools
- **Snyk** - Dependency scanning
- **Semgrep** - SAST scanning
- **Vanta** - Compliance automation
- **Drata** - Compliance automation
- **OneTrust** - Privacy management

---

**Last Updated:** March 2026  
**Next Review:** After expanding audit coverage to all handlers

---

## 🎯 BOTTOM LINE

**You're ~72% ready for SOC 2!**

Your infrastructure is **excellent** - you already have:
- ✅ Application `audit_logs` with 7-year retention + automated purge cron
- ✅ Cloudflare Account Audit Logs (built-in account/infra change record)
- ✅ Workers Logs + Sentry error alerting
- ✅ Cloudflare Queues DLQ for webhook failures (automated)
- ✅ Health-gated canary deploy with auto-rollback (`scripts/deploy.ts`)

**The main gaps are:**

1. ~~Application audit logging~~ (DONE — expand coverage: 3 hours)
2. ~~Data retention documentation~~ (DONE)
3. **Incident response plan** (8 hours) - **DOCUMENTATION**
4. **Security scanning** (6 hours) - **CODE/CONFIG**
5. **Vendor reports** (4 hours) - **COLLECT PDFs**

**Total time to SOC 2 ready:** 55-75 hours (1.5-2 weeks) - **Even better than expected!**  
**Total cost:** $20,000-$65,000 (one-time) + $15,500-$47,000/year

**Key Insight:** Audit logging Phase 1 and data retention policy are complete. The remaining work is mostly expanding audit coverage to media handlers (~3 hours) and completing procedural documentation (~20 hours total).

**Recommendation:** If pursuing SOC 2, expand audit logging to media handlers (3 hours), write incident response plan (8 hours), and complete vendor risk documentation (4 hours).
