# Onboarding & Trust & Safety — Repository Audit (2026-10-10)

## 1. Repository Structure
- Branch: main, many uncommitted changes from org-registration work (modified backend/frontend, new models). Must preserve.
- Backend: Express, Mongoose, JWT, Socket.IO, Redis/Upstash optional, Cloudinary upload, Nodemailer stub.
- Frontend: Next.js 15.5.9, App Router, Tailwind, shadcn ui, axios api client.

## 2. Authentication
- `auth.controller.js`: signup/login with email/password, Google OAuth via `google.routes.js`, JWT `purpose: auth`, refresh? Check: token expires 1h, no refresh token rotation yet.
- `auth.middleware.js`: requireAuth checks suspendedAt, blocks suspended accounts. No ban, no temp suspension expiry, no feature restrictions.
- No session revocation list, no refresh token model.
- Super admin via `SUPER_ADMIN_EMAIL` env, checked via `ownership.service`.

## 3. User Schema
- Fields: firstName, lastName, email unique, passwordHash, role user/admin, suspendedAt, suspensionReason, username unique sparse, verified, points, socialSettings (profileVisibility public/followers/private, allowMessagesFrom, showAttendance/Achievements), lastSeenAt, emailVerified, oauthProviders, profile (institution string, course, year, avatar, coverImage, coverPosition, avatarCrop/coverCrop, avatarVersion/coverVersion, bio 280, location, website, interests array, notificationPrefs), pastEvents, pastTickets.
- Missing: usernameLastChangedAt, ageConfirmed, ageConfirmedAt, onboardingVersion, onboardingCompletedAt, institution as Organization ref, interests as stable IDs, onboarding metadata.
- Username regex: /^[a-z0-9_]{3,30}$/, reserved list in controller, but no cooldown, no case-only bypass prevention, no concurrent safe handling beyond unique index.

## 4. User Settings / Onboarding
- `/user/settings` page: identity, appearance, privacy (profileVisibility, allowMessagesFrom, showAttendance/Achievements), notifications mutes, account email + registrations + org requests + logout.
- No dedicated onboarding flow, no progressive onboarding, no age confirmation, no college selector from approved orgs, no interest chips with stable IDs, no banner+avatar combined screen, no bio optional screen.
- `user.controller.js` updateMySocial: handles username, bio, avatar, cover, location, interests (max 10), socialSettings. No cooldown, no age, no institution ref.

## 5. Privacy, Blocking, Reporting
- Privacy: `canViewContent` checks socialSettings.profileVisibility, self or accepted follow. Used in getPublicProfile, getUserPosts, getUserMedia, getUserEvents. Not enforced in feed queries? Need audit: `post.repository.js`, `search.controller.js`, feed.
- Blocking: `block.model.js` with blocker/blocked unique, removes follow edges. Enforced in some places? Check follow, messages, search.
- Reporting: `report.model.js` basic: reporter, targetType post/comment/event/user, targetUser, snapshot, reason enum spam/harassment/inappropriate/misinformation/other, status open/dismissed/actioned. Unique per reporter per target. No moderation case, no enforcement action, no audit.
- No content blocking/quarantine states.

## 6. Posts, Comments, Messages, Events, Uploads
- Posts: `post.model.js` has status published/draft/deleted, archivedAt, author, content, images, event, organization, community. No moderation status.
- Comments: similar.
- Messages: `message.model.js`, conversation model, dm-realtime.service with throttling.
- Events: `event.model.js` has title, description, bannerUrl, etc. No moderation.
- MediaAsset: `mediaAsset.model.js` tracks uploads, ownership, attachedTo.
- Uploads: `upload.routes.js` uses Cloudinary, validates size, type, actual format via magic? Need check. No moderation pipeline.
- No text moderation, no image moderation.

## 7. MediaAsset & Storage
- Cloudinary provider, `storage.provider.js`, `media.service.js` handles upload, attach, sweep.
- Ownership via attachedTo field.

## 8. Middleware, Socket.IO, Rate Limits
- `rate-limits.js`: domains AUTH, SOCIAL, MESSAGING, SEARCH, EVENT, COMMUNICATION, UPLOAD_BURST/HOURLY, READ, REALTIME_CONNECT_USER/IP, REALTIME_JOIN/ANSWER/TYPING, GUARD_FOLLOW_TOGGLE etc. Uses SlidingWindowStore with Redis backend if enabled.
- `idempotency` middleware exists.
- `realtime.service.js`: socket auth via JWT, checks suspended? Need to verify.
- No IP ban, no abuse signals persistence.

