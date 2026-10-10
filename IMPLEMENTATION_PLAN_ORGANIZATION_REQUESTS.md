# Organization Registration Requests - Implementation Plan

## Audit Summary

### Existing Models
- User: role user|admin, SUPER_ADMIN_EMAIL derived via ownership.service.js, suspendedAt
- Organization: name, handle/slug, category (COLLEGE, UNIVERSITY, STUDENT_CLUB etc), description, logo/cover, address fields, website/email/phone/socialLinks, parentOrganizationId, status (DRAFT,PENDING_REVIEW,APPROVED...), verificationStatus, ownershipStatus, createdBy, isVerified, managers, timestamps. Indexes on name, handle unique sparse, parentOrgId, verificationStatus, status, createdAt.
- OrganizationMembership: organizationId, userId, role (OWNER,ADMIN,MANAGER,EDITOR,EVENT_MANAGER,MEMBER), status, joinedAt, invitedBy. Unique index on org+user.
- Community, CommunityMember, CommunityClaim: claim has community, organization, claimant, proof, status pending/approved/rejected, reviewedBy, resolution grant/transfer.
- Notification: user, actor, type (includes org_follow, organization_invite etc), post, event, organization, community, read.
- Event: has organizerType/organizerId, organization association, etc.

### Existing Routes
- POST /api/organizations - requireAuth+requireAdmin - admin-only creation
- GET /mine, /mine/followed, /suggested, /:id/parent-options, /:id/members, POST /:id/members invite, etc, PUT /:id update, POST /:id/follow, POST /:id/verify/unverify/managers - SuperAdmin only
- Admin routes: /api/admin/* stats, users, etc
- Community routes: POST /communities, claims etc
- Auth: requireAuth, requireAdmin, requireSuperAdmin, requireEventManager, optionalUser, canManageEvent
- Rate limits: config/rate-limits.js - has limiters for event, communication, etc
- Idempotency: middleware/idempotency.js
- Locking: services/cache.service has locks? Need check
- Upload: /api/upload/image?folder=..., /upload/event/:id/logo etc uses MediaAsset

### Frontend
- Settings: frontend/src/app/(app)/user/settings/page.tsx - has Profile, Appearance, Privacy, Notifications sections. No Org section yet.
- Admin layout: frontend/src/app/admin/layout.tsx - NAV includes Overview, Events, Communications, Create Event, Communities, Users, Claims, Moderation, Infrastructure. No Requests.
- Admin organizations page: frontend/src/app/admin/organizations/page.tsx - admin create/edit orgs
- Admin claims page: frontend/src/app/admin/claims/page.tsx - reviews CommunityClaim
- Organizations directory: frontend/src/app/(app)/organizations/page.tsx
- Org profile: frontend/src/app/(app)/organizations/[slug]/page.tsx
- Profile screen: frontend/src/components/profile/profile-screen.tsx

### Missing Functionality
- No OrganizationRegistrationRequest model
- No applicant endpoints for registration requests
- No Super Admin Requests dashboard for org registrations
- No self-service flow from Settings
- No evidence upload/access control for private docs
- No state machine for DRAFT->PENDING->NEEDS_INFO->APPROVED/REJECTED/WITHDRAWN
- No approval service atomic
- No duplicate prevention beyond slug uniqueness
- No notifications for request lifecycle
- No integration with community claims inbox

### Required Changes
1. New model: organizationRegistrationRequest.model.js
   - Fields: applicant, category (COLLEGE,UNIVERSITY,AFFILIATED_CLUB), proposedName, slug (proposed), description, website, email, phone, socialLinks, address (line,city,state,country,postalCode,lat,lng), branding (logoUrl,coverUrl,logoPublicId,coverPublicId), evidence (officialWebsite, officialEmail, authorizationLetterUrl, registrationCertificateUrl, affiliationLetterUrl, otherEvidenceUrls, notes), parentOrganization (existing org ref), proposedParent (name,website,email etc), applicantRole (designation), status, submission timestamps, reviewer, review history array, rejection reason, info request message, resulting organizationId, resubmission count, idempotencyKey, declaration accepted.
   - Indexes: applicant+status, slug, status+createdAt, parentOrganizationId, resultingOrgId unique sparse, idempotencyKey unique sparse
2. Service: organization-registration.service.js
   - State machine: DRAFT->PENDING_REVIEW->NEEDS_INFO->PENDING_REVIEW->APPROVED/REJECTED, DRAFT/WITHDRAWN terminal, withdrawal from DRAFT/PENDING/NEEDS_INFO
   - Validation: category, required fields per category, slug generation/validation, URL safety, parent institution rules, evidence ownership, duplicate checks (same applicant same proposed name pending, slug conflict, existing org same name+city, etc)
   - Approval: preconditions, atomic claim via findOneAndUpdate status=PENDING_REVIEW with version, create org exactly once using transaction or idempotency, assign OWNER membership, link request->org, audit, transition to APPROVED, notify
   - Rejection/info request/withdraw/resubmit
3. Controller: organization-registration.controller.js
   - Applicant: POST /registration-requests, GET /registration-requests/mine, GET /:id (own), PATCH /:id (draft/needs_info), POST /:id/submit, POST /:id/withdraw, POST /:id/resubmit
   - SuperAdmin: GET /admin/registration-requests (list with filters pagination), GET /admin/registration-requests/:id, POST /:id/approve, POST /:id/reject, POST /:id/request-info, GET /:id/history
   - Evidence upload: reuse existing upload infrastructure but with private folder and ownership check
4. Routes: organization-registration.routes.js
   - Mount under /api/organization-registration-requests and /api/admin/registration-requests
5. Notification: add types organization_request_submitted, organization_request_approved, organization_request_rejected, organization_request_needs_info
   - Use existing notify service
6. Frontend:
   - Settings: add Organizations & Institutions section with links to Register College/University, Register Affiliated Club, View My Requests
   - New pages: /user/organizations/register (category select), /user/organizations/register/college, /user/organizations/register/club, /user/organizations/requests (my list), /user/organizations/requests/[id]
   - Super Admin: /admin/requests (inbox with tabs for org requests and community claims), /admin/requests/[id]
   - Components: OrgRequestForm, EvidenceUploader, ReviewSummary, StatusBadge, etc
   - Add Requests to admin NAV
7. Tests: create comprehensive e2e for applicant and super admin flows, approval atomicity, duplicate prevention, IDOR, etc

### Authorization Implications
- Applicant endpoints: requireAuth, applicant identity from req.user.id, object-level check that request.applicant == req.user.id
- SuperAdmin endpoints: requireAuth + requireSuperAdmin
- Evidence access: only applicant and super admin can view private evidence URLs - need to check MediaAsset ownership or use private folder with auth
- No client-controlled status, reviewer, resulting org
- Rate limiting: limit creation to 5 per 15 min per user (reuse communication limiter or new limiter)
- Idempotency: use idempotencyKey for create and approval

### Dependencies
- MediaAsset for branding and evidence storage
- Organization and OrganizationMembership for approval
- Notification for lifecycle
- Existing rate-limit, idempotency, cache invalidation

### Regression Tests
- Existing: organization-profile, organization-rbac, event-owner-rbac, event-logo, live, quiz, phase11-security, performance-phase10, communications, community, phase3, phase6, phase11, phase13, scale, recovery
- Must still pass after changes

### Risks
- Slug conflicts with existing orgs - need safe generation and validation
- Duplicate parent institution creation - need check existing orgs by normalized name+city
- Approval atomicity without transactions - need conditional updates and idempotency
- Evidence exposure - need private storage
- Performance - paginated inbox, indexes

### Rollback
- New model is additive, no changes to existing org schema
- New routes are additive
- Frontend new pages are additive, no changes to existing admin org creation
- If fails, can drop collection and remove routes
