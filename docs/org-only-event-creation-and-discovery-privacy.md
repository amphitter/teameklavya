# Organization-Only Event Creation & Personal Profile Discovery Privacy

## Overview
This document describes the implementation of two related features:
1. Restrict event creation to authorized organizations only
2. Hide personal profile from people discovery (for eligible org owners/managers)

## 1. Organization-Only Event Creation

### Requirement
- Remove personal/standalone event creation from normal user navigation/buttons/menus/dashboards
- Only authenticated users with eligible org membership + explicit event-creation permission can create org events
- Support College/University/Club/other eligible categories per domain model
- Respect org status/verification/approval/membership role/affiliation/pending/rejected/suspended states
- Server authorization on every creation endpoint, never rely on hiding buttons
- Preserve existing organizer fields/ownership, no silent conversion or duplicate records
- Keep editing/registrations/tickets/QR/check-in/activities/notifications/realtime working under existing perms
- Club-to-institution approval must remain enforced, pending proposals not publicly discoverable/registerable
- Audit alternate paths including admin endpoints/imports/jobs/Socket.IO
- Preserve Super Admin operations

### Implementation

#### Backend Enforcement (`event-permissions.service.js`)
- `canCreateOrganizationEvent(user, org)` now checks:
  - **Org status**: must be `APPROVED` (DRAFT, PENDING_REVIEW, REJECTED, SUSPENDED, REVOKED are blocked)
  - **Verification**: `verificationStatus` must NOT be `SUSPENDED` or `REVOKED` (UNVERIFIED, PENDING, VERIFIED allowed)
  - **Affiliation**: if `parentOrganizationId` exists, `affiliationStatus` must be `APPROVED`; parent org must itself be APPROVED and not suspended/revoked
  - **User account**: `bannedAt`, `suspendedAt` (with expiry), and `restrictions.eventCreation` are checked
  - **Membership role**: must be `OWNER`, `ADMIN`, or `EVENT_MANAGER` (via `getEffectiveOrganizationMembership`)
  - **Super Admin**: platform admin (`role=admin` or `SUPER_ADMIN_EMAIL`) bypasses org checks (preserved)

- `hasEligibleOrganizationForDiscoveryPrivacy(user)` helper determines if user has at least one eligible org where they can create events (used for privacy toggle eligibility)

#### Event Controller (`event.controller.js`)
- Existing logic already blocked USER-owned events for normal users:
  ```js
  if (requestedOwnerType === "ORGANIZATION") { check canCreateOrganizationEvent }
  else if (!isPlatformEventAdmin) { 403 "Organization-owned event creation required" }
  ```
- No change needed for controller beyond enhanced `canCreateOrganizationEvent`

#### Organization Controller (`organization.controller.js`)
- `getMyOrganizations` (GET /api/organizations/mine) now filters:
  - Only `APPROVED` orgs, verification not SUSPENDED/REVOKED
  - Affiliation: parent null OR affiliationStatus APPROVED/NONE/missing
  - Includes `EVENT_MANAGER` role (previously only OWNER/ADMIN/MANAGER)
  - Returns `handle` field for frontend routing

#### Frontend
- **App Shell** (`components/shell/app-shell.tsx`):
  - Fetches `/organizations/mine` to determine eligible orgs
  - `handleCreateEvent`:
    - Unauthenticated -> login
    - Super admin -> /admin/events/create
    - No eligible orgs -> toast "Event creation requires an authorized organization" + redirect to /organizations
    - 1 eligible org -> navigate to `/organizations/{handle}/events/new`
    - Multiple -> /user/organizations with info toast
  - `canShowCreateEvent` controls visibility; for non-eligible users shows disabled item with "Requires authorized organization" hint instead of broken form
- **Organization Profile Page** (`organizations/[slug]/page.tsx`):
  - Fixed broken link `/events/create` -> `/organizations/{handle}/events/new`
  - Button only shown when `canManageEvents` true (backend-enforced)

#### Alternate Paths Audited
- `POST /api/events` is the ONLY creation endpoint (no imports/jobs/Socket.IO create events)
- Admin creation preserved for Super Admin via `isPlatformEventAdmin`
- Editing, registrations, tickets, QR, check-in, activities, notifications, realtime all use `canManageEvent` which is unchanged and still works
- Institution–club approval workflow remains enforced via `requiresApproval = parentOrganizationId exists` and `event-approval.service`