## 9. Redis/Upstash, Cache, Jobs
- `cache.service.js` with invalidatePrefix.
- No background job queue (Bull etc), but has outbox pattern? `outbox.model.js`.
- No moderation job infrastructure.

## 10. Super Admin
- Admin layout nav: Overview, Events, Communications, Create Event, Communities, Org Requests, Users, Claims, Moderation, Infrastructure.
- Moderation page exists but basic.
- No Trust & Safety dashboard.

## 11. Existing Tests
- `organization-registration.e2e.js`, `organization-rbac`, `organization-profile`, `phase13.selftest` (auth & fuzzing), `phase8`, `social.e2e`, `community.e2e`, etc.
- No onboarding tests, no privacy exhaustive tests, no moderation/enforcement tests.

## 12. Moderation Dependencies
- No external moderation provider integrated. Need to implement configurable provider with fallback, plus local text rules.

## Implementation Plan (File-level)

### Existing to reuse:
- `user.model.js` username uniqueness, socialSettings privacy, profile avatar/cover.
- `report.model.js` as base for ContentReport.
- `block.model.js` blocking.
- `auditLog.model.js` for audit.
- `mediaAsset.model.js` ownership.
- `rate-limits.js` infrastructure.
- `auth.middleware.js` suspended check pattern.
- `ownership.service` super admin check.
- `notification.service` for user-facing messages.
- `upload.routes` Cloudinary.

### Missing:
- Onboarding state: usernameLastChangedAt, ageConfirmed, ageConfirmedAt, onboardingVersion, onboardingCompletedAt, institution as Organization ref, interests stable IDs, bio longer? etc.
- Username cooldown enforcement.
- Age confirmation endpoint.
- Progressive onboarding status API.
- Institution selector from approved orgs.
- Interest taxonomy.
- ContentReport extended, ModerationCase, EnforcementAction, IpRestriction models.
- Moderation pipeline: text moderation (prohibited terms, spam detection, context), image moderation (provider abstraction with local fallback).
- EnforcementService: warnings, restrictions, suspensions (temp with expiry), bans, session revocation, IP restrictions.
- Trust & Safety dashboard frontend + backend.
- Privacy enforcement audit across feed, search, posts, comments, messages, events, communities, orgs, realtime, notifications.
- Session revocation: token blacklist or versioning.
- Abuse signals: Redis counters for signup, login failures, bulk posting, report spam.

### Models to create/modify:
- Modify `user.model.js`: add usernameLastChangedAt, ageConfirmed, ageConfirmedAt, onboardingVersion, onboardingCompletedAt, onboardingSteps, institutionOrgId (ref Organization), interestsV2 (stable IDs), bio longer? keep 280 but allow, profile banner/avatar already.
- New `contentReport.model.js` OR extend `report.model.js` to ContentReport with more fields: contentType, reason/category, details, status, submission timestamp, resolution metadata, reporter, reported user/content ref, duplicate prevention.
- New `moderationCase.model.js`: related reports, content refs, severity, priority, assigned reviewer, status, internal notes, decision history, user-facing decision.
- New `enforcementAction.model.js`: target user/content, action type (warning, content_removal, posting_restriction, comment_restriction, messaging_restriction, event_creation_restriction, temporary_suspension, permanent_ban, temporary_network_restriction, reversal), reason, policy category, actor, start/expiry, related case, status, appeal, reversal, timestamps, unique constraints for active actions.
- New `ipRestriction.model.js`: ip/network, reason, source, expiry, active, actor, review status.
- New `moderationAuditLog.model.js` OR reuse auditLog with more actions.
- Extend `post.model.js`, `comment.model.js`, `user.model.js`, `event.model.js` with moderationStatus: pending/approved/quarantined/removed.

### Services:
- `onboarding.service.js`: get status, complete step, validate username with cooldown, age confirmation, privacy, avatar/banner, bio, institution, interests.
- `username.service.js`: normalization, reserved, availability, cooldown check, concurrent safe.
- `moderation.service.js`: text moderation (prohibited terms configurable, spam detection, context), image moderation provider abstraction, confidence thresholds, quarantine logic, case creation.
- `enforcement.service.js`: progressive enforcement, warnings, restrictions, suspensions with expiry, bans, session revocation, IP restrictions, audit, retry-safe.
- `abuse.service.js`: Redis counters, abuse signals, IP restrictions.
- `session.service.js`: token versioning or blacklist, revocation.

