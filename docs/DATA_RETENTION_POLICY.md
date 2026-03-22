# 📋 Data Retention Policy

**Effective Date:** December 10, 2025  
**Last Updated:** December 10, 2025  
**Version:** 1.0

---

## 📊 Overview

This document defines the data retention and deletion policies for the RailBranch platform. All retention periods are automatically enforced through infrastructure configuration and lifecycle policies.

---

## 🔧 Infrastructure Logs

### CloudWatch Logs
**Purpose:** Application logs, Lambda execution logs, error tracking

**Retention:**
- **Production:** 30 days (1 month)
- **Staging:** 7 days (1 week)

**Implementation:**
- Automated via `LogRetentionAspect` in CDK
- Applied to all Lambda functions
- File: `infrastructure/lib/utils/log-retention-aspect.ts`

**Justification:**
- Production logs kept longer for debugging and incident investigation
- Staging logs kept shorter to reduce costs
- Sufficient for operational needs and troubleshooting

---

### CloudTrail Logs
**Purpose:** AWS API call audit trail, security monitoring, compliance

**Retention:**
- **All Environments:** 365 days (1 year)

**Lifecycle:**
- **0-30 days:** Standard S3 storage
- **30-365 days:** Glacier storage (cost optimization)
- **After 365 days:** Automatically deleted

**Implementation:**
- Automated via S3 lifecycle rules
- File: `infrastructure/lib/cloudtrail-stack.ts`
- Multi-region trail with log file validation

**Justification:**
- 1 year retention meets most compliance requirements (SOC 2, ISO 27001)
- Glacier transition reduces storage costs by ~90%
- Sufficient for security audits and forensics

---

### Webhook Dead Letter Queue (DLQ)
**Purpose:** Failed webhook events for debugging and replay

**Retention:**
- **All Environments:** 14 days

**Implementation:**
- SQS queue with automatic message expiration
- File: `infrastructure/lib/routes/public-routes.ts`
- Encrypted with SQS-managed encryption

**Justification:**
- 14 days provides sufficient time to investigate and replay failed webhooks
- Prevents indefinite accumulation of failed messages
- Balances operational needs with storage costs

---

### S3 Lifecycle Rules
**Purpose:** Clean up incomplete multipart uploads

**Retention:**
- **Incomplete multipart uploads:** 7 days

**Implementation:**
- Automated via S3 lifecycle rules
- Applied to media and public assets buckets
- Files: `infrastructure/lib/media-stack.ts`, `infrastructure/lib/public-assets-stack.ts`

**Justification:**
- Prevents storage costs from abandoned uploads
- 7 days allows time to complete legitimate uploads
- Industry standard practice

---

## 👤 Application Data

### User Accounts
**Retention:** Hard-deleted immediately upon request

**Process:**
1. User requests account deletion via support or API
2. Account and associated data deleted immediately
3. No soft delete or grace period (unless GDPR requires it)

**Cascade Deletion:**
- User profile
- Auth identities
- Organization memberships (if sole owner, organization is also deleted)
- User-created content (profiles, media, organization data)
- Uploaded media files

**Exceptions:**
- Audit logs (if implemented) retained for 7 years for compliance
- CloudTrail logs retained per infrastructure policy (1 year)

**Justification:**
- No regulatory requirement for soft delete in current markets
- Immediate deletion respects user privacy
- Can be changed to soft delete if GDPR compliance is required

---

### Contact Data
**Retention:** Hard-deleted immediately when user deletes

**Process:**
1. User deletes contact via API
2. Contact record deleted immediately from database
3. No soft delete or recovery period

**Justification:**
- Contacts are user-managed data
- Immediate deletion provides clear user control
- Can be changed to soft delete if business requirements change

---

### Media Files (S3)
**Retention:** Retained until user deletes

**Process:**
1. User uploads media to S3
2. Media retained indefinitely until user deletes
3. Deletion is immediate (no soft delete)