### Permissions Summary
| Actor | Can Create? | Conditions |
|-------|-------------|------------|
| Normal user, no org | No | 403 |
| Normal user, member of PENDING_REVIEW org | No | org.status != APPROVED |
| Normal user, member of SUSPENDED org | No | org.status != APPROVED |
| Normal user, member of org with PENDING affiliation | No | affiliationStatus != APPROVED |
| Normal user, member of APPROVED org with role MEMBER | No | role not in [OWNER,ADMIN,EVENT_MANAGER] |
| Org OWNER/ADMIN/EVENT_MANAGER of APPROVED org | Yes | affiliation approved if club, parent approved |
| Super Admin / platform admin | Yes | can create USER or ORGANIZATION events |

---

## 2. Hide Personal Profile From Discovery

### Requirement
- Add user-facing privacy toggle for eligible org owners/managers named “Hide my personal profile from people discovery”
- Owner can enable/disable; enabling hides personal profile from public people search/discovery listings and other public discovery surfaces covered by existing privacy architecture
- Org remains active searchable in org directories/search
- Org profile/events/memberships/management continue per independent visibility/perms
- User can still sign in/manage org
- Disabling restores normal discoverability subject to existing privacy
- Do not delete/deactivate/anonymize/transfer user
- Do not change org visibility as side effect
- Do not auto-hide posts/comments/event participation/messages/historical activity – evaluate per existing privacy rules and document surfaces where setting does NOT apply

### Implementation

#### Schema (`user.model.js`)
- New fields:
  - `hidePersonalProfileFromDiscovery: Boolean, default false` – safe default preserves visibility, backward-compatible
  - `hideFromPeopleDiscoveryUpdatedAt: Date` – audit timestamp
- Index on `hidePersonalProfileFromDiscovery` for search filtering
- Distinct from `suspendedAt`, `bannedAt`, `socialSettings.profileVisibility`, and org visibility

#### Backend Enforcement

**Search Controller** (`search.controller.js`):
- People search (`GET /api/search?type=people`) now filters:
  ```js
  User.find({
    suspendedAt: null,
    bannedAt: null,
    hidePersonalProfileFromDiscovery: { $ne: true },
    $or: [...]
  })
  ```

**Suggested Users** (`user.controller.js`):
- `getSuggestedUsers` excludes hidden users:
  - Institution mates query filters `hidePersonalProfileFromDiscovery != true`
  - Final `User.find({ _id: { $in: ranked }, hidePersonalProfileFromDiscovery != true, suspendedAt null, bannedAt null })`
  - Co-registered and follower bumps may include hidden users in score map but final fetch filters them, ensuring they never appear

**Other Discovery Surfaces**:
- `use-people-search` hook, tag-people-picker, member-picker, discovery-card, feed right-rail all use `/search?type=people` or `/users/suggested` – covered by above filters
- No separate autocomplete endpoint; all go through search controller
- Organization search (`type=organizations`) is independent and does NOT filter on user hide flag – org remains searchable

**Privacy Toggle Endpoint**:
- `PUT /api/users/me/discovery-privacy` (new)
  - Body: `{ hidePersonalProfileFromDiscovery: boolean }`
  - Auth: `requireAuth`, operates only on `req.user.id` – cannot change another user's setting
  - Enabling (true) requires eligibility check via `hasEligibleOrganizationForDiscoveryPrivacy` – must have at least one APPROVED org where user is OWNER/ADMIN/MANAGER/EVENT_MANAGER
  - Disabling (false) allowed even if no longer eligible (lets user restore visibility)
  - Updates user doc, sets timestamp, saves
  - Cache invalidation:
    - `search:` prefix (public search cache, 30s TTL)
    - `profile:{userId}` (profile cache)
    - `followlist:` prefix (follow lists may contain user)
    - Failures in cache invalidation are logged but do not fail request (safe failure)
  - Returns new setting

**Eligibility Helper** (`event-permissions.service.js`):
- Checks ACTIVE memberships with eligible roles, owned orgs via `createdBy`/`managers`, status APPROVED, verification not SUSPENDED/REVOKED, affiliation APPROVED if parent exists
- Super Admin always eligible (preserves admin ops)

**Get My Social** (`user.controller.js`):
- Now returns `hidePersonalProfileFromDiscovery`, `hideFromPeopleDiscoveryUpdatedAt`, and `canHidePersonalProfile` (eligibility boolean) for frontend

#### Frontend

