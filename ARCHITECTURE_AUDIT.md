# EventHub — Organization System Architecture Audit

**Origin:** Phase 0 — audit-only checkpoint  
**Date:** 2026-10-09  
**Snapshot:** branch `main`, HEAD `135f8d0` (`Old Feed: show history when the fresh stream is empty`)  
**Current status:** Phases 0–14 are complete within their explicit authorizations; Phase 15 and later remain unapproved.

> **Phase 0 scope (historical):** This audit checkpoint inspected the repository and documented its existing design without changing models, schemas, migrations, routes, APIs, UI, or configuration. No production database was queried and no migration, build, browser test, or regression suite was run during Phase 0. The user later authorized Phases 1–6. This document preserves the Phase 0 findings and records later implementation below; it is not approval for Phase 7 or beyond.

## 1. Executive summary

EventHub already has an Organization feature, but it is **not yet the organization ownership and RBAC system described in the proposed plan**. The work should be treated as a compatibility-conscious extension, not a greenfield rebuild.

The most important architectural fact is that an Event currently has several distinct identity/association fields:

- `createdBy` — the user who created it; this is what current event-management checks principally use.
- `organization` — an optional Organization reference. The Event schema comment calls this the owning organization, but current authorization still keys off `createdBy`; the reference is used for host/profile discovery and does not grant organization control.
- `community` — an optional Community reference.
- `organizer` — a free-text display field, not an authorization owner.

There is no current `organizerType`/`organizerId` polymorphic owner. An event with `organization` set is therefore **not proof by itself** that organization ownership was transferred to that organization. The correct Phase 5 backfill rule must be decided and audited against real records before it is applied.

Organizations are stored in MongoDB with a basic profile, follows, a verification boolean, and an array of manager user IDs. Communities are a separate entity with memberships, claims, and their own verification lifecycle. The two must not be collapsed into one collection or have their existing records silently reinterpreted.

At the Phase 0 checkpoint, the principal conclusion was: **do not start Phase 1 until the decision points in §10 have been reviewed.** Those gates were subsequently handled through the explicitly authorized phases. The confirmed Event ownership mapping and results for Phases 5–14 are recorded in §§14–23. Phases 10–14 were authorized subsequently; Phase 15 and later remain unapproved.

## 2. Current architecture

### Runtime and data stores

- Monorepo: `backend/` is Node.js + Express 5 + Mongoose; `frontend/` is Next.js 15 + React 19. README identifies Render for the API and Vercel for the frontend (`README.md:10–15`; `render.yaml`).
- MongoDB is required at backend boot (`backend/server.js`, `backend/config/db.js`) and is the live persistence path for Events, Users, Organizations, Communities, registrations, tickets, and live-event data.
- Supabase organization/social SQL and repositories exist as **prepared artifacts**, not the active organization runtime path. The SQL schema has `organizations`, `org_members`, and `org_follows` (`backend/db/supabase/schema.sql:176–224`), but the running repository barrel selects Mongo repositories (`backend/repositories/index.js`) and the Render blueprint sets `SYNC_ENABLED=false`. Do not treat the Supabase schema as a live membership table or switch stores as part of this project.
- Redis/Upstash is used behind existing cache, lock, idempotency, and rate-limit services. Reuse those boundaries; do not introduce a new infrastructure tier for organizations.

### Authentication and current admin model

- The browser sends a Bearer JWT through `frontend/src/utils/api.js`. `requireAuth` validates the token, checks the live user for suspension, and assigns `req.user` (`backend/middleware/auth.middleware.js:35–69`). Google OAuth exchanges a short-lived code for the ordinary auth token (`backend/routes/google.routes.js`).
- `User.role` is currently only `user | admin` (`backend/models/user.model.js:96+`). There is no stored `SUPER_ADMIN` role today.
- The permanent Super Admin is derived from `SUPER_ADMIN_EMAIL` (default `devanshsinghr00@gmail.com`) in `backend/services/ownership.service.js`. `requireAdmin` accepts an admin role **or** that configured email; `requireSuperAdmin` checks the configured email (`backend/middleware/auth.middleware.js:75–86, 120–130`). This differs from the requested stored `role = SUPER_ADMIN` design and needs a safe transition, not scattered email checks.
- The shared `canManageEvent` helper checks the database `admin` role or `event.createdBy`; it does not independently recognize the configured Super Admin email. A Super Admin with a non-admin stored role therefore does not automatically pass those creator-scoped paths.
- `frontend/src/app/admin/layout.tsx` uses a client-side `role === "admin"` gate. That is UI behavior only; API authorization is server-side. It also means a Super Admin whose stored role is only `user` can pass the backend's `requireAdmin` / `requireSuperAdmin` checks yet fail the admin-layout UI gate.

## 3. Direct answers to the Phase 0 questions

| Question | Current behavior | Evidence / consequence |
|---|---|---|
| **Who currently owns an Event?** | There is no single polymorphic owner field. `createdBy` is the creator and is used by `canManageEvent`; `organization` and `community` are optional associations. `organizer` is display text. | `backend/models/event.model.js:225–230`; `backend/middleware/auth.middleware.js:106–114`. A future ownership migration cannot safely infer legal/control ownership from `organization` alone. |
| **Who can create an Event?** | A signed-in platform admin (including the configured Super Admin through `requireAdmin`). | `POST /api/events` has `requireAuth, requireAdmin` (`backend/routes/event.routes.js:16–20`). The controller verifies an attached Organization exists, then sets `createdBy` to the current user (`backend/controllers/event.controller.js:49–67, 144–147`); it does not check Organization membership. |
| **Who can edit/delete an Event?** | Event create/update/delete, event ID reads, admin event lists, registration exports/lists, ticket management and scan routes are generally `requireAdmin`-gated. Some activity/live-setting/analytics/realtime paths use `canManageEvent`, which allows a database admin or the Event's `createdBy` user; Organization managers are not recognized. The admin delete endpoint hard-deletes the Event; `removedAt` is used for moderation takedowns, not archival. | `backend/routes/event.routes.js:16–51`; `backend/controllers/activity.controller.js`; `backend/services/realtime.service.js`; `backend/controllers/event.controller.js:481–493`. `updateEvent` passes the request body to `findByIdAndUpdate` after limited checks (`backend/controllers/event.controller.js:324–372`), so it must be field-allowlisted before any new scoped organizer role is granted access. |
| **Who can send tickets?** | A registered user can request their own ticket through `/api/tickets/generate`; registration can auto-generate tickets according to Event settings. Bulk generation, pending approval, manual ticket sending, scanning and ticket analytics are admin-only. | `backend/routes/ticket.routes.js:12–29`; `backend/controllers/ticket.controller.js`; `backend/controllers/registration.controller.js:130+`; `backend/services/ticket.service.js`. Organization-scoped ticket permissions do not exist. |
| **Who can send announcements?** | Platform admins can send RSVP/invitation email and the `/events/:id/notify-all` email to all users. Live-room announcements are a separate realtime organizer action checked with `canManageEvent`. Creating an organization-linked Event can trigger an in-app notification to the Organization's followers; that is not organization email. | `backend/routes/event.routes.js:29–34`; `backend/controllers/event.controller.js:495–570`; `backend/services/realtime.service.js` announcement handler; `backend/controllers/event.controller.js:152–165`. |
| **How is admin represented?** | `User.role === "admin"`; permanent Super Admin is an environment-configured email identity, not a database role. | `backend/models/user.model.js`, `backend/services/ownership.service.js`, `backend/middleware/auth.middleware.js`. |
| **How are permissions checked?** | Server middleware plus separate per-domain helpers: `requireAuth`, `requireAdmin`, `requireSuperAdmin`, `canManageEvent`, an Organization controller-local `canManageOrg`, and Community controller-local manager checks. Checks are not yet one shared Organization/Event capability service. | `backend/middleware/auth.middleware.js`; `backend/controllers/organization.controller.js`; `backend/controllers/community.controller.js`. Frontend visibility is not a security boundary. |
| **How are images stored?** | `media.service.js` is the application boundary; `storage.provider.js` chooses Cloudinary when configured and local disk otherwise. Uploads use memory-backed Multer, size/MIME/magic-byte/dimension checks and `MediaAsset` orphan tracking. Render's local fallback is ephemeral. | `backend/services/media.service.js`, `backend/services/storage.provider.js`, `backend/routes/upload.routes.js`, `backend/models/mediaAsset.model.js`; deployment warning in `backend/.env.example`. Organization/Event records currently store image URLs; Events have banner fields but no logo field. |

