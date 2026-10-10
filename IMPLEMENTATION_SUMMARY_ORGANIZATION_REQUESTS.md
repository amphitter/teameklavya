# Organization Registration Requests — Implementation Summary

## Overview
Production-ready organization governance extension allowing ordinary users to request official organizations (college/university/school/affiliated club/institute/non-profit/community/other) via User Settings, with Super Admin Requests dashboard review.

## Backend (Phase B)

### Model: `organizationRegistrationRequest.model.js`
- Categories: COLLEGE, UNIVERSITY, SCHOOL, AFFILIATED_CLUB, INSTITUTE, NON_PROFIT, COMMUNITY_GROUP, OTHER
- Statuses: DRAFT, PENDING_REVIEW, NEEDS_INFORMATION, APPROVED, REJECTED, WITHDRAWN
- Fields: proposedName, proposedSlug (slugified), description, website, email, phone, address, city/state/country/postal, logo/cover URLs, evidence (officialWebsite, officialEmail, authorizationLetter, registrationCertificate, affiliationLetter, collegeWebsiteListing, otherEvidenceUrls, notes), parentOrganizationId (existing approved parent), proposedParent (name, website, email, city, country, description), applicant, applicantRole, designation, declarationAccepted, submittedAt, reviewer, reviewedAt, rejectionReason, infoRequestMessage, resultingOrganizationId, resubmissionCount, version, reviewHistory (action, actor, actorRole, message, fromStatus, toStatus, at, metadata), idempotencyKey (unique sparse, no default null to allow multiple nulls), indexes for applicant+status, status+createdAt, category+status, proposedSlug, parentOrg, resultingOrg, createdAt+_id, text index.

### Service: `organization-registration.service.js`
- `slugify` reuse, URL safety via `validateExternalUrl`
- `VALID_TRANSITIONS` state machine: DRAFT→PENDING/WITHDRAWN, PENDING→NEEDS_INFO/APPROVED/REJECTED/WITHDRAWN, NEEDS_INFO→PENDING/WITHDRAWN/REJECTED, REJECTED→PENDING/WITHDRAWN, WITHDRAWN→terminal (except resubmit path via controller)
- `canTransition` helper
- `validateRequestPayload`: requires proposedName 3-120, description 20-1000, declaration for non-draft, parent required for AFFILIATED_CLUB (either parentOrganizationId or proposedParent.name), URL safety checks, evidence URL validation
- `checkDuplicateRequests`: same applicant pending same name (case-insensitive) → CONFLICT, slug conflict with existing org → CONFLICT (canonical codes)
- `generateUniqueOrgSlug`: generates unique slug with suffix collision handling
- `buildReviewHistoryEntry`
- `approveRequest`: atomic via `session.withTransaction`, idempotent via resultingOrganizationId check (returns existing org if already approved), validates applicant exists, validates parent org (must be COLLEGE/UNIVERSITY/SCHOOL/INSTITUTE and APPROVED), auto-creates parent if proposedParent provided and not exists, generates unique slug, creates exactly one Organization (status APPROVED, verificationStatus UNVERIFIED, isVerified false, ownershipStatus PERSONAL, createdBy applicant), upserts OWNER membership (idempotent), links request to org, transitions to APPROVED, pushes reviewHistory APPROVED+ORG_CREATED, invalidates caches, sends notification `organization_request_approved` via existing infrastructure, invalidates EventRepository cache. Early fetch outside transaction for fast fail and idempotent APPROVED handling.
- `rejectRequest` and `requestMoreInfo`: validate reason/message min 5 chars, transition checks, save, notify with `organization_request_rejected` / `organization_request_needs_info`
- Uses AppError canonical classes (ValidationError, NotFoundError) to ensure 400/404 mapping via errorResponse taxonomy (no non-canonical codes).

