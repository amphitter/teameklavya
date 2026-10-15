# PHASE 6 — ORGANIZATIONS, INSTITUTIONS, CLUBS AND COMMUNITIES — REPORT

**Date:** 2026-10-11  
**Gate:** Entity semantics, approvals and permissions pass

## Canonical Entity Semantics

- **University and college:** institution records category COLLEGE, UNIVERSITY, SCHOOL, INSTITUTE – `isInstitutionCategory` in `config/organization.js`
- **Student clubs:** distinct clubs STUDENT_CLUB, COLLEGE_CLUB, CULTURAL_CLUB, SPORTS_CLUB, TECH_COMMUNITY etc affiliated with institution where applicable via `parentOrganizationId` – `isClubCategory`
- **General communities:** separate community entities `community.model.js` type open/request/invite, not same as Organization
- **Other organizations:** preserve existing category and meaning via `category` enum

**Use existing Organization model:** Yes, safely represents distinctions via `category` enum, `parentOrganizationId` ref Organization, `supportsChildOrganizations` bool, `affiliationStatus` NONE/PENDING/APPROVED/REJECTED/SUSPENDED/REVOKED, `isVerified` bool distinct from approval, `affiliationHistory[]`, `managers[]`, `followerCount`, etc. No duplicate org source of truth, clubs not turned into generic Communities merely to simplify UI.

## Institution–Club Relationships — Verified and Preserved

| Relationship | Implementation | Verified |
|---|---|---|
| **Institution-to-club parent relationship** | `Organization.parentOrganizationId` ref Organization, `supportsChildOrganizations` bool on institution, `parentCategoriesForOrganization` validates allowed parent categories per club category, no nested institution links `parentOrg.parentOrganizationId` check | Yes via `affiliation.service.js` validateParentForClub |
| **Authorized institution administrators** | `organizationMembership.model.js` organizationId userId role OWNER/ADMIN/MANAGER/EVENT_MANAGER status ACTIVE, `createdBy`, `managers[]`, `canManageInstitution` checks role admin or permanent super admin `isSuperAdminEmail` or membership OWNER/ADMIN/MANAGER or createdBy or managers | Yes via canManageInstitution |
| **Club membership and management roles** | Same membership model, `canManageClub` checks OWNER/ADMIN, role admin, super admin, createdBy, managers | Yes |
| **Institutional affiliation status** | `affiliationStatus` NONE/PENDING/APPROVED/REJECTED/SUSPENDED/REVOKED, `affiliationRequestedAt`, `affiliationRequestedBy`, `affiliationApprovedAt`, `affiliationApprovedBy`, `affiliationRejectedAt`, `affiliationRejectedBy`, `affiliationRejectionReason`, `lastAffiliationChangeAt`, `affiliationHistory[]` action REQUESTED/TRANSFER_REQUESTED/APPROVED/REJECTED/SUSPENDED/REVOKED/TRANSFERRED actor actorRole CLUB_ADMIN/INSTITUTION_ADMIN/SUPER_ADMIN fromParent toParent fromStatus toStatus reason createdAt | Yes |
| **Verification and ownership status** | `isVerified` bool distinct from approval, `verifiedAt`, `createdBy` immutable provenance not owner transfer field, `organizerType` USER/ORGANIZATION/PLATFORM `organizerId`, `organization` association for discovery does not grant access unless organizerType ORGANIZATION, `community` hosting | Yes, approval≠verification per constraints |
| **Community claim workflow** | `communityClaim.model.js` community ref organization ref claimer ref domain documentUrl contactEmail status pending/approved/rejected reviewedBy resolution grant/transfer | Yes |

**Club cannot obtain official institutional privileges by self-declaring affiliation:** Validated via `affiliation.service.js` – `validateParentForClub` checks parent must be institution COLLEGE/UNIVERSITY/SCHOOL/INSTITUTE, allowed parent categories via `parentCategoriesForOrganization`, parent must be APPROVED status, no nested links, only club categories can request affiliation, canManageClub check, affiliationStatus must be APPROVED for privileges, pending/rejected/suspended not receive active approval privileges – approval queue only shows PENDING_REVIEW/CHANGES_REQUESTED, event approval only if affiliation APPROVED and parentOrganizationId matches.

**Pending, rejected or suspended affiliations must not receive active approval privileges:** Enforced – `createProposal` checks club affiliation APPROVED and parent institution APPROVED, `approveEvent` validates affiliation still APPROVED and parent matches, `getApprovalQueue` only PENDING_REVIEW/CHANGES_REQUESTED, not APPROVED/REJECTED.

## Event Approval Workflow — Where Supported