**Participant data is split by sensitivity:** the unauthenticated `GET /api/events/:id/participants` endpoint returns up to 50 confirmed participants with minimal name/avatar fields (`backend/routes/event.routes.js:23`; `backend/controllers/event.controller.js:950–974`). That handler does not load the Event or enforce its visibility, so the expected policy for private/unlisted Events should be explicitly decided and covered in the later security phase. The full registration list/export contains more sensitive registration data and is currently admin-gated (`backend/routes/registration.routes.js:22–25`). Organization permissions must not turn the public preview into access to the full registration dataset.

## 4. Organization and Community state today

### Organization

`backend/models/organization.model.js` currently defines:

- `name`, unique `slug`, `description`, `logoUrl`, `coverUrl`, `website`
- `createdBy`
- `isVerified`, `verifiedAt`
- `managers: User[]`
- timestamps

It does **not** currently define the planned `handle`, category, address/location, contact/social links, `parentOrganizationId`, membership records/roles/statuses, or separate organization `verificationStatus`, `ownershipStatus`, and `status` enums. There is no Mongo `OrganizationMembership` model or central organization-category configuration. `OrgFollow` already exists with a unique `(user, organization)` index (`backend/models/orgFollow.model.js`).

Existing routes include public list/profile/events/posts/communities, personal/followed/suggested lists, update/follow, verification/unverification, and Super Admin-assigned managers (`backend/routes/organization.routes.js`). Organization creation is admin-only; updates are granted to the creator, any listed manager, platform admin, or configured Super Admin (`backend/controllers/organization.controller.js`). The manager array has no per-person role or status.

### Community (keep distinct)

`Community` is a member group with its own slug, join policy, soft-delete field, organization references, and community status (`backend/models/community.model.js`). `CommunityMember` has `admin/member` roles and active/pending/invited status; `CommunityClaim` records evidence and manual claim review; `AuditLog` supports organization/community ownership actions. Claim/verification/transfer flows are primarily about communities claiming official affiliation with an Organization (`backend/controllers/community.controller.js`).

This existing graph is not the same as the proposed Organization parent hierarchy. Phase 3 should add or map explicit organization parent links without rewriting Community membership, claim, or event references.

### Existing frontend

- `/organizations` and `/organizations/[slug]` already exist. The directory and profile consume the current Mongo API. The public profile currently has upcoming/past events, posts, and communities; it is not yet the planned profile with category/location/social information and an independently paginated Members/Media/About section.
- `/admin/organizations` is an admin-only create/edit screen with basic fields and logo upload; it is not organization-self-service creation or a management dashboard.
- Event create/edit UI is under `/admin/events/...`. `EventForm` offers optional Organization and Community attachments and a landscape poster; it is not an Organization-owned event console.
- The app shell has a Communities link and followed Organization list. The existing navigation and routes should be extended, not duplicated.

## 5. Discovery, pagination, and profile observations

> **Historical baseline:** The bullets in this section describe the pre-Phase-2 repository audited above. Phase 2 added category/city/verification/following filters and cursor pagination to the separate Organization directory, plus profile About/contact/social fields and independent cursor pages. Phase 3 now adds Organizations to global search and implements direct parent-institution links for eligible club/community categories. Verification/RBAC and Event ownership remain later phases.
>
> **Phase 3 link contract:** Institutions may be `COLLEGE`, `UNIVERSITY`, `SCHOOL`, or `INSTITUTE`. `STUDENT_CLUB`, `COLLEGE_CLUB`, `COLLEGE_COMMUNITY`, `UNIVERSITY_COMMUNITY`, `CULTURAL_CLUB`, and `SPORTS_CLUB` may link to the allowed institution categories configured in `backend/config/organization.js`; each has at most one direct parent and nested links are rejected. A creator/manager (or existing platform admin/Super Admin path) of the child can set/unset the link. It is a public association only—not ownership, approval, or verification—and does not change Community, Event, membership, or RBAC behavior.

- The global search API supports `events`, `communities`, `people`, and `posts`; it does not search Organizations (`backend/controllers/search.controller.js:6, 22–26, 32–104`). The frontend search page has All/Events/People tabs; Organizations have a separate directory.
- The Organization directory debounces typing in the frontend, but `/api/organizations?q=` returns at most 50 records with no cursor (`backend/controllers/organization.controller.js:115–153`). It has no category/city/verified/followed/featured server filters.
- The current Organization Events endpoint returns all upcoming events and up to 12 past events; Organization Posts use page/limit offset pagination; Organization Communities are capped at 24 (`backend/controllers/organization.controller.js:241+ and 478+`). That does not meet the new independent cursor-pagination target. `/organizations/mine` also returns all organizations for admin users.
- Profile Events currently belong to the user's registration/attendance history (`backend/controllers/user.controller.js`, `frontend/src/components/profile/profile-screen.tsx`). Organization-owned event rendering is an additional identity surface, not a replacement for user attendance history.

