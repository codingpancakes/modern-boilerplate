# Unsubscribe Management Guide

## Overview

This guide explains how to properly handle unsubscribes in the RailBranch platform to ensure compliance with email regulations (CAN-SPAM, GDPR, CASL) and maintain sender reputation.

## Unsubscribe Hierarchy

The system implements a **4-tier unsubscribe hierarchy** (checked in priority order):

### 1. Global Unsubscribe 🚫 (Highest Priority)
**Table:** `global_unsubscribes`

Permanent blocks on specific email addresses or phone numbers across **all contacts** in an organization.

**When to use:**
- User clicks "Unsubscribe from all"
- Hard email bounces (invalid address)
- Spam complaints
- Legal requests (GDPR right to be forgotten)

**Key features:**
- Survives contact deletion/recreation
- Applies to email/phone even if used by different contacts
- Required for legal compliance
- Cannot be overridden

### 2. Contact Status ⚠️
**Table:** `contacts.status`

Status values:
- `ACTIVE` - Can receive messages
- `UNSUBSCRIBED` - Opted out of all messages
- `COMPLAINED` - Reported spam
- `DELETED` - Soft deleted
- `BOUNCED` - Email bounced

**When to use:**
- User wants to stop all messages but may re-subscribe later
- Contact is no longer valid

### 3. Channel Status 📱
**Table:** `contact_channels.status`

Status values:
- `ACTIVE` - Channel is working
- `BOUNCED` - Hard/soft bounce
- `INVALID` - Invalid address format
- `BLOCKED` - Manually blocked

**When to use:**
- Specific channel (email/SMS) has delivery issues
- User wants to update their contact method

### 4. Topic Subscription 📧 (Lowest Priority)
**Table:** `contact_subscriptions.status`

Status values:
- `SUBSCRIBED` - Receiving messages
- `UNSUBSCRIBED` - Opted out of this topic
- `PENDING` - Awaiting confirmation

**When to use:**
- User wants to customize which types of messages they receive
- Granular preference management

---

## Usage Examples

### Before Sending a Message

```typescript
import { canSendMessage } from '../lib/unsubscribe';

// Check if contact can receive message
const check = await canSendMessage(db, {
  contactId: 'contact_123',
  organizationId: 'org_456',
  channelKind: 'EMAIL',
  topicId: 'topic_marketing', // Optional
});

if (!check.canSend) {
  console.log(`Cannot send: ${check.reason} - ${check.details}`);
  return;
}

// Safe to send message
await sendMessage(...);
```

### Topic-Level Unsubscribe

User clicks "Unsubscribe from Marketing Emails" in email footer:

```typescript
import { unsubscribeFromTopic } from '../lib/unsubscribe';

await unsubscribeFromTopic(db, {
  contactId: 'contact_123',
  topicId: 'topic_marketing',
  channelKind: 'EMAIL',
  source: 'UNSUBSCRIBE_LINK',
  userAgent: req.headers['user-agent'],
  ipAddress: req.ip,
});

// Contact still receives transactional emails ✅
```

### Global Unsubscribe

User clicks "Unsubscribe from All Emails":

```typescript
import { unsubscribeGlobally } from '../lib/unsubscribe';

await unsubscribeGlobally(db, {
  contactId: 'contact_123',
  organizationId: 'org_456',
  channelKind: 'EMAIL',
  reason: 'User requested global unsubscribe',
  source: 'UNSUBSCRIBE_LINK',
  userAgent: req.headers['user-agent'],
  ipAddress: req.ip,
});

// Contact will NOT receive any emails ✅
// Even if they're re-imported or sign up again ✅
```

### Handle Hard Bounce

Email bounced with "550 User not found":

```typescript
import { handleHardBounce } from '../lib/unsubscribe';

await handleHardBounce(db, {
  contactId: 'contact_123',
  organizationId: 'org_456',
  channelKind: 'EMAIL',
  address: 'user@example.com',
  addToGlobalUnsubscribe: true, // Recommended
});

// Email address is permanently blocked ✅
```

### Handle Spam Complaint

User marked email as spam:

```typescript
import { handleSpamComplaint } from '../lib/unsubscribe';

await handleSpamComplaint(db, {
  contactId: 'contact_123',
  organizationId: 'org_456',
  channelKind: 'EMAIL',
  address: 'user@example.com',
});

// Immediately blocks all messages ✅
// Updates contact status to COMPLAINED ✅
// Adds to global unsubscribe list ✅
```

### Fast Lookup (Before Import)

Check if email is globally unsubscribed before importing:

```typescript
import { isGloballyUnsubscribed } from '../lib/unsubscribe';

const isBlocked = await isGloballyUnsubscribed(db, {
  organizationId: 'org_456',
  email: 'user@example.com',
  channelKind: 'EMAIL',
});

if (isBlocked) {
  console.log('Email is globally unsubscribed - skip import');
  return;
}
```

---

## Database Schema

### global_unsubscribes Table

```sql
CREATE TABLE global_unsubscribes (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- At least one must be provided
  email CITEXT,
  phone CITEXT,
  
  channel_kind TEXT NOT NULL, -- EMAIL, SMS, PUSH
  
  -- Tracking
  unsubscribed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reason TEXT,
  source TEXT, -- UNSUBSCRIBE_LINK, COMPLAINT, BOUNCE, ADMIN, API
  topic_id UUID REFERENCES subscription_topics(id),
  
  -- Compliance
  user_agent TEXT,
  ip_address TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Fast lookups
CREATE UNIQUE INDEX ux_global_unsub_email 
  ON global_unsubscribes (organization_id, email, channel_kind);
CREATE UNIQUE INDEX ux_global_unsub_phone 
  ON global_unsubscribes (organization_id, phone, channel_kind);
```

---

## Compliance Requirements

### CAN-SPAM Act (US)

✅ **Required:**
- Unsubscribe link in every marketing email
- Process unsubscribe requests within 10 business days
- Honor unsubscribes permanently
- Don't charge fees or require login to unsubscribe

✅ **Implemented:**
- `globalUnsubscribes` table tracks permanent opt-outs
- `unsubscribedAt` timestamp for audit trail
- `source` and `reason` for compliance reporting

### GDPR (EU)

✅ **Required:**
- Right to be forgotten (delete all data)
- Right to object (stop processing)
- Consent tracking
- Data portability

✅ **Implemented:**
- `globalUnsubscribes` for permanent opt-out
- `userAgent` and `ipAddress` for consent proof
- `metadata` for additional context
- Soft deletes via `deletedAt` columns

### CASL (Canada)

✅ **Required:**
- Express consent before sending
- Unsubscribe mechanism in every message
- Honor unsubscribes immediately

✅ **Implemented:**
- `contactSubscriptions` for consent tracking
- `subscriptionStatus` enum (SUBSCRIBED, UNSUBSCRIBED, PENDING)
- Immediate blocking via `globalUnsubscribes`

---

## Best Practices

### 1. Always Check Before Sending

```typescript
// ❌ BAD - No unsubscribe check
await sendEmail(contact.email, template);

// ✅ GOOD - Check first
const check = await canSendMessage(db, {
  contactId: contact.id,
  organizationId: org.id,
  channelKind: 'EMAIL',
  topicId: campaign.topicId,
});

if (check.canSend) {
  await sendEmail(contact.email, template);
} else {
  await logSkippedMessage(contact.id, check.reason);
}
```

### 2. Provide Granular Options

```typescript
// ✅ GOOD - Give users choice
<UnsubscribeOptions>
  <Option onClick={() => unsubscribeFromTopic('marketing')}>
    Unsubscribe from marketing emails only
  </Option>
  <Option onClick={() => unsubscribeFromTopic('newsletters')}>
    Unsubscribe from newsletters only
  </Option>
  <Option onClick={() => unsubscribeGlobally()}>
    Unsubscribe from all emails
  </Option>
</UnsubscribeOptions>
```

### 3. Track Everything

```typescript
// ✅ GOOD - Full audit trail
await unsubscribeGlobally(db, {
  contactId,
  organizationId,
  channelKind: 'EMAIL',
  reason: 'User clicked unsubscribe link in campaign_123',
  source: 'UNSUBSCRIBE_LINK',
  userAgent: req.headers['user-agent'], // Track browser
  ipAddress: req.ip, // Track location
});
```

### 4. Handle Bounces Immediately

```typescript
// Webhook from email provider
app.post('/webhooks/email-bounce', async (req) => {
  const { email, bounceType } = req.body;
  
  if (bounceType === 'hard') {
    // Permanent failure - block immediately
    await handleHardBounce(db, {
      contactId,
      organizationId,
      channelKind: 'EMAIL',
      address: email,
      addToGlobalUnsubscribe: true,
    });
  }
});
```

### 5. Respect Global Unsubscribes Forever

