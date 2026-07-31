# Authorization and Data Boundaries

Use this playbook whenever data belongs to a user or organization, or when a
change touches roles, memberships, invitations, or PII.

## Authentication is not authorization

`requireAuth()` proves the token and stores verified claims. It does not prove
that the caller may access a particular row.

For every protected operation, answer both questions:

1. Who is the caller? Read only the claims produced by `requireAuth()`.
2. Why may this caller act on this resource? Prove ownership, active
   membership, and role in the query or service.

Never accept a caller-supplied user ID, organization ID, role, or email as proof
of authority.

## Organization-owned data

Organization access must be scoped by the canonical organization context and an
`ACTIVE` membership. This is both an authorization rule and the invitation
consent boundary.

- `PENDING` members have not consented and must not appear in member/user
  listings.
- `INACTIVE` members no longer have organization access.
- Invitation creation produces `PENDING`, never `ACTIVE`.
- Only the invitee may accept or decline their invitation.
- Role checks happen after active membership is established.

Prefer a single scoped query or shared service guard over fetching a broad row
and checking it later. Do not return different error details that let an
unauthorized caller enumerate private resources.

## Write authorization

For a mutation:

1. Derive caller identity from verified claims.
2. Resolve the target inside the caller's scope.
3. Check the minimum required role or ownership.
4. Perform the write using the already-authorized identifiers.
5. Audit the actor, organization/resource, action, status, and request context.

Authorization and mutation must share a transaction when a concurrent
membership or role change could invalidate the decision before the write.

## PII and secrets

PII such as names and email addresses may be retained in audit records for the
documented forensic policy. Credentials, tokens, signatures, passwords, and
secret-like metadata must never enter logs or audit storage.

Use the audit redaction utilities; do not create a separate allow/deny list in a
route. Avoid logging whole requests, verified claims, webhook bodies, or error
objects that may contain secrets.

## Required negative tests

Every applicable feature needs tests for:

- unauthenticated request;
- authenticated caller outside the organization;
- `PENDING` membership;
- `INACTIVE` membership;
- insufficient role;
- caller attempting to substitute another user or organization ID;
- target missing inside the authorized scope;
- list query proving pending/inactive records stay invisible.

For invitation flows, also test that only the target user can accept or decline,
and that repeated or concurrent transitions do not grant unintended access.

## Review checklist

- [ ] Identity comes only from verified claims.
- [ ] Resource access is scoped in the service/query, not inferred from input.
- [ ] Every membership query filters `status = "ACTIVE"` unless the operation
      explicitly manages invitations.
- [ ] Role comparisons default toward less privilege.
- [ ] Error behavior does not expose whether an inaccessible resource exists.
- [ ] Audit/log metadata contains no secrets.
- [ ] Negative authorization cases are at least as thorough as the happy path.