## 6. Cross-feature dependency map

| Surface | Existing source of truth / key files | What an Organization rollout must preserve or extend |
|---|---|---|
| Organization profile/follows | `models/organization.model.js`, `models/orgFollow.model.js`, `controllers/organization.controller.js`, `frontend/src/app/(app)/organizations/...` | Keep current IDs/URLs and follows; add richer fields, roles, status and paginated sections compatibly. |
| Event ownership and admin | `models/event.model.js`, `controllers/event.controller.js`, `routes/event.routes.js`, `repositories/event.repository.js` | Phase 5 is the high-risk transition. Preserve `createdBy`, `organization`, `community`, existing Event IDs and public URLs during a staged migration. |
| Registration and participants | `registrationResponse.model.js`, `registrationForm.model.js`, `registration.controller.js`, `RegistrationRepository`, `RegistrationForm.tsx` | Apply scoped `canViewParticipants`/registration operations server-side; retain privacy split, unique registration semantics, exports and forms. |
| Tickets / QR / check-in / check-out | `ticket.model.js`, `ticket.controller.js`, `ticket.service.js`, `ticket.routes.js`, event scan/admin pages | Scope every issue/resend/approve/scan/stat action to the owned Event; keep QR token and ticket behavior unchanged. |
| Activities, quiz, poll, Q&A, live event | `activity.controller.js`, `live.controller.js`, `services/realtime.service.js`, activity/quiz models, `/admin/events/[id]/...` | `canManageEvent` is used by both HTTP and Socket.IO. A permission change must cover both; UI-only gating is insufficient. |
| Feed and event posts | `post.model.js`, `post.controller.js`, `FeedPost`, `SharedPostCard` | Preserve author/organization/community identity and privacy; distinguish posting on behalf of an Organization from Event ownership. |
| Search/discovery | `search.controller.js`, `routes/search.routes.js`, search page/bar, `/organizations` | Add Organizations as a server-filtered, debounced, cursor-paginated entity; never fetch the entire collection. |
| User profile / notifications / messages | user profile/event routes, notification controller/item, feed/event-share cards | Add Organization/Event identity data without changing user attendance, existing notification delivery, or shared-event behavior. |
| Admin / Super Admin governance | `admin.controller.js`, `admin.routes.js`, `ownership.service.js`, claims/organizations admin pages | Reconcile platform admin, Super Admin, and Organization RBAC; retain current protected account behavior. |
| Mail and announcements | `email.service.js`, `emailTemplates.js`, event/ticket controllers, realtime announcement handler | Keep transactional email service; create a separate authenticated communication/history layer only in its planned phase. |
| Images/storage | `upload.routes.js`, `media.service.js`, `storage.provider.js`, `MediaAsset`, frontend crop editor/forms | Store separate banner/logo URLs/asset IDs and preserve old events with `logo = null`; use existing provider abstraction and canonical crops. |
| Caches/indexes | `EventRepository`, `OrganizationRepository`, `cache.service.js`, model indexes | Invalidate every changed cached profile/event projection; add only indexes justified by query patterns and migration preflight. |

## 7. Existing media lifecycle finding (resolved in Phase 6)

At the original Phase 0 snapshot, the generic `/api/upload/image` endpoint created a `MediaAsset` in `pending` state with a 24-hour cleanup time and returned a `publicId`; callers needed to call `/api/upload/attach` or otherwise mark it attached (`backend/routes/upload.routes.js`; `backend/services/media.service.js`).

At that snapshot, the Organization admin form and public Organization profile stored only the returned URL and did not send `/upload/attach`. EventForm also uploaded posters through the generic endpoint, retained only the URL, and then saved the Event. Such assets could therefore be reclaimed by the opt-in sweeper when run with `--apply`. The Event-specific banner route already tracked its banner ID, but EventForm was not using it.

The public Organization profile also requested `folder=organizations`, while the uploader whitelisted only `organizers`; the unrecognized value fell back to `misc`, losing the intended logo limit/preset. This was an audit-snapshot finding, not a current-state description.

**Phase 6 resolution:** the EventForm now uses the existing dedicated Event banner route and a separate manager-authorized square Event-logo upload/replace/remove route; both attach new assets, invalidate the public Event cache, and retire displaced assets. The Organization admin and public profile upload flows confirm attachment only after the profile write succeeds; the public form uses `organizers` for logos and `posters` for covers, while the backend retains `organizations` as a mapped compatibility alias. `/upload/attach` now verifies uploader ownership and reports failed attachment updates so the client can retry. Local-provider deletion safely removes files under its configured upload root, and Event hard deletion retires tracked banner/logo assets. The legacy 16:10 Event banner crop is unchanged.

## 8. Files likely to be involved (by phase)

This is an impact list, not permission to modify them now.

### Backend

- Organization foundation/discovery: `backend/models/organization.model.js`, `backend/models/orgFollow.model.js`, a new Organization membership model and category config, `backend/controllers/organization.controller.js`, `backend/routes/organization.routes.js`, `backend/repositories/organization.repository.js`, and focused tests.
- Permissions: `backend/middleware/auth.middleware.js`, `backend/services/ownership.service.js`, and preferably one central Organization/Event capability service. Then audit all consumers: `event.controller.js`, `registration.controller.js`, `ticket.controller.js`, `activity.controller.js`, `live.controller.js`, `community.controller.js`, and `services/realtime.service.js`.
- Event ownership/logo: `backend/models/event.model.js`, `backend/repositories/event.repository.js`, event/registration/ticket/activity/live controllers and routes, `backend/routes/upload.routes.js`, `backend/services/media.service.js`, `backend/models/mediaAsset.model.js`, email templates and notification projections.
- Search/mail/governance: `search.controller.js`/routes, `admin.controller.js`/routes, `services/email.service.js`, templates, and—if delivery history is required—a separate communication persistence/API surface. `Outbox` currently supports Mongo-to-Supabase sync; it is not an email delivery ledger.

### Frontend

- Existing Organization surfaces: `frontend/src/app/(app)/organizations/page.tsx`, `frontend/src/app/(app)/organizations/[slug]/page.tsx`, `frontend/src/app/admin/organizations/page.tsx`, `frontend/src/components/shell/app-shell.tsx`.
- Search and event surfaces: `frontend/src/app/(app)/search/page.tsx`, `frontend/src/components/search/search-bar.tsx`, `frontend/src/components/event-card.tsx`, `frontend/src/app/(app)/events/[slug]/page.tsx`, `frontend/src/components/admin/event-form.tsx`, `frontend/src/app/admin/events/...`.
- Cross-surface event identity: `frontend/src/components/feed/feed-post.tsx`, `frontend/src/components/post/shared-post-card.tsx`, `frontend/src/components/profile/profile-screen.tsx`, `frontend/src/components/notifications/notification-item.tsx`, ticket/registration views, and any shared event preview.
- Future mail/management screens should be new organization-scoped routes/pages, not a renamed copy of the platform admin console. `frontend/src/utils/api.js` remains the API boundary; browser code must not access MongoDB, Supabase, or Cloudinary credentials directly.