### API Contracts:
Onboarding:
- GET /api/onboarding/status — returns required/optional steps, completed, user profile.
- POST /api/onboarding/username — set/change username with cooldown.
- POST /api/onboarding/age-confirm — age confirmation.
- PUT /api/onboarding/privacy — public/private.
- POST /api/onboarding/media — avatar/banner (reuse upload).
- PUT /api/onboarding/bio — bio.
- PUT /api/onboarding/institution — select approved org.
- PUT /api/onboarding/interests — interests.
- POST /api/onboarding/complete — mark completed.
- GET /api/users/check-username?username= — availability (privacy-preserving).

Privacy:
- GET /api/users/:id/profile already privacy-enforced, need audit feed, search, posts, etc.
- POST /api/follow/requests etc.

Reports/Moderation:
- POST /api/reports — submit report.
- GET /api/reports/mine — user-facing status.
- GET /api/admin/moderation/reports — super admin list.
- GET /api/admin/moderation/cases, POST /api/admin/moderation/cases/:id/resolve, etc.
- POST /api/admin/moderation/content/:id/hide/remove/restore.
- POST /api/admin/moderation/enforcement/*

Account enforcement:
- POST /api/admin/moderation/users/:id/warn, restrict, suspend, ban, unban, etc.
- POST /api/admin/moderation/ip/restrict, etc.
- DELETE /api/users/me — account deletion workflow.

### Security & Privacy Implications:
- Username availability must not leak private user info — return generic taken/available, no enumeration of emails.
- Age confirmation: don't store DOB unless required, just boolean + timestamp, don't treat checkbox as ID proof.
- Privacy: backend enforcement across all paths, including Socket.IO, search, feed, recommendations, previews.
- Moderation: don't publish pending content, quarantine, confidence thresholds, human review for ambiguous.
- Enforcement: session revocation via token version bump, Socket.IO disconnect, audit logs, no auto permanent ban from report volume.
- IP: don't trust X-Forwarded-For blindly, use trust proxy, temporary not permanent, consider shared networks.
- No invasive device tracking.

### Test Coverage:
- Onboarding: new/existing users, skip optional, avatar/banner, preserve values, concurrent username, 14-day cooldown, case-only bypass, age bypass, status consistency across sessions.
- Privacy: public/private visibility, pending follow not grant, approved grant, blocked across APIs, search/feed/recommendations respect, private media not retrievable, Socket.IO no leak, privacy change effect.
- Moderation: report submit, spam/duplicate control, text categories, ambiguous handling, media quarantine, provider failure fallback, pending not published, retries no duplicate, reviewer resolve/restore, private notes protected.
- Enforcement: warnings/restrictions, temp suspension blocks, expiry, permanent ban blocks, refresh/session handling, Socket.IO bypass prevention, multiple violations policy, report volume not trigger ban, reversals audited, duplicate prevention, IP expiry/review, shared network.
- Admin auth: ordinary users cannot access moderation APIs, client role ignored, ID manipulation blocked, destructive actions require auth.
- Regression: auth/session, org perms, community, event ownership, registration/tickets, messaging/notifications, upload, realtime, performance/security, responsive.

### Backward Compatibility:
- Add new fields with defaults, preserve existing usernames, don't break legacy users without username — prompt setup.
- Onboarding versioning, keep existing profile values when skip.

### Deployment Dependencies:
- No new infra required, reuse Redis/Upstash if enabled, Cloudinary, Mongo.
- Optional moderation provider env vars: MODERATION_PROVIDER, MODERATION_API_KEY, etc. — implement fallback if unavailable.
- New env: USERNAME_COOLDOWN_DAYS=14, ONBOARDING_VERSION=1.

## Risks:
- Username cooldown could lock existing users if first assignment treated as change — handle first-time separate.
- Privacy enforcement across many paths — need systematic audit.
- Moderation false positives — use confidence thresholds, human review.
- Session revocation needs token versioning — add user.tokenVersion and check in auth middleware.
- IP restrictions could affect shared networks — temporary, reviewable, not permanent default.