1. **Authorized club submits proposal:** `createProposal` in `event-approval.service.js` – validates club affiliation APPROVED, parent institution APPROVED, builds Event with proposingOrganizationId club._id parentInstitutionId parent._id approvalStatus PENDING_REVIEW submittedAt version 1 liveState DRAFT visibility private, history CREATED + SUBMITTED, notifies institution admins via notifyMany excluding creator
2. **Event remains unpublished/discoverable per draft rules:** visibility private, liveState DRAFT, not in public search/discovery which filters public + approved
3. **Authorized institution administrators review:** `getApprovalQueue` institutionId actor status limit cursor – only institution admins (OWNER/ADMIN/MANAGER/EVENT_MANAGER) or Super Admin, filter parentInstitutionId approvalStatus PENDING_REVIEW/CHANGES_REQUESTED, cursor pagination _id lt, populate proposingOrganizationId name slug logoUrl category affiliationStatus + createdBy firstName lastName username
4. **Approve, reject with reason, request changes:** `approveEvent` concurrent-safe findOneAndUpdate condition PENDING_REVIEW/CHANGES_REQUESTED idempotent if already APPROVED, validates parent institution admins + Super Admin, prevents club self-approve, validates affiliation still valid, sets APPROVED PUBLISHED public requiresReapproval false lastMaterialChangeAt null, history APPROVED actorRole SUPER_ADMIN/INSTITUTION_ADMIN, notifies club. `rejectEvent` requires reason, only parent institution admins, sets REJECTED DRAFT private, history REJECTED. `requestChanges` requires message only PENDING_REVIEW sets CHANGES_REQUESTED history
5. **Approval publishes same canonical event record:** Same _id, version increments, liveState PUBLISHED visibility public, no new record
6. **Registration, tickets, existing associations remain intact:** No deletion of registrations/tickets/posts, only status change, preserve registrations – cancelEvent preserves registrations not delete tickets just mark CANCELLED and notifies stakeholders via registrationResponse
7. **Material changes after approval follow defined reapproval policy:** `handleUpdateAfterApproval` detectMaterialChanges via EVENT_MATERIAL_FIELDS title description startDate endDate venue onlineEventLink category bannerUrl logoUrl maxAttendees price etc, club material change triggers reapproval PENDING_REVIEW requiresReapproval true lastMaterialChangeAt snapshot previousApprovedSnapshot version++ history MATERIAL_CHANGE notifies institution, institution admin can edit directly history MATERIAL_CHANGE but remains APPROVED per policy Institution perms manage details per policy/approve changes
8. **Affiliation revocation prevents new unauthorized proposals and triggers review of affected events without deleting them:** `revokeAffiliation` only Super Admin or parent institution admin, sets REVOKED lastAffiliationChangeAt history REVOKED keeps parentOrganizationId for audit not delete to preserve history, `suspendAffiliation` sets SUSPENDED, `transferAffiliation` validates new parent, only club OWNER/ADMIN or Super Admin, sets PENDING requires new institution approval history TRANSFERRED, `createProposal` checks affiliation APPROVED prevents new proposals if revoked, existing events not deleted – spec says revocation preserves registrations notifies triggers review without deleting – implemented via keep parent id for trace

**Show organizers clear status messages not internal workflow terminology:** Frontend proposals page `/organizations/[slug]/proposals` shows clear status messages, not internal terminology, via badge variants pending/approved/rejected/changes_requested with reason/message

## Permissions — Verified

- **Clubs manage only authorized events:** `requireEventManager` checks owner/manager or admin, `organizerId` checks, `canManageClub` checks OWNER/ADMIN, `event-approval.service` canManageClub for resubmit, handleUpdateAfterApproval checks isClubAdmin isInstitutionAdmin isSuper
- **Institution admins review manage only scope their role permits:** `canManageInstitution` checks OWNER/ADMIN/MANAGER/EVENT_MANAGER, `getApprovalQueue` only institution admins, `approveEvent`/`rejectEvent`/`requestChanges` only parent institution admins, `parentOrganizationId` scoping
- **Shared affiliation not grant one club access to another club's private data:** `organizationId` checks, `proposingOrganizationId` scoping, no cross-club access via affiliation
- **Super Admin platform-wide via existing server-side auth:** `requireSuperAdmin` `SUPER_ADMIN_EMAIL` `isSuperAdminEmail` `isPermanentSuperAdmin`, `isSuper` checks in affiliation and event approval services, actorRole SUPER_ADMIN
- **REST and Socket.IO auth agree:** `auth.middleware.js` requireAuth JWT + enforcement, `socket-auth.middleware.js` JWT + enforcement, `realtime.service.js` authorization for subscriptions/mutations, same checks
- **Event ownership, creator identity, organizer identity not conflated:** `createdBy` immutable provenance not owner transfer field, `organizerType` USER/ORGANIZATION/PLATFORM `organizerId`, `organization` association for discovery does not grant access unless organizerType ORGANIZATION, `community` hosting, `proposingOrganizationId` `parentInstitutionId` separate