## 9. Protected boundaries — what must not be rewritten or repurposed

1. **Do not replace MongoDB, the Express API, or the existing API/storage architecture.** Supabase is not the active Organization source of truth in this deployment.
2. **Do not repurpose `Community` as `Organization`.** Existing members, claims, status, events and community posts have separate behavior.
3. **Do not remove or overwrite `Event.createdBy`, `Event.organization`, or `Event.community` during an initial rollout.** Keep compatibility until a measured backfill is verified and old clients/projections are accounted for.
4. **Do not weaken existing user/event capabilities**—auth, registration, ticket/QR, check-in/out, live activities, feed, search, profile, messages and notifications. New permissions should add scoped access, not bypass existing safeguards.
5. **Do not treat hidden frontend controls as authorization.** Every new write/read capability must be enforced at the backend route/controller/service and at Socket.IO command handlers where applicable.
6. **Do not duplicate Super Admin email checks across controllers.** Preserve the current centralized ownership protection while a database role is introduced and verified.
7. **Do not delete media solely because an upload URL is absent from a new field until asset references and legacy URLs are reconciled.** Use the provider abstraction and existing `MediaAsset` lifecycle.
8. **Do not implement the organization system as a frontend-only edit.** Creation, member roles, ownership, events and communication must persist and authorize through the backend.

## 10. Migration risks and decisions required before Phase 1

### A. `slug` versus `handle`

Mongo Organizations, community claims, public links, event pages, notifications and the frontend use `slug`. The requested API uses `handle` and `/organizations/[handle]`. Decide whether `handle` becomes the canonical stored field with a compatibility alias/redirect, or whether the existing `slug` remains canonical and is exposed as `handle`. Do not rename it in place without preserving every old profile link and reference.

### B. Existing Organization state and membership backfill

Current Organizations have `isVerified` and `managers[]`, not the requested status triplet and membership rows. A migration needs explicit mapping for creator → OWNER, existing managers → an agreed role, verified → verification state, and existing organizations' overall review/status. The current data does not encode enough information to infer every new ownership/review state. No production records were inspected in this Phase 0 audit.

### C. Event ownership backfill

Before Phase 5, produce a dry-run report by cohort: events with only `createdBy`, with `organization`, with `community`, with both/none, removed/legacy events, and linked registrations/tickets/posts. `createdBy` is optional in the Mongoose schema, so missing creator cases must be handled. Do not automatically convert every event with an `organization` reference into an Organization-owned event until that reference is confirmed to represent control rather than an event-host label.

**Decision confirmed for Phase 5:** legacy `createdBy` maps to USER ownership; `organization` and `community` remain independent associations; a legacy Event without `createdBy` maps to PLATFORM/admin-only. New Organization ownership is explicit at creation; any later legacy transfer requires a reviewed allowlist.

Keep old fields during an expand/backfill/verify/dual-read period. The new owner must be immutable to ordinary event managers; use an explicit field allowlist on update routes before organization roles can write.

### D. Verification and ownership are separate dimensions

The supplied spec defines Organization `status`, `verificationStatus`, and `ownershipStatus`, while the existing Community claim workflow has its own status/resolution. Preserve each lifecycle and define legal transitions/actors instead of compressing them into `isVerified`. There is also a category inconsistency: `COLLEGE_COMMUNITY` and `UNIVERSITY_COMMUNITY` appear in the parent-linking rule but not the central category list. Resolve whether those are categories or map them to `COMMUNITY`/`COLLEGE_CLUB` before freezing the enum.

### E. Super Admin role transition

The requirement says `role = SUPER_ADMIN`; current persistence allows only `user | admin` and protects the configured email centrally. Decide how to add a stored role without creating a demotion/deletion/transfer path or breaking old sessions. Keep the existing central email guard as a migration backstop until a seeded role is verified end-to-end; do not scatter literal email comparisons. The admin-layout role-only gate and existing hardcoded client checks should be reconciled with backend identity.

### F. Authorization coverage is wider than event HTTP CRUD

New `canManageEvent` behavior must cover REST routes, registration and ticket operations, exports, check-in/out, activities/questions, live settings and Socket.IO actions. Organization role capabilities must distinguish manage-own-organization from manage-own-event and platform-only actions. Scope server queries by `(organizerType, organizerId)` once that model exists; never fetch all Events and filter in the browser.

### G. Mail delivery and media references

The current mail service can send but does not provide the requested Communication console/history with recipients, subject, created/sent/failed/pending statuses. Add that capability only in the mail phase; do not treat sync outbox rows as mail records. The media attachment/folder issues identified above were repaired in Phase 6; do not copy pending-asset behavior into future Event media.

### H. Indexing and data safety

The Mongo schema already declares unique slug, Organization name, follow pair, Event organization/creator, and Community link indexes. Add only indexes justified by actual paginated filters and validate existing duplicates before introducing new unique indexes. Keep any production migration dry-run-first, idempotent, reversible where possible, and non-destructive to existing Event data.

## 11. Proposed order and phase-number reconciliation

The detailed sections and final dependency map in the supplied brief describe **Phase 0 through Phase 12**, while the short rollout diagram compresses the work into **Phase 0 through Phase 10** and labels performance/UI stabilization differently. To avoid accidentally omitting mandatory work, use the detailed dependency map as the implementation order unless you revise the numbering:

1. Phase 0 — audit (this document; completed)
2. Phase 1 — Organization backend/data foundation (**completed**)
3. Phase 2 — Organization profile and discovery (**completed**)
4. Phase 3 — college/club linking and Organization search (**completed**)
5. Phase 4 — verification states and backend-first RBAC (**completed in §13**)
6. Phase 5 — staged Event ownership transition and Organization event management (**completed in §14**)
7. Phase 6 — separate Event logo with `null` compatibility for legacy Events (**completed in §15**)
8. Phase 7 — Super Admin governance and communication controls (**completed in §16**)
9. Phase 8 — mail UI and mail-layout work (**completed in §17**)
10. Phase 9 — responsive UI stability pass (**completed in §18**)
11. Phase 10 — performance/pagination/index optimization (**completed in §19**)
12. Phase 11 — direct-API security tests (**completed in §20**)
13. Phase 12 — full Event-model regression pass (**completed in §21**)
14. Phase 13 — auth hardening & fuzzing (**completed in §22**)
15. Phase 14 — scale, realtime readiness & restore/secret separation (**completed in §23**)