```typescript
// ❌ BAD - Allowing re-subscription after global unsubscribe
if (user.wantsToResubscribe) {
  await removeFromGlobalUnsubscribe(email); // DON'T DO THIS
}

// ✅ GOOD - Global means global
const isBlocked = await isGloballyUnsubscribed(db, {
  organizationId,
  email,
  channelKind: 'EMAIL',
});

if (isBlocked) {
  return {
    error: 'This email address has permanently unsubscribed',
    cannotResubscribe: true,
  };
}
```

---

## Reporting Queries

### Unsubscribe Rate by Source

```sql
SELECT 
  source,
  channel_kind,
  COUNT(*) as unsubscribe_count,
  DATE_TRUNC('day', unsubscribed_at) as date
FROM global_unsubscribes
WHERE organization_id = 'org_456'
  AND unsubscribed_at >= NOW() - INTERVAL '30 days'
GROUP BY source, channel_kind, DATE_TRUNC('day', unsubscribed_at)
ORDER BY date DESC;
```

### Spam Complaint Rate

```sql
SELECT 
  COUNT(*) FILTER (WHERE source = 'COMPLAINT') as complaints,
  COUNT(*) FILTER (WHERE source = 'UNSUBSCRIBE_LINK') as voluntary,
  COUNT(*) as total
FROM global_unsubscribes
WHERE organization_id = 'org_456'
  AND unsubscribed_at >= NOW() - INTERVAL '30 days';
```

### Bounce Rate

```sql
SELECT 
  COUNT(*) FILTER (WHERE source = 'BOUNCE') as bounces,
  COUNT(*) as total_sent
FROM messages
WHERE organization_id = 'org_456'
  AND created_at >= NOW() - INTERVAL '30 days';
```

---

## Migration Guide

If you have existing contacts, run this to populate global unsubscribes:

```sql
-- Migrate contacts with UNSUBSCRIBED status
INSERT INTO global_unsubscribes (
  organization_id,
  email,
  phone,
  channel_kind,
  reason,
  source,
  unsubscribed_at
)
SELECT 
  organization_id,
  email,
  phone,
  'EMAIL' as channel_kind,
  'Migrated from contact status' as reason,
  'MIGRATION' as source,
  updated_at as unsubscribed_at
FROM contacts
WHERE status = 'UNSUBSCRIBED'
  AND email IS NOT NULL
ON CONFLICT DO NOTHING;

-- Migrate contacts with COMPLAINED status
INSERT INTO global_unsubscribes (
  organization_id,
  email,
  phone,
  channel_kind,
  reason,
  source,
  unsubscribed_at
)
SELECT 
  organization_id,
  email,
  phone,
  'EMAIL' as channel_kind,
  'Spam complaint' as reason,
  'COMPLAINT' as source,
  updated_at as unsubscribed_at
FROM contacts
WHERE status = 'COMPLAINED'
  AND email IS NOT NULL
ON CONFLICT DO NOTHING;
```

---

## Testing

### Unit Tests

```typescript
describe('Unsubscribe System', () => {
  it('should block globally unsubscribed emails', async () => {
    await addGlobalUnsubscribe(db, {
      organizationId: 'org_1',
      email: 'blocked@example.com',
      channelKind: 'EMAIL',
    });
    
    const result = await canSendMessage(db, {
      contactId: 'contact_1',
      organizationId: 'org_1',
      channelKind: 'EMAIL',
    });
    
    expect(result.canSend).toBe(false);
    expect(result.reason).toBe('GLOBAL_UNSUBSCRIBE');
  });
  
  it('should allow topic-level unsubscribes', async () => {
    await unsubscribeFromTopic(db, {
      contactId: 'contact_1',
      topicId: 'topic_marketing',
      channelKind: 'EMAIL',
    });
    
    // Marketing blocked
    const marketing = await canSendMessage(db, {
      contactId: 'contact_1',
      organizationId: 'org_1',
      channelKind: 'EMAIL',
      topicId: 'topic_marketing',
    });
    expect(marketing.canSend).toBe(false);
    
    // Transactional still allowed
    const transactional = await canSendMessage(db, {
      contactId: 'contact_1',
      organizationId: 'org_1',
      channelKind: 'EMAIL',
      topicId: 'topic_transactional',
    });
    expect(transactional.canSend).toBe(true);
  });
});
```

---

## Support

For questions or issues:
- Check the [Audit Logging Guide](./AUDIT_LOGGING_GUIDE.md) for compliance tracking
- Review [Data Retention Policy](./DATA_RETENTION_POLICY.md) for data lifecycle
- See [SOC 2 Readiness Checklist](./SOC2_READINESS_CHECKLIST.md) for compliance status
