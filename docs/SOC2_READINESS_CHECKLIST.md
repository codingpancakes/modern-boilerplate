> **NOTE** — the per-criterion checklist further below still uses AWS platform names
> (Lambda, CloudWatch, CloudTrail, Secrets Manager, WAF stacks). The Cloudflare mapping
> for those is now consolidated in the **Observability & Evidence Trail** section
> immediately below; app-level controls (audit trail, validation, sanitization, RBAC,
> idempotency) are unchanged and current.

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
**Node.js Version:** 24.x (Lambda Runtime: NODEJS_24_X)  
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
- [x] **WorkOS JWT Authentication** - Enterprise SSO ready
- [x] **API Gateway Authorization** - Lambda authorizer validates all requests
- [x] **IAM Roles & Policies** - Least privilege for Lambda functions
- [x] **Secrets Management** - AWS Secrets Manager (no hardcoded credentials)
- [x] **MFA Support** - WorkOS handles MFA for user authentication
- [x] **Session Management** - Stateless JWT tokens with expiration

#### ✅ Network Security
- [x] **HTTPS Enforcement** - All API traffic encrypted in transit
- [x] **CORS Configuration** - Strict origin validation, no wildcards
- [x] **Rate Limiting** - API Gateway throttling (500-2000 req/sec)
- [x] **DDoS Protection** - CloudFront + WAFv2

#### ✅ Data Protection
- [x] **Encryption at Rest** - S3 buckets encrypted (AES-256)
- [x] **Encryption in Transit** - TLS 1.2+ for all connections
- [x] **Database Encryption** - Neon Postgres with encryption
- [x] **Input Validation** - Zod schemas + sanitization
- [x] **SQL Injection Prevention** - Drizzle ORM with parameterized queries
- [x] **XSS Prevention** - Comprehensive sanitization utilities

#### ✅ Monitoring & Logging
- [x] **CloudTrail** - All AWS API calls logged (audit trail)
- [x] **CloudWatch Logs** - Lambda execution logs
- [x] **CloudWatch Alarms** - Error rate, latency, throttles
- [x] **SNS Notifications** - Email alerts for critical issues
- [x] **X-Ray Tracing** - Distributed tracing with user context
- [x] **Cost Monitoring** - AWS Budgets with alerts

### Availability (90% Complete)

#### ✅ High Availability
- [x] **Multi-AZ Deployment** - Lambda runs across multiple AZs
- [x] **Auto-scaling** - Lambda scales automatically
- [x] **Health Checks** - `/v1/health` and `/v1/health/detailed` endpoints
- [x] **Dead Letter Queues** - Webhook failures captured
- [x] **Concurrency Management** - Handlers use unreserved pool with API Gateway throttling
- [x] **CloudWatch Dashboard** - Real-time system health visibility

#### ✅ Disaster Recovery
- [x] **Infrastructure as Code** - CDK for reproducible deployments
- [x] **Database Backups** - Neon automatic backups
- [x] **S3 Versioning** - (if enabled on buckets)
- [x] **CloudTrail Logs** - Stored in S3 with lifecycle policies

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
- ✅ CloudWatch logs: 1 month (prod), 1 week (staging) — automated via `LogRetentionAspect`
- ✅ CloudTrail logs: 1 year (365 days) — automated with Glacier transition
- ✅ Webhook DLQ: 14 days retention
- ✅ S3 lifecycle rules: delete old multipart uploads after 7 days
- ✅ Audit logs: 7 years target (Phase 1 infra in place, automated purge TBD)
- ✅ Data retention policy documented

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
- CloudWatch alarms trigger
- SNS email notifications sent
- On-call engineer notified

## Assessment
- Review CloudWatch logs
- Check X-Ray traces
- Analyze CloudTrail for unauthorized access
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
- AWS (SOC 2 compliant ✅)
- WorkOS (SOC 2 compliant ✅)
- Neon (SOC 2 compliant ✅)
- Sentry (SOC 2 compliant ✅)
- CloudFront + WAFv2 (AWS SOC 2 compliant ✅)

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
- ✅ `pnpm audit --audit-level=high` runs in `buildspec.yml` (non-blocking)
- ✅ Biome lint + TypeScript strict checking in CI

**What's Missing:**
- No SAST (Static Application Security Testing)
- No IaC security scanning (e.g. cdk-nag, Checkov)
- `pnpm audit` is non-blocking — should be made a blocking gate

**What You Need:**
```yaml
# Add to buildspec.yml or GitHub Actions
- name: Dependency Scanning
  run: |
    pnpm audit --audit-level=high
    # Or use Snyk, Dependabot, etc.

- name: SAST Scanning
  run: |
    # Use Semgrep, SonarQube, or CodeQL
    
- name: IaC Scanning
  run: |
    # Use Checkov, tfsec, or AWS CDK nag
```

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
- AWS KMS for customer-managed keys
- Key rotation policies
- Key access logging

**Estimated Time:** 8 hours

---

#### 13. **Network Segmentation**
- VPC for Lambda functions
- Private subnets for databases
- Security groups and NACLs

**Estimated Time:** 16 hours

---

#### 14. **Least Privilege IAM**
- Replace AdministratorAccess in pipeline
- Granular IAM policies per Lambda
- Regular access reviews

**Estimated Time:** 8 hours

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
11. **KMS** (8 hours)
12. **Network Segmentation** (16 hours)
13. **Least Privilege IAM** (8 hours)

**Total: 44 hours**

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
- [ ] Audit logs (7 years)
- [ ] CloudTrail logs (1 year)
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
- ✅ CloudWatch log retention (automated)
- ✅ CloudTrail retention with lifecycle (automated)
- ✅ Webhook DLQ retention (automated)
- ✅ S3 lifecycle rules (automated)

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