### Controller: `organization-registration.controller.js`
- Applicant endpoints:
  - `createRequest`: enforces applicant identity from auth (not body), idempotencyKey dedup via Idempotency-Key header/body (returns 200 deduped if exists), URL normalization, parent validation, DRAFT/PENDING handling, mass assignment protection, declaration handling, reviewHistory CREATED/SUBMITTED.
  - `listMyRequests`: cursor/legacy pagination, filter by status/category
  - `getMyRequest`: IDOR check 403 if not owner
  - `updateMyRequest`: forbids status/reviewer/resultingOrganizationId/applicant/reviewHistory/resubmissionCount/version mass assignment, allows only safe fields, validates payload, updates version, pushes COMMENT history
  - `submitDraft`: validates from DRAFT, checks duplicate, transitions to PENDING_REVIEW
  - `withdrawRequest`: allows DRAFT/PENDING/NEEDS_INFO → WITHDRAWN
  - `resubmitRequest`: allows NEEDS_INFORMATION/REJECTED → PENDING_REVIEW, allows updating safe fields, increments resubmissionCount
- Super Admin endpoints:
  - `listAllRequests`: search (proposedName/description/city), filters status/category/applicant/parent, cursor/legacy pagination, counts aggregation
  - `getRequestDetail`: populates applicant/parent/resulting/reviewer, potentialDuplicates lookup (exact name case-insensitive, limit 5)
  - `approve`: idempotent, calls service with idempotencyKey, returns organization+request
  - `reject`: requires reason
  - `requestInfo`: requires message
  - `getHistory`: populates actor
  - `listParentInstitutions`: approved orgs category COLLEGE/UNIVERSITY/SCHOOL/INSTITUTE, search, limit
- Error handling: uses ERROR_CODES.VALIDATION_ERROR etc, respects AppError status.

### Routes: `organization-registration.routes.js`
- `createLimiter`: 10/15min per user, respects RATE_LIMIT_DISABLED via isRateLimitingDisabled, keyGenerator user id else ip
- `idempotencyWindow` middleware from existing
- Applicant routes: POST / (createLimiter), GET /mine, GET /mine/:id, GET /parent-institutions, PATCH /:id, POST /:id/submit/withdraw/resubmit, all requireAuth
- Admin routes: GET /admin/list, GET /admin/:id, GET /admin/:id/history, POST /admin/:id/approve/reject/request-info, all requireSuperAdmin (preserves SUPER_ADMIN_EMAIL mechanism)
- Mounted in `server.js` at `/api/organization-registration-requests`

### Notification Model
- Extended enum with `organization_request_submitted`, `organization_request_approved`, `organization_request_rejected`, `organization_request_needs_info` for existing infrastructure reuse.

### Security
- Preserves centralized Super Admin auth via SUPER_ADMIN_EMAIL, never frontend-only role
- No auto-creation of public org, no ownership grant, no verification badge on request creation
- Approval ≠ verification: leaves UNVERIFIED, isVerified false
- Communities separate: no silent conversion, no duplicate claim system
- Organization ownership ≠ platform ownership: OWNER via membership, no global admin
- IDOR prevention, mass assignment protection, URL safety validation, rate limiting, idempotency deduplication, atomic transaction, duplicate prevention same applicant pending same name, slug uniqueness with suffix.

### E2E Test: `organization-registration.e2e.js`
- Uses MongoMemoryReplSet (count 1, wiredTiger) for transaction support, stubbed email
- Covers: unauthenticated rejection, validation (missing name, short description, missing declaration), declaration required, auth identity spoof prevention, duplicate prevention same applicant pending same name 409, different applicant same name allowed 201, university request, affiliated club without parent rejected 400, club with existing parent, club with proposedParent, applicant list own only, IDOR prevention other user's request 403, mass assignment protection (status, reviewer, resultingOrganizationId, applicant, reviewHistory blocked), draft create/edit/submit/withdraw flow, super admin list/detail, state transition rejection (cannot approve withdrawn 400), request info, resubmit, rejection requires reason 400, approval creates exactly one Organization with UNVERIFIED default, OWNER membership, no platform admin, idempotent repeated approval (same org id, no duplicates), concurrent approval no duplicates, club with proposed parent creates parent org, idempotency key dedup.
- All checks passed.

