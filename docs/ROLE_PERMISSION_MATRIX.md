# Role-Permission Matrix – Institution–Club–Event

## Organization Roles
- OWNER: creator or explicit OWNER membership – full control
- ADMIN: active ADMIN membership – manage profile, members, events
- MANAGER: active MANAGER – edit profile, manage events per policy
- EVENT_MANAGER: active EVENT_MANAGER – manage events only
- MEMBER: active MEMBER – no management, only follow/view
- Legacy managers[] → MANAGER compatibility

## Institution Categories
COLLEGE, UNIVERSITY, SCHOOL, INSTITUTE – can have child clubs, can approve club event proposals, can manage own events directly (auto-approved).

## Club Categories
STUDENT_CLUB, COLLEGE_CLUB, CULTURAL_CLUB, SPORTS_CLUB, TECH_COMMUNITY, COLLEGE_COMMUNITY, UNIVERSITY_COMMUNITY – must have parentOrganizationId with affiliationStatus APPROVED to create event proposals. Club events are PENDING_REVIEW until parent institution approves.

## Affiliation Lifecycle
- NONE: no parent
- PENDING: club requested affiliation, awaiting institution approval
- APPROVED: institution approved, club can propose events
- SUSPENDED: temporarily suspended by institution or Super Admin – cannot propose new events, existing approved events remain but may require reapproval per policy
- REVOKED: affiliation revoked – preserve registrations, no auto delete, notify stakeholders
- REJECTED: institution rejected affiliation request
- TRANSFER: audited transfer via transferAffiliation – old parent → new parent, status back to PENDING for new parent approval

### Permissions
- requestAffiliation: club OWNER/ADMIN only
- approveAffiliation: parent institution OWNER/ADMIN/MANAGER/EVENT_MANAGER or Super Admin (platform admin role or SUPER_ADMIN_EMAIL)
- rejectAffiliation: same as approve
- suspend/revoke: institution admin + Super Admin (revoke also Super Admin only, but institution admin allowed per spec for revocation policy)
- transfer: club OWNER/ADMIN or Super Admin – sets PENDING for new parent

### Security
- Prevent self-parent
- Prevent nested institution links (parent cannot have parent)
- Validate allowed parent categories via ORGANIZATION_PARENT_LINKS
- Prevent cross-institution approval without transfer workflow – approve checks club.parentOrganizationId == institution._id and affiliation APPROVED

## Event Approval Workflow
- approvalStatus: DRAFT, PENDING_REVIEW, APPROVED, REJECTED, CHANGES_REQUESTED, CANCELLED, SUSPENDED
- proposingOrganizationId: club that proposed
- parentInstitutionId: parent institution at time of proposal
- approvedBy/approvedAt: reviewer
- approvalHistory: array of actions with actor, role, from/to status, reason, timestamp
- version: increments on resubmit/material change
- requiresReapproval: bool for material changes after approval
- previousApprovedSnapshot: last approved data for audit

### Creation
- Club authorized member creates proposal (verify membership via canCreateOrganizationEvent – never trust client club ID)
- Proposal: approvalStatus PENDING_REVIEW, liveState DRAFT, visibility private (unpublished until approved)
- Records proposing club, parent institution, creator, timestamp, status, revision, history
- Institution reviewers notified via notification service + approval queue

### Review
- Institution queue: GET /api/events/approvals/institution/:institutionId/queue – only institution admins + Super Admin, paginated, server-authorized
- Detail shows event info/media/dates/venue/eligibility/registration/revision history/reviewer message
- Actions: Approve/Reject with reason/Request changes/View approved/Review material updates

### Approval
- Only correct parent institution admins + Super Admin can approve
- Club cannot self-approve – blocked by checking institution admin role
- Validates state (must be PENDING_REVIEW or CHANGES_REQUESTED), authority (institution admin), affiliation (club affiliation still APPROVED and parent matches)
- Prevents duplicate processing via findOneAndUpdate with status condition – idempotent, concurrent-safe
- Transitions same Event record to APPROVED, liveState PUBLISHED, visibility public, records approver/timestamp, notifies club
- Idempotent: if already APPROVED, returns current
- Concurrent-safe: second approval gets 409 conflict then returns APPROVED via fetch

### Rejection
- Requires reason
- Keeps unpublished (visibility private, liveState DRAFT)
- Notifies club
- Club can edit and resubmit – resubmit returns to PENDING_REVIEW, increments version, clears rejection reason, records history

### Request Changes
- Institution requests modifications with message
- Status CHANGES_REQUESTED
- Club sees message + can resubmit

### Material Changes After Approval
- Detect via EVENT_MATERIAL_FIELDS: title, description, startDate, endDate, venue, onlineEventLink, eventType, category, bannerUrl, logoUrl, maxAttendees, price
- Club material change after approval → status PENDING_REVIEW, requiresReapproval true, snapshot saved, institution notified, needs reapproval
- Institution admin material change → allowed directly, records history, no reapproval required per policy (institution manages details)

### Cancellation / Affiliation Revocation
- Cancellation: club, institution, creator, Super Admin can cancel – sets approvalStatus CANCELLED, liveState CANCELLED, preserves registrations (does not delete tickets/registrationResponses), notifies registered users
- Affiliation revocation: preserves registrations, notifies stakeholders, no auto delete

## Shared Management – One Canonical Event Record
- Club perms: view/manage registrations/attendee lists/check-in/edit allowed fields/stats/communicate/submit changes for reapproval – via canManageEvent (club OWNER/ADMIN/MANAGER/EVENT_MANAGER)
- Institution perms: view/manage registrations/attendee lists/check-in/manage details per policy/approve changes/cancel/suspend/review activity – via canManageEvent extended to include parentInstitutionId admins
- Security:
  - Club cannot manage other club's events same institution – checked via organizerId must match clubId
  - Institution cannot access unrelated institutions private data – queue filtered by parentInstitutionId
  - Membership != unlimited event perms – canManageEvent checks explicit membership role, not just follower
  - All export/check-in/cancel/edit/attendee endpoints verify authz via canManageEvent + requireEventManager guard
  - Preserve user-owned/platform-owned events – they remain APPROVED, not affected by approval workflow
  - Preserve Community-associated events – community field independent, approval only for club categories
  - REST + Socket.IO auth consistent – both use canManageEvent via auth.middleware

## Ownership Presentation
- Hosted by Club Affiliated with Institution using validated relationship (parentOrganization) not free text
- Approval != ownership – approval records approver but organizerId remains club

## Notifications/Audit
- Notify on club submit (institution admins), institution receives, approved/rejected/modifications requested/resubmit/cancelled/material change/affiliation change using existing notification infra (notifyMany)
- No duplicates on retry – idempotent approval returns without duplicate notify? We notify only on successful state transition
- Record approval actions reviewer/timestamp/outcome/reason in approvalHistory, internal notes separate from applicant messages (reason vs message fields)
- Affiliation history in affiliationHistory array with action, actor, from/to parent, from/to status, reason

## Data Migration
- Existing events: backfill approvalStatus APPROVED for backward compat, keep IDs/slugs/URLs/memberships/event relationships
- Existing organizations: affiliationStatus NONE for institutions without parent, for clubs with parentOrganizationId set affiliationStatus to APPROVED if parent exists and is approved, else PENDING? Dry-run logs ambiguous
- No auto-convert Organizations to Communities, no merge by name, no delete Communities
- Reversible dry-run migration with logging/validation

## Testing
- See backend/tests/event-approval.e2e.js and affiliation.e2e.js for workflow tests per spec