This ordering preserves the stated dependency that Event ownership changes happen only after the Organization foundation and RBAC are stable, and that security/regression checks remain explicit gates.

## 12. Phase 0 acceptance result

- [x] Existing User, Event, Organization, Community, auth/admin, search, registration, ticket, live/activity, feed/profile, mail and media paths inspected.
- [x] Current event ownership/authorization and existing Organization/Community boundaries documented.
- [x] Files likely to change, protected boundaries, migration risks, dependencies, and proposed sequence recorded.
- [x] No schema or application changes were made during the Phase 0 audit checkpoint.
- [x] The Phase 0 review gate was satisfied; Phases 1–14 were subsequently approved and completed. Phase 15 and later remain outside the current authorization.

## 13. Phase 4 implementation result

Phase 4 was authorized separately and completed without changing Event ownership or starting Phase 5.

- Backfill policy: `createdBy → OWNER`; legacy `managers[] → MANAGER`.
- Role capabilities: `OWNER`/`ADMIN` edit Organization profiles and administer membership; `MANAGER` retains profile/affiliation editing only; `EDITOR`, `EVENT_MANAGER`, and `MEMBER` are read-only. Platform-wide admin profile access remains compatible; Super Admin-only manager assignment and verification controls remain restricted.
- Lifecycle compatibility: missing verification state maps from legacy `isVerified`; missing overall status maps to `APPROVED`; missing ownership status maps to `PERSONAL`. Legacy aliases remain synchronized.
- Added an idempotent, dry-run-by-default script: from `backend/`, run `npm run org:phase4:dry-run`; applying requires the explicit `npm run org:phase4:apply` command after reviewing counts and confirming a backup. No production migration was run during this implementation.
- Added owner/admin member roster, role assignment, invitation, acceptance/decline, and revocation APIs with backend authorization; the organization profile exposes matching controls and invite acceptance. These controls cannot grant `OWNER` or `MANAGER`; `MANAGER` remains Super Admin-only.
- Targeted validation: organization profile/discovery API tests, Phase 4 lifecycle/RBAC API tests, Organization foundation schema tests, frontend TypeScript check, backend syntax checks, and `git diff --check` passed. No full application build or broad regression suite was run.

## 14. Phase 5 implementation result

Phase 5 was authorized separately. At that checkpoint Phase 6 and later were out of scope; Phase 6 was later authorized and completed in §15. Phase 7 was not authorized at the Phase 5 checkpoint; it was authorized subsequently and is recorded in §16. Phase 8 and later were unapproved at the Phase 5 checkpoint.

- Added explicit Event ownership (`organizerType` / `organizerId`) and reversible archive metadata while preserving `_id`, `slug`/public URLs, `createdBy`, `organization`, and `community`. The new owner fields and archive/moderation provenance are protected from ordinary update mass assignment.
- Legacy migration mapping follows the confirmed decision: Events with `createdBy` become USER-owned by that creator; Events without `createdBy` become PLATFORM-owned/admin-only. Existing organization/community references remain associations and never imply owner control. Organization ownership is explicit on new Events; any legacy reassignment needs a reviewed allowlist.
- Added a dry-run-by-default Phase 5 owner backfill/reporting command (`cd backend && npm run event:phase5:dry-run`); applying requires the separate command plus confirmation token (`npm run event:phase5:apply -- --confirm=EVENT_OWNER_BACKFILL_V1`). The in-memory test covers the backfill cohort and linked registration/ticket/post reporting. **No real database was connected to, and no production migration was run.**
- Centralized Event-manager authorization for REST and Socket.IO on the same owner policy. Active Organization `EVENT_MANAGER` members may create and operate explicitly Organization-owned Events (including registration, ticket/check-in, activity, live controls, and Event analytics). They cannot operate USER-owned Events or administer Organization profiles/memberships. `OWNER`/`ADMIN` retain full Organization control; `MANAGER` remains profile/affiliation-only. Archive is reversible and does not imply hard deletion or moderation removal.
- Added Organization-scoped Event management/create/edit/archive UI and exact-Event-scoped operational access; owner selection is explicit. Public Event projections do not expose the new owner fields. Existing IDs and public slugs remain the route keys.
- Focused validation on the final implementation: `npm run test:event-owner-rbac` passed; `npm run test:organization-rbac`, `npm run test:mgmt`, and `npm run test:phase3` passed; `npm run test:live` passed with **68 checks**, including Organization Event Manager Socket.IO control and denial for a USER-owned Event with an Organization association. Frontend `npm run check:syntax` (198 files) and `npx tsc --noEmit` passed. Selected backend `node --check` checks and `git diff --check` passed. No full build/browser test or broad regression suite was run.
- `npm ci` reported existing dependency advisories (backend: 18; frontend: 15). No audit-fix command was applied as part of this scope.

## 15. Phase 6 implementation result

Phase 6 was explicitly authorized and completed. At the Phase 6 checkpoint Phase 7 and later were unapproved and not started; Phase 7 was authorized later and is recorded in §16. Phase 8 and later were unapproved at the Phase 6 checkpoint.

- Added nullable Event-owned `logoUrl` and internal `logoPublicId` fields. Existing Events with no logo remain valid without a data backfill; no association-based logo inference or real-database migration was performed. Event owner fields, `_id`, public slug/URL, and the separation between ownership and `organization`/`community` associations are unchanged.
- Added a separate Event-logo upload, replace, and remove API path using the existing storage-provider abstraction and the existing `logo` responsive/compression preset. The route enforces the Phase 5 Event-manager policy, validates a canonical square crop server-side, attaches the new asset, invalidates public Event caches, and retires the old asset. Event creation/update cannot mass-assign logo URLs or provider IDs. Existing poster/banner upload route and its 16:10 crop remain unchanged; hard deletion also retires tracked banner/logo assets.
- EventForm now has an independent square logo crop state, optional logo preview, replace/remove controls, and delayed upload after Event persistence. Public Event cards and the Event detail heading render the Event-owned logo; legacy/no-logo Events use a neutral calendar fallback and do not borrow an Organization or Community logo. Relevant Event-card projections include `logoUrl`; public detail/list projections exclude internal provider IDs.
- Resolved the in-scope §7 lifecycle findings: Organization logo/cover uploads are confirmed attached only after the profile write; the profile uploader uses the correct `organizers` / `posters` folders, with `organizations` retained as a mapped compatibility alias. `/upload/attach` now checks that the caller owns the pending/active asset and can return a retryable failure. The local storage provider safely removes files contained under its configured root.
- Focused validation passed: `cd backend && npm run test:event-logo`; `npm run test:event-owner-rbac`; `npm run test:phase3` (**44 passed, 0 failed**); and `npm run test:organization-profile`. Frontend `npm run check:syntax` parsed **199 files**, `npx tsc --noEmit`, selected backend `node --check` checks, and `git diff --check` passed. Tests use an in-memory MongoDB only; **no real database was connected and no migration was run**. No full frontend build or browser test was run. No Phase 7 work was started.
- `npm ci` reported existing dependency advisories (backend: 18; frontend: 15). No audit-fix command was applied.