## Frontend

### Applicant UX
- `/user/organizations` page:
  - Lists own requests with status badges (color-coded), pagination, actions per status (edit, submit, withdraw, resubmit, view detail)
  - Info card explaining flow, approval creates OWNER not admin, UNVERIFIED
  - Create/Edit dialog: category selector (grid), basic fields (name, slug, description, website), contact (email, phone, address, city/state/country/postal), logo/cover URL with upload via /upload/image, parent institution selector for AFFILIATED_CLUB (search existing approved parents via /parent-institutions, select, clear, or propose new parent fields), evidence section (officialWebsite, officialEmail, authorizationLetterUrl, registrationCertificateUrl, affiliationLetterUrl, collegeWebsiteListingUrl, notes) with upload buttons, role/designation, declaration checkbox with UNVERIFIED note, save as draft / submit for review, idempotency key generation for create.
  - Responsive design, mobile-friendly, uses shadcn components, toast notifications, rate limit handling.
- `/user/organizations/[id]` detail page: shows all fields, evidence viewer with links, rejectionReason, infoRequestMessage, timeline reviewHistory, resulting organization link.
- Settings page (`/user/settings`) updated to link to Organization Requests.

### Super Admin UX
- `/admin/organizations/requests` page:
  - Counts cards for each status (click to filter), search, status/category filters, pagination, list with applicant info, parent, resulting org link, quick actions (approve idempotent with Idempotency-Key, request info via prompt, reject via prompt), view detail link.
  - Approval confirmation mentions atomic, OWNER, UNVERIFIED.
- `/admin/organizations/requests/[id]` detail page:
  - Shows org details, parent/proposedParent, evidence viewer (links, otherEvidenceUrls), applicant info, potential duplicates (exact name match), review history, guidance card (verify website, auth letter, affiliation, approval creates OWNER not verification, communities separate).
  - Actions: Approve & Create Org (idempotent, with confirmation), Request info (inline textarea), Reject (inline textarea), all with loading states, toast, reload.
  - Uses existing api util, responsive, handles idempotency.

### Admin Navigation
- Updated `admin/layout.tsx` NAV to include Org Requests.
- Updated `admin/organizations/page.tsx` to link to requests, clarifies official orgs created via requests review.

### Build
- Frontend build succeeds (Next.js 15.5.9), includes new routes, no type errors, parse-check 206 files clean.

## Integration & Regression
- Existing admin-only `POST /api/organizations` preserved (no weakening)
- Existing org directory/profile, membership/RBAC, event ownership, community claims, notifications, Super Admin controls, auth, etc. preserved
- Tests: organization-registration, organization-rbac, organization-profile, phase13 (54 passed), phase14 (scale+recovery+scan-secrets) all pass, secret scan clean
- Rate limiting respects RATE_LIMIT_DISABLED, uses user-id keying
- Notification types use existing infrastructure

## Definition of Done Checklist
- [x] Audit existing org/community/auth flows (IMPLEMENTATION_PLAN_ORGANIZATION_REQUESTS.md)
- [x] Data model with state machine, indexes, idempotency
- [x] Backend service with atomic retry-safe approval, duplicate prevention, slug uniqueness, parent handling, OWNER membership, cache invalidation, notification stub
- [x] Controller with IDOR, mass assignment protection, validation, pagination
- [x] Routes with rate limit, idempotency, auth
- [x] Mounted in server.js
- [x] Notification types extended
- [x] E2E test comprehensive, uses replSet for transactions, passes
- [x] Frontend applicant pages (list, create/edit with category-specific fields, evidence upload, declaration, parent selector, draft flow, responsive)
- [x] Super Admin dashboard (list with filters/counts, detail with evidence viewer, duplicates, approve/reject/request-info with idempotency, responsive)
- [x] Frontend build passes
- [x] Regression tests pass (org-rbac, org-profile, phase13, phase14, scan-secrets)
- [x] No weakening of existing admin org creation, no platform admin escalation, approval ≠ verification, communities separate