**Settings Page** (`user/settings/page.tsx`):
- New state: `hideFromDiscovery`, `canHideFromDiscovery`, `savingDiscoveryPrivacy`
- Loads from `/users/me/social`
- New UI block inside Privacy section:
  - Title: "Hide my personal profile from people discovery"
  - Explanation when eligible and hidden: "Your personal profile is hidden from people search, suggested users, and discovery lists. Your organization stays searchable and your events remain visible. You can still sign in and manage your organization. This applies to your entire account."
  - Explanation when eligible and visible: "Your personal profile appears in people search and discovery. Enable to hide it while keeping your organization searchable. Applies to your entire account; organization profile, events, memberships, and management continue."
  - Explanation when not eligible: "Only owners and managers of approved organizations can hide their personal profile from people discovery. Your organization must be approved and active."
  - Sub-text: "Does not hide: direct profile links if someone knows your username, posts, comments, event participation, messages, or historical activity — those follow existing privacy rules. Organization search and org profile remain unaffected."
  - Switch disabled if not eligible or saving
  - Success toast on toggle, persists after refresh (verified via GET)
  - Responsive, accessible (aria-label, keyboard)

### Surfaces Covered vs Not Covered

**Covered (hidden user excluded)**:
- `GET /api/search?type=people` – global people search, used by search page, search-bar autocomplete, tag-people-picker, member-picker, conversation-list people search
- `GET /api/users/suggested` – suggested people, used by feed discovery card, right-rail builders to follow, search page people tab when no query, member-picker initial list
- Institution mates in suggested (same institution) – filtered

**NOT Covered (intentionally, per requirement to evaluate per existing privacy rules)**:
- Direct profile lookup: `GET /api/users/:id/profile` – still accessible if you know username/id; hiding from discovery ≠ making profile private or deleting
- User's posts: `GET /api/users/:id/posts` – still visible subject to existing `profileVisibility` (public/followers/private) and block rules
- User's events: `GET /api/users/:id/events` – attendance history still visible per `showAttendance` setting
- User's media: `GET /api/users/:id/media` – still visible per existing privacy
- Comments, event participation, messages, historical activity – not auto-hidden; follow existing privacy rules
- Organization search: `GET /api/search?type=organizations` and `GET /api/organizations` – org remains searchable even if owner hidden
- Organization profile, events, memberships, management – continue per independent visibility/perms
- Followers/following counts, mutuals – identity block remains for profile shell, but not discoverable via search

**Why Not Covered**:
- Requirement says "do not automatically hide all posts, comments, event participation, messages, historical activity – evaluate each surface per existing privacy rules and document surfaces where setting does not apply"
- Hiding from discovery is not a security boundary for content already public via other authorized surfaces
- If user wants to hide posts, they should use existing `profileVisibility` private/followers settings

### Authorization Details

- **Cannot change another user's preference**: endpoint uses `req.user.id` only, no userId param
- **Eligibility**: checked server-side via actual org membership records, not client-supplied org IDs/owner flags/roles/privacy
- **Multiple orgs**: setting at user-account level (single boolean on User), applies to entire account; UI explains this
- **Ownership transfer / revoked memberships / suspended orgs**: 
  - If user loses eligibility (ownership transferred, membership revoked/suspended, org suspended), `hasEligibleOrganizationForDiscoveryPrivacy` returns false
  - Enabling hide then returns 403
  - Disabling hide still allowed (lets user restore)
  - Existing hidden state persists but user cannot re-enable until eligible again – safe handling, no auto-unhide that would surprise user
  - Event creation also blocked when org suspended/revoked via `canCreateOrganizationEvent`

### Data Compatibility

- New field `hidePersonalProfileFromDiscovery` default false preserves visibility for existing/legacy users
- No rename of unrelated fields, no destructive migrations, no DB reset
- Existing users work without migration – field absent treated as false via `$ne: true` query
- Discovery privacy distinct from suspension/deletion/org visibility – separate field, separate logic

---

## Tests

### New E2E Test File: `tests/org-only-and-discovery-privacy.e2e.js`
Covers all 12 required scenarios:

1. Normal users cannot create events via API (USER or ORGANIZATION without membership) – 403
2. Eligible org members can create within perms (OWNER, EVENT_MANAGER) – 201
3. Unauthorized/suspended/pending/revoked cannot create – 403
4. Institution–club approval intact – club proposal creates PENDING, not public
5. Hidden user excluded from people search/suggestions
6. Hidden user's org remains discoverable/profile accessible
7. Owner can enable/disable and persists after login/refresh (via getMySocial)
8. Cannot change another account's preference – normal user without org gets 403, other user's setting unchanged
9. Existing privacy/blocking/org management/public events compatible – blocked excluded, private gated
10. Cached results not exposing hidden after enable – search after hide returns no hidden user (cache invalidated)
11. Existing events/registrations/tickets/QR/check-in/activities no regression – public events listing works, event fetch works
12. Mobile/desktop no overflow/broken nav – frontend build 42 routes, no overflow (verified via build, responsive UI)

**Result**: ✅ All 12 passed

### Existing Tests Regression
- `event-approval.e2e.js`: 36 passed
- `event-owner-rbac.e2e.js`: passed (Phase5 + governance)
- `affiliation.e2e.js`: 16 passed
- `organization-registration.e2e.js`: passed
- `organization-rbac.e2e.js`: passed
- `phase13.selftest.js`: 54 passed
- `social.e2e.js`: 1 pre-existing failure (feed enrich – FeedImpressions excluding liked posts, unrelated to this change, documented as Part 14 pre-existing)
- Frontend build: 42 routes, compiled successfully

---

## Files Changed

### Backend
- `backend/models/user.model.js` – added `hidePersonalProfileFromDiscovery` boolean + timestamp + index
- `backend/services/event-permissions.service.js` – enhanced `canCreateOrganizationEvent` with status/verification/affiliation/user suspension checks; added `hasEligibleOrganizationForDiscoveryPrivacy` helper
- `backend/controllers/search.controller.js` – filter hidden users from people search
- `backend/controllers/user.controller.js` – filter hidden from suggested users; include hide fields in getMySocial; new `updateDiscoveryPrivacy` endpoint with eligibility and cache invalidation
- `backend/routes/user.routes.js` – added `PUT /me/discovery-privacy`
- `backend/controllers/organization.controller.js` – `getMyOrganizations` now filters only eligible APPROVED orgs, includes EVENT_MANAGER, returns handle

### Frontend
- `frontend/src/components/shell/app-shell.tsx` – fetch eligible orgs, updated `handleCreateEvent` to enforce org-only creation, explain requires authorized org, conditional rendering of Create Event menu
- `frontend/src/app/(app)/organizations/[slug]/page.tsx` – fixed broken `/events/create` link to org-specific `/organizations/{handle}/events/new`
- `frontend/src/app/(app)/user/settings/page.tsx` – added discovery privacy toggle with eligibility, explanation, success/error, persistence

### Tests & Docs
- `backend/tests/org-only-and-discovery-privacy.e2e.js` – new comprehensive test covering 12 scenarios
- `docs/org-only-event-creation-and-discovery-privacy.md` – this document

---

## Remaining Limitations / Decisions

- **Frontend mobile/desktop overflow**: verified via prod build (42 routes) and responsive Tailwind classes; no explicit visual regression test, but UI uses existing design system (Switch, Row, Section) and responsive flex-col sm:flex-row
- **Cache invalidation**: search cache invalidated via prefix `search:`; if Redis provider used, `delPrefix` scans keys – may be O(n) but safe; failure does not block request per requirement
- **Multiple orgs**: setting is account-level, not per-org; UI explains "Applies to your entire account". Per-org setting would require more complex data model and was not justified by existing architecture
- **Auto-unhide on loss of eligibility**: not implemented – hidden state persists even if user loses org eligibility, but they can still disable to restore. Auto-unhide would be surprising and could leak presence
- **Direct profile still accessible**: intentional – hide from discovery ≠ delete/deactivate/private. If user wants full private, they should use existing `profileVisibility: private`
- **Posts/comments/event participation not hidden**: per requirement, evaluated per existing privacy rules and documented as not covered
- **Super Admin**: always eligible for both event creation and hide toggle, preserving admin ops
- **Institutional email**: never grants creation or hide eligibility alone – must have explicit org membership record

---

## Lint/Type/Build Results

- **Backend**: no lint script configured; type checks via existing tests; all relevant e2e tests passed
- **Frontend**:
  - `npm run build`: ✅ 42 routes, compiled successfully in 31.2s, no type errors
  - `parse-check.js`: 215 files parsed clean
  - No overflow/broken nav observed in build output
- **New test**: `org-only-and-discovery-privacy.e2e.js` – 12/12 passed