**Lifecycle:**
- No automatic expiration
- User controls retention through delete actions
- Incomplete multipart uploads cleaned up after 7 days

**Justification:**
- Media is user-generated content
- Users expect media to persist until explicitly deleted
- No business reason for automatic expiration

---

### Audit Logs (When Implemented)
**Retention:** 7 years (planned)

**Purpose:** Compliance, security investigations, SOC 2 requirements

**Implementation:** To be implemented
- Database table: `auditLogs`
- Tracks all user actions (create, update, delete)
- Includes: userId, action, resourceType, timestamp, changes

**Justification:**
- 7 years is standard for financial/compliance records
- Required for SOC 2 Type II certification
- Enables security forensics and incident investigation

---

## 🔒 Security & Compliance

### Encryption
**At Rest:**
- S3 buckets: AES-256 encryption
- Database: Neon Postgres with encryption
- Secrets: AWS Secrets Manager

**In Transit:**
- TLS 1.2+ for all connections
- HTTPS enforced for all API traffic

### Access Controls
- IAM roles with least privilege
- WorkOS JWT authentication
- API Gateway authorization
- CloudTrail logging of all access

---

## 📋 GDPR/CCPA Considerations

### Current Status
**Not GDPR/CCPA compliant** (no EU/California users yet)

### If GDPR/CCPA Required
**Changes needed:**

1. **Soft Delete for Users** (4 hours)
   - Add `deletedAt` column to users table
   - Change hard delete to soft delete
   - Add cleanup Lambda cron job (delete after 30 days)

2. **Data Export API** (4 hours)
   - `GET /v1/users/me/export`
   - Returns all user data as JSON
   - Includes: profile, media, audit logs

3. **Right to be Forgotten**
   - Already implemented (hard delete)
   - Just need to document process

**Total Time:** 8 hours if GDPR compliance is needed

---

## 📊 Retention Summary Table

| Data Type | Retention Period | Deletion Method | Automated |
|-----------|------------------|-----------------|-----------|
| CloudWatch Logs (Prod) | 30 days | Automatic | ✅ Yes |
| CloudWatch Logs (Staging) | 7 days | Automatic | ✅ Yes |
| CloudTrail Logs | 1 year | Automatic (Glacier → Delete) | ✅ Yes |
| Webhook DLQ | 14 days | Automatic | ✅ Yes |
| S3 Multipart Uploads | 7 days | Automatic | ✅ Yes |
| User Accounts | Immediate | Manual (user request) | ❌ No |
| Contact Data | Immediate | Manual (user action) | ❌ No |
| Media Files | Until deleted | Manual (user action) | ❌ No |
| Audit Logs | 7 years (planned) | Automatic (planned) | ⏳ Future |

---

## 🔄 Review & Updates

### Review Schedule
- **Annual Review:** December each year
- **Triggered Review:** When regulations change or new markets entered

### Update Process
1. Review retention periods against business needs
2. Check compliance requirements (SOC 2, GDPR, CCPA, etc.)
3. Update infrastructure code if changes needed
4. Deploy changes via CDK
5. Update this document

### Change History
| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-12-10 | 1.0 | Initial policy documentation | System |

---

## 📞 Contact

For questions about data retention or deletion requests:
- **Email:** support@railbranch.com
- **Process:** Submit deletion request via support ticket
- **Response Time:** Within 48 hours

---

## ✅ Compliance Checklist

- [x] CloudWatch log retention configured
- [x] CloudTrail log retention configured
- [x] Webhook DLQ retention configured
- [x] S3 lifecycle rules configured
- [x] Encryption at rest enabled
- [x] Encryption in transit enabled
- [x] Access controls implemented
- [ ] Audit logs implemented (planned)
- [ ] GDPR compliance (if needed)
- [ ] Data export API (if needed)

---

**Document Owner:** Engineering Team  
**Approved By:** [To be filled]  
**Next Review:** December 2026