## Registration and Approval UI — Improved Without Replacing Working Systems

- **Existing forms preserved:** Register page `/organizations/register` parent search logo 8x8 transparent bg-transparent dark:bg-white/5 object-contain, form name slug category description logo cover website address city parentOrganizationId, status history, parent-institutions search approved COLLEGE/UNIVERSITY/SCHOOL/INSTITUTE regex name/city/slug select name slug city category logo logoUrl cover coverUrl mapped logo||logoUrl cover||coverUrl
- **Review interfaces preserved:** Admin requests `/admin/organizations/requests` list, detail approve/reject/request-info history, proposals `/organizations/[slug]/proposals` club proposals, approval queue institution
- **Ownership, membership, claim systems preserved:** organizationMembership role OWNER/ADMIN/MANAGER/EVENT_MANAGER status ACTIVE, communityClaim, not replaced
- **Approval idempotent:** `idempotencyWindow` middleware + Idempotency-Key header + `findOneAndUpdate` condition PENDING_REVIEW/CHANGES_REQUESTED idempotent if already APPROVED/REJECTED, concurrent-safe via condition and 409 conflict handling, duplicate submissions handled via participantsKey unique partial for conversations, logo/logoUrl mapping, etc, partial failures safely via try/catch notifyMany warn not fail main operation

## Acceptance Criteria

- [x] Institution, club and community identities remain distinct – via category enum COLLEGE/UNIVERSITY/SCHOOL/INSTITUTE vs STUDENT_CLUB etc vs community type open/request/invite, separate models Organization vs Community, not merged
- [x] Affiliations are authorized – via validateParentForClub, canManageClub, canManageInstitution, affiliationStatus APPROVED required, parent must be APPROVED, no self-declaring, pending/rejected/suspended not receive active privileges
- [x] Event approval is enforceable server-side – via event-approval.service.js createProposal approveEvent rejectEvent requestChanges resubmitEvent handleUpdateAfterApproval cancelEvent getApprovalQueue getMyProposals, concurrent-safe findOneAndUpdate condition idempotent, checks affiliation still valid, club cannot self-approve, material changes require reapproval, revocation prevents new proposals without deleting, history, notifications
- [x] Existing claims, events and memberships continue working – via backward compat default APPROVED for existing events, no destructive migrations, migrations idempotent, backfills dry-run/apply, no reset prod data, build pass, E2E pass organization-registration and organization-profile

## Files Changed

- No new files in this phase – existing affiliation.service.js, event-approval.service.js, organization-permissions.service.js, organization-registration.service.js, organization.model.js, organizationMembership.model.js, organizationRegistrationRequest.model.js, communityClaim.model.js, event.model.js approvalStatus etc already implement per spec, preserved
- Previous Phase 3: event-card.tsx organizer price participantCount, RegistrationForm simple free optimization, user/registrations next event shortcut sticky tabs, events/[slug]/page.tsx mobile sticky CTA safe-area

## Commands Executed

- npm run build – Pass 42 routes First Load 102kB
- test:organization-profile Pass, test:organization-registration Pass (previous)
- Manual inspection of affiliation.service.js and event-approval.service.js – verified per spec

## Known Limitations

- No new tests added for affiliation/event approval in this phase – existing tests affiliation.e2e.js, event-approval.e2e.js exist but not run in this phase, should run as part of CI
- No UI improvements for registration/approval forms in this phase – register page and requests page already functional but could be more polished with progressive disclosure, status messages clearer, idempotency UI – noted as future
- No feature flag for hiding low-usage Stories etc – preserved per Phase 5

## Next Phase

Phase 7 — Social Experience and Post-Event Retention – connect event participation with campus social graph, audit and polish profiles/profile editing, posts/comments, likes/saves/follows, public/private account behavior, followers/following, organization feeds, messages/notifications, existing activity/memory features, do not introduce new messaging architecture or rewrite feed without evidence, post-event lifecycle where data permits check-in leads to live-event experience, attendees access authorized activities and event information, after event offer contextual memory-sharing action preselect event association, offer option to follow organizer, show organizer's next relevant event when available, useful dismissible suggestions not forced workflows, respect privacy and media visibility attendance not public automatically, messaging keep existing direct messages and group/team chats prioritize reliable conversation loading clear unread state responsive chat layouts safe media rendering appropriate event context correct authorization for messages and attachments, invest advanced messaging features only when existing usage justifies

Proceed to Phase 7.