## 16. Phase 7 implementation result

Phase 7 was explicitly authorized with an email-derived Super Admin identity and backend-only communication controls. At that checkpoint Phase 8 and later were out of scope; Phase 8 was authorized subsequently and is recorded in §17, and Phase 9 in §18.

- Super Admin remains derived exclusively from the centralized `ownership.service.js` `SUPER_ADMIN_EMAIL` rule. No `SUPER_ADMIN` database role/field, schema change, migration, or real-database operation was added. Authenticated `/auth/me`, password login, and Google OAuth exchange expose a computed `isSuperAdmin` UI hint; it is not persisted on the User document.
- Removed the frontend hard-coded owner email. A shared UI helper consumes only the server-provided hint. Login/OAuth redirects, account navigation, platform-admin controls, the `/admin` shell, claims, Organization, and Community controls now reflect the canonical identity. The `/admin` shell fetches `/auth/me`; all actual actions remain protected by backend route/controller authorization. Browser/local-storage checks remain presentation behavior only.
- Audited existing outbound Event communications and reinforced backend controls:
  - Selected-user RSVP and verification sends use `requireEventManager` plus controller-level owner-aware `canManageEvent` checks; direct recipient IDs are validated, deduplicated, capped at 500, and RSVP CTA URLs reject non-HTTP(S) schemes. These sends use the existing Event rate-limit bucket.
  - The all-users Event announcement remains platform-admin-only (`requireAdmin` plus controller-level `isPlatformEventAdmin`) and is rate-limited; Event-scoped access cannot broaden this recipient audience.
  - Ticket send/approval actions retain owner-aware controller checks; mixed-event approval batches authorize every Event before any message is sent, and the routes now use the existing Event limiter alongside idempotency where already configured.
  - Socket.IO organizer announcements remain guarded by the shared `canManageEvent` policy after the organizer command guard; no frontend permission state is trusted by the socket server.
- No mail delivery ledger/history or mail UI was added. Existing communication behavior and transactional mail infrastructure remain in place.
- Focused validation passed: `cd backend && npm run test:event-owner-rbac` (including Super Admin `/auth/me`/admin access, RSVP and ticket send allow/deny cases, safe-link and recipient checks, and platform-wide broadcast controls); `cd backend && npm run test:live` (**68 passed, 0 failed**, including Socket.IO organizer authorization/denial and announcement delivery); frontend `npm run check:syntax` (**199 files parsed**); frontend `npx tsc --noEmit`; selected changed-backend `node --check` checks; and `git diff --check`. The API tests used in-memory MongoDB and a stubbed email sender. No real database was connected and no migration was run. No full build or broad regression suite was run.
- Dependency installs reported advisories (backend: 18; frontend: 15); no audit-fix command was applied.

## 17. Phase 8 implementation result

Phase 8 was explicitly authorized after Phase 7. Its communications UI, history, and retention work is complete.

- Added authenticated platform-wide and Event-scoped custom subject/body composers plus expandable, paginated campaign and recipient history. History keeps a per-recipient email/status snapshot and campaign metadata; message bodies are not stored.
- Added the admin endpoints `GET /communications`, `GET /communications/:communicationId/deliveries`, and `POST /communications/platform`; and the Event endpoints `GET /:id/communications`, `GET /:id/communications/:communicationId/deliveries`, and `POST /:id/communications`. Backend role/ownership checks remain authoritative. Event sends recheck that selected users are registered for the Event and cap recipients at 500. Sends are rate-limited to five per actor per 15 minutes; existing RSVP/Event announcement sends are also tracked.
- Added explicit 90-day communication cleanup, dry-run by default. Preview with `node scripts/retention-sweeper.js --section=communications`; applying requires `--apply` and separate authorization. No real database cleanup was run.
- Focused backend communications/Phase 8 tests, frontend syntax parsing, TypeScript checking, and the then-current `git diff --check` passed. Tests stub email delivery. **No real email was sent, no real database was connected, and no migration or cleanup was applied.**

## 18. Phase 9 implementation result

Phase 9 was explicitly authorized after Phase 8 and is complete, including browser/device verification. At that checkpoint Phase 10 was not yet approved; it was authorized subsequently and is recorded in §19. Phases 11 and later were unapproved at the Phase 9 checkpoint; Phases 11–14 were later authorized and are recorded in §§20–23, while Phase 15 and later remain unapproved.

- Preserved the earlier mobile-first work: touch targets, mobile input sizing, filter wrapping, horizontal tab behavior, scrollable forms/dialogs, and narrow-screen Event registration summaries across feed/Explore, Events, Organizations/Communities, messaging, and admin communications.
- Browser diagnostics used the *visual/layout viewport*, not `window.innerWidth` alone. On `/communities` at a 320px device viewport, the long directory card had expanded the layout viewport: `window.innerWidth` and document scroll width were 472px while `documentElement.clientWidth` and `visualViewport.width` were 320px. Constraining the directory grid/card with `min-w-0` removes the min-content expansion; the Create Community dialog is now centered and within the viewport (320px: left 16/right 304; 360px: 16/344; 390px: 16/374).
- At 768px, the Event admin tab bar's `sm:w-fit` made the scroller 794px wide and the document 818px wide. Constraining that tab bar to `w-full max-w-full` keeps it internally scrollable without expanding the document. The admin mobile navigation is likewise explicitly bounded. The Community detail post composer now has a 44px minimum height; the separate message-thread composer retains its 44px minimum.
- Playwright Chromium checks passed on the production build for **12 routes × 4 viewport widths** (320, 360, 390, and 768px): `/events`, `/explore`, `/organizations`, `/organizations/qa-org`, `/communities`, `/communities/qa-community`, `/messages`, `/messages/qa-thread`, `/admin/events`, `/admin/events/qa-event/registrations`, `/admin/events/qa-event/communications`, and `/admin/communications`. No document-level horizontal overflow remained; visible main `input`/`select`/`textarea` controls were at least 44px tall, and mobile text inputs used at least 16px type. Community-create dialogs fit at each mobile width; the 320px Organization-edit dialog fit horizontally and kept its long form vertically scrollable (about 1,903px content in a 729px scroll area). Expanded recipient-level history on both platform and Event communications pages also fit at all four widths.
- All browser API traffic was intercepted and fulfilled with test fixtures; no production backend was called. `NEXT_PUBLIC_API_URL` pointed at a deliberately unused local test port during the build, so sitemap generation logged a nonfatal connection-refused message; the production build still exited successfully. Build validation ran the prebuild parser (**202 files**), Next.js compilation, lint/type checks, and generation of **37 static pages**. `git diff --check` passed.
- No real email was sent, no real database was connected, and no migration or production database operation was performed during Phase 9.

## 19. Phase 10 implementation result

Phase 10 (performance, pagination, and index optimization) was explicitly authorized after Phase 9 and is complete. Phases 11 and later were unapproved at the Phase 10 checkpoint; Phases 11–14 were later authorized and are recorded in §§20–23, while Phase 15 and later remain unapproved. Changes were kept to bounded list reads, cursor support, batched Event statistics, and guarded additive indexes; existing authorization checks and explicit-page response contracts remain in place.

- Added shared cursor helpers for opaque `(sort value, _id)` keysets, ascending and descending sort order, bounded limits, malformed-cursor fallback, and over-fetch-by-one `hasMore` detection. Public Events, Communities, Notifications, admin Event lists/statistics, Organization-managed Events, platform/Event communication history, and recipient delivery history now have cursor paths. Explicit `page` requests retain each endpoint's previous response shape and metadata (including totals where previously returned); cursor paths omit total-count work while preserving separate counts such as the notification unread badge. Frontend list consumers now retain the cursor and load the next page rather than increasing offsets. The sitemap walks bounded cursor pages (up to 1,000 Event URLs).
- Added endpoint-appropriate projections, deterministic tie-break sorts, and request-size caps. Existing endpoint filters and security gates remain authoritative; the cursor is only a pagination mechanism, not an authorization token.
- Replaced per-Event ticket/registration-stat reads on the admin Event list with two batched aggregation queries for each requested page. Cursor reads over-fetch one row and do not run `countDocuments`; explicit-page compatibility still performs the total count needed for its legacy metadata.
- Added 13 candidate compound indexes for the measured list shapes (Event discovery/admin/owner/stat lists; Community directory; private Notification inbox; communication and delivery history; Event registrations; messages). Kept them out of Mongoose schema declarations because ordinary app startup enables automatic index management. The standalone migration defaults to a dry-run plan; applying is blocked unless `--apply`, the exact confirmation token, and `PHASE10_ALLOW_INDEX_APPLY=1` are all supplied. It is not imported by server startup. **No migration, dry-run against a real database, or production index change was performed.**
- Added `npm run test:performance-phase10` and an isolated in-memory regression test: 60 checks passed, including legacy-page compatibility, cursor ordering/completeness, authorization, batched statistics, the no-count cursor path, and 12 bounded MongoDB `explain("executionStats")` checks. All 12 used the planned index without a blocking `SORT`, with examined keys/documents bounded by the requested page size. Those indexes were applied only to that test's in-memory database.
- Test email delivery is stubbed in the community E2E so successful-delivery accounting can be tested without a provider or real email. The first parallel E2E attempt hit MongoMemoryServer's disk-space preflight in two suites; rerunning serially passed `npm run test:communications` and `npm run test:event-owner-rbac`. The community E2E then passed all 38 checks, including `notify-all`. `npm run test:phase3` passed all 44 checks. Frontend syntax parsing passed for 202 files and `npx tsc --noEmit` passed. Backend syntax checks passed for the changed Phase 10 files.
- No production database was connected, no database migration or index was applied, and no real email was sent. No separate Phase 10 production build, browser pass, or broad all-phases suite was run; validation stayed focused. No Phase 11+ work was undertaken or authorized at that Phase 10 checkpoint.

## 20. Phase 11 implementation result

Phase 11 (direct-API security tests) was explicitly authorized after Phase 10 and is complete. At the Phase 11 checkpoint, Phase 12 was not yet authorized; it was authorized subsequently and is recorded in §21, Phase 13 in §22, and Phase 14 in §23. Phase 15 and later remain unapproved. Phase 11 used only an in-memory MongoDB instance and a stubbed email sender; no production database, migration, or real email was used.

- Added `backend/tests/phase11-direct-api-security.e2e.js` and the non-conflicting `npm run test:phase11-security` script (the existing `test:phase11` remains the unrelated legacy Part 7 check). The suite has 28 focused checks across anonymous, unrelated authenticated, registered-attendee, and Event-manager callers. It exercises direct REST resource IDs and the Socket.IO display-mode join rather than depending on frontend visibility.
- The tests reproduced private-Event data leaks through the participant roster, quiz list/detail/leaderboard/answer APIs, live-state and eligibility APIs, Event results, and the Socket.IO display join. Added a shared `canAccessPrivateEvent` permission helper and narrow endpoint guards. Private participant identities remain manager-only; registered attendees retain quiz/live/results access without seeing quiz answer keys; managers retain their existing access. Public participant previews and public quiz access remain available.
- The added security suite passed **28/28** checks. Focused compatibility validation also passed: `node tests/quiz.e2e.js` (**32 checks**), `node tests/live.e2e.js` (**68 passed, 0 failed**), and `node tests/event-owner-rbac.e2e.js`. Changed backend files passed `node --check`. At that checkpoint no Phase 12 Event-model regression pass or broad all-phases suite was run; the Phase 12 pass is now recorded in §21.

## 21. Phase 12 implementation result

Phase 12 (full Event-model regression pass) was explicitly authorized after Phase 11 and is complete. At the Phase 12 checkpoint Phase 13 was not yet authorized; it was authorized subsequently and is recorded in §22, and Phase 14 in §23. Phase 15 and later remain unapproved. This pass used only in-memory validation and existing in-memory MongoDB suites; no production database, migration, or real email was used.

- Added `backend/tests/phase12-event-regression.selftest.js` with **27 checks** covering:
  - Schema compatibility and defaults: title-derived slug, public visibility default, `PUBLISHED` live-state default, nullable `logoUrl`/`logoPublicId`, archive null defaults, six-character `joinCode` display-code format, `liveSettings` defaults, USER ownership coexisting with `organization`/`community` associations, offline validation clearing online credentials, legacy creator-owned compatibility, online link validation, visibility and `organizerType` enum guards.
  - Date virtuals, join-code method, and index invariants: `status`/`isLive` separation from operational `liveState`, regeneration preserves format, exactly one unique slug index and one unique `joinCode` index.
  - Public Event projection contract: preserves slug/title/optional logo/host associations and short `joinCode` for the read-only projector; strips `meetingId`, `passcode`, `checkIns`, provider IDs, provenance, owner, archive, ticket, and WhatsApp fields; synthesizes null logo for legacy Events; additionally strips `onlineEventLink`, `recordingLink`, and `materials` for private Events.
- Clarified `backend/repositories/event.repository.js` documentation: the public projection deliberately includes the short `joinCode` as a display/lookup hint (not an authorization credential); meeting credentials, attendee check-ins, and ticket settings never reach the cache. Authorization remains enforced by REST and Socket.IO.
- Added non-conflicting scripts `test:phase12-event-model` and `test:phase12-event-regression` (distinct from the legacy Part 7 `test:phase12` selftest). The regression script aggregates the Event-model selftest plus `event-owner-rbac`, `event-logo`, `live`, `quiz`, `phase11-security`, `performance-phase10`, `communications`, `community`, `organization-rbac`, `organization-profile`, `phase3`, `phase6`, and `phase11` selftests.
- Focused validation passed: `phase12-event-regression.selftest.js` **27/27**; `npm run test:event-owner-rbac`; `npm run test:event-logo`; `npm run test:live` **68 passed, 0 failed**; `npm run test:quiz` **32 checks**; `npm run test:phase11-security` **28/28**; `npm run test:performance-phase10` **60 checks**; `npm run test:communications`; `npm run test:community` **38 checks**; `npm run test:organization-rbac`; `npm run test:organization-profile`; `npm run test:phase3` **44 passed, 0 failed**; `npm run test:phase6` **87 passed, 0 failed**; `npm run test:phase11` (Part 7 phase 1) **73 passed, 0 failed**. Changed backend files passed `node --check` and `git diff --check` passed. No production database was connected, no migration or index was applied, and no real email was sent.

## 22. Phase 13 implementation result

Phase 13 (auth hardening & fuzzing, Part 7 Phase 6) was explicitly authorized after Phase 12 and is complete. At the Phase 13 checkpoint Phase 14 was not yet authorized; it was authorized subsequently and is recorded in §23. Phase 15 and later remain unapproved. This pass used only an in-memory MongoDB instance and a stubbed email sender; no production database, migration, or real email was used.

- **Scope**: the existing `backend/tests/phase13.selftest.js` covers §14 auth hardening, §15 token security, §16 API fuzzing (malformed ObjectIds, hostile bodies, content-type, oversized payload, prototype pollution, pagination cursors), §17 authz matrix (seven roles against real Events/Communities/Organizations/admin surfaces), and §30 canonical error taxonomy (ten codes, legacy aliases, no invented codes).
- **Failures found and fixed**:
  - §17 owner-scoped edit: `PUT /api/events/:id` now uses `requireEventManager`/`canManageEvent` (Phase 5+), so the owning ORGANIZER can edit their own Event while cross-owner edits remain 403. Updated the Phase 13 selftest expectation from blanket admin-only to owner-scoped.
  - §30 error shape: `GET /api/events/not-an-object-id` and all `requireAuth`/`requireAdmin`/`requireEventManager`/`requireSuperAdmin` guards now return `{ success:false, message, error:{ code, message } }` with canonical codes (`AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`). Final 404 handler in `server.js` also returns `NOT_FOUND`. This satisfies the taxonomy test that every 4xx carries a canonical code.
- **Compatibility**: error responses keep top-level `message` for existing frontend toasts; new `error.code` is additive. Owner-scoped Event edits were already validated by `event-owner-rbac` and `live` suites.
- **Focused validation passed**: `npm run test:phase13` **54 passed, 0 failed** (auth model, 84 malformed ObjectId probes, 84 hostile-body probes, content-type, malformed JSON 400, oversized 413, cursor handling, prototype pollution guard, 7-role authz matrix, brute-force throttling with Retry-After and no credential/JWT logging, and full error taxonomy with 10 canonical codes). Prior regression also still passes: `test:phase12-event-regression` (27/27 + event-owner-rbac + event-logo + live 68 + quiz 32 + phase11-security 28/28 + performance 60 + communications + community 38 + organization-rbac + organization-profile + phase3 44 + phase6 87 + phase11 73).

## 23. Phase 14 implementation result

Phase 14 (scale, realtime readiness & restore/secret separation) was explicitly authorized after Phase 13 and is complete. Phase 15 and later remain unapproved. This pass used only in-memory MongoDB instances and stubbed email; no production database, migration, or real email was used.

- **Scope**: combines the two remaining Part 7 suites:
  - `backend/tests/part7-scale.selftest.js` — Part 7 Phase 9 (§20, §21, §22): load profiles A–H runnable, p50/p95/p99 and bounded reservoir, 500-client live harness, two independent instances on separate ports sharing one MongoDB proving A writes → B reads and token portability, no process-local mutable state, rate-limit pluggable backend, distributed locks, and Socket.IO Redis adapter NOT deployed with documented trigger.
  - `backend/tests/part7-recovery.selftest.js` — Part 7 Phase 12 (§18, §19): restore verifier exists, refuses without --target, performs no writes, checks missing collections, orphaned refs, required fields, lost indexes, freshness, completeness, and reports WHY; secret scanner exists, redacts values, detects .env, service-role keys, Mongo/Redis URIs with creds, Stripe keys, PEM keys, never prints secrets, test fixtures not flagged, .env git-ignored, docs cover encryption-at-rest and backup exclusion, and `scan-secrets`/`verify-restore` scripts registered.

- **Failure found and fixed**:
  - §19 secret scan: `GENERIC_ASSIGNED_SECRET` flagged two e2e files where `JWT_SECRET` was assigned a 32–34 char literal containing only weak fixture tokens (`test`, `secret`), long enough to be scored as generated. Changed both to values containing the strong fixture tokens `example`/`placeholder` (e.g. `organization-profile-example-secret` and `phase11-example-secret-placeholder`), so `looksLikeTestValue` correctly classifies them as fixtures. `npm run scan-secrets` now reports clean.

- **Focused validation passed**:
  - `npm run test:scale` — **44 passed, 0 failed** (§20 23 checks, §21 13 checks including two-process A→B/B→A auth, §22 8 checks)
  - `npm run test:recovery` — **36 passed, 0 failed** (§18 15 checks, §19 21 checks, including repository scans clean)
  - `npm run scan-secrets` — clean
  - Prior phases still pass: `test:phase13` 54/54, `test:phase12-event-regression` (27/27 + event-owner-rbac + event-logo + live 68 + quiz 32 + phase11-security 28/28 + performance 60 + communications + community 38 + organization-rbac + organization-profile + phase3 44 + phase6 87 + phase11 73)

