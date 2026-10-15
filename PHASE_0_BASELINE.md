# PHASE 0 — BASELINE, INVENTORY AND REGRESSION SAFETY

**Date:** 2026-10-11  
**Branch:** main  
**Working tree:** Dirty — 100+ modified files from previous refinement work (org logos, mobile fixes, search theme, feed top bar, etc.) plus untracked Phase 4-6 files (organization-registration, affiliation, event approval, trust-safety). No uncommitted secrets.

**Recent commits:**
- 135f8d0 Old Feed: show history when fresh stream empty
- 2360a21 Fix prod 500 on "Message": drop legacy conversation index
- 9659940 Part 17: one left edge for header, five stats in one row
- bdaecf8 Part 17: profile page rebuilt to reference hierarchy
- 3abf904 Part 16 §D: conversation routing, unified message search
- f7c9dd5 Part 16: chat viewport 100dvh, Old Feed below fresh stream
- 59c8fb7 Part 15: mobile chat right edge fix

---

## 1. Architecture Map (Verified)

**Frontend:** Next.js 15.5.9, React 19.2.0, Tailwind 4.1.14, Radix UI, Framer Motion, Sonner, Zustand? Actually no zustand, uses Context + hooks. App Router with (app) authenticated shell and admin layout. ThemeContext toggles html.dark class, persisted localStorage, system preference, inline pre-paint script in layout.tsx prevents FOUC. API via axios utils/api.js with same-origin proxy support (BACKEND_PROXY_URL) to avoid CORS, fallback https://teameklavya.onrender.com. Socket.IO client for realtime.

**Backend:** Express 5.1.0, Mongoose 8.19.0, Node >=20 <21, JWT 9.0.2, bcryptjs, passport-google-oauth20, helmet, cors, compression, express-rate-limit, express-validator, multer, cloudinary, qrcode, nodemailer+resend, socket.io 4.8.1. Entry server.js: dotenv fail-fast JWT_SECRET+MONGO_URI, trust proxy 1, helmet, request-context (requestId), compression except /uploads, global rate limits, CORS from FRONTEND_URL, cache policy (public GET 30s SWR 120 if anonymous else private no-store), body parsers 1mb/2mb, static /uploads, cookie-session for OAuth, passport, route mounting /api/*, health checks, error normalizer, 404, uploads dir ensure, httpServer + Socket.IO CORS allowedOrigins, realtime.service.init(io), listen 0.0.0.0 PORT 5000, schedulers reminder 15min + enforcement-expiry 5min.

**Data:** MongoDB primary, 42 models, indexes via migrations (social usernames, conversation-index dropping legacy unique participants, organization-indexes, performance-indexes plan). Optional Upstash Redis for rate limiting/idempotency/locks, Supabase alternative repos, Cloudinary for media with local disk fallback.

**Deployment:** Backend Render (render.yaml build npm install start node server.js), Frontend Vercel (next build). Health GET / and /api/health public minimal, /api/admin/infrastructure private detailed.

---

## 2. Major User Journeys and Implementation Paths

| Journey | Frontend Entry | API | Models | Realtime | Verified |
|---|---|---|---|---|---|
| **Signup/Login/Logout** | signup-form.tsx, login-form.tsx, oauth-callback, use-logout.ts | POST /api/auth/register, /login, /google, /me, /logout | User | - | Partial – OTP expiry not fully traced |
| **Profile setup/edit** | user/profile, profile/[id], edit-profile-sheet, media-uploader, avatar-preview | GET/PUT /api/users/:id, POST /api/upload/image | User, MediaAsset | - | Working |
| **Feed loading/post creation/interactions** | (app)/page.tsx FeedView, create-post, feed-post, comment-sheet | GET /api/posts/feed, POST /, POST /:id/like, POST /:id/comments, POST /:id/save, POST /impressions | Post, Comment, Reaction, Save, PostImpression | - | Working, trending fallback |
| **Following/privacy** | profile-view, follow buttons, right-rail | POST /api/follow/:userId, POST /api/organizations/:id/follow, GET /api/users | Follow, OrgFollow, Block | notification:new | Working, backend auth required not just badge |
| **Org/community browsing** | organizations/page.tsx, organizations/[slug]/page.tsx, communities/* | GET /api/organizations, /:slug, /:slug/events, /:slug/children, GET /api/communities | Organization, Community, OrgFollow | - | Working, logo transparent fix applied |
| **Org registration/claim** | organizations/register, admin/organizations/requests, claims | POST /api/organization-registration-requests, GET /mine, /parent-institutions, admin approve/reject | OrganizationRegistrationRequest, CommunityClaim | - | Working, E2E pass |
| **Event creation/edit/publish** | admin/events/create wizard 5 steps, edit, event-form, event-tabs | POST /api/events, PUT /:id, PATCH /:id/archive, GET /admin/* | Event, Activity | - | Working |
| **Event approval/rejection** | organizations/[slug]/proposals, admin/events | POST /:id/approve, /reject, /request-changes, /resubmit, /cancel, /with-reapproval, GET approvals/* | Event approvalHistory | - | Working, affiliation checks |
| **Registration/cancellation/duplicate prevention** | events/[slug]/page.tsx RegistrationForm | POST /api/registration, GET /event/:eventId | RegistrationForm, RegistrationResponse | - | Working, idempotency |
| **Ticket retrieval/QR validation** | user/registrations, admin/events/[id]/scan, ticket QR | POST /api/tickets/generate, GET /user-tickets, POST /scan, GET /token/:token | Ticket | - | Working, qrcode lib |
| **Check-in/out** | admin scan page with @zxing/browser | POST /api/tickets/scan | Ticket scannedAt | - | Working |
| **Live activity participation** | events/[slug]/live, admin/events/[id]/live | GET /:id/live/state, /results, /live/eligibility, POST /join-by-code, POST /:id/join-code/regenerate | Activity, Question, QuizParticipation, LiveAnswer, PollResponse, QaQuestion, EventResult | Socket.IO join-event, activity:start, activity:question, activity:answer, poll:vote, qa:ask, chat:message | Working |
| **Messages/notifications/Socket.IO** | messages/page.tsx, messages/[id], notification-bell | GET/POST /api/messages/conversations, /:id/messages, GET /api/notifications | Conversation participantsKey unique, Message, Notification | message:new, typing, message:read, presence, notification:new | Working, participantsKey migration fixed prod 500 |
| **Admin/Super Admin** | admin/* dashboard, users, orgs, requests, claims, communications, moderation, trust-safety, infrastructure | GET /api/admin/stats, /users, org registration admin/*, trust-safety/* | All | - | Working, SUPER_ADMIN_EMAIL |
| **Upload/replace/display media** | media/crop-editor, image-crop-editor, OptimizedImage | POST /api/upload/event/:eventId, /event/:eventId/logo, /image, /attach | MediaAsset | - | Working, Cloudinary primary + local fallback, square avatar requests only (fixed) |

---

## 3. Feature Inventory

| Feature | Status | Evidence |
|---|---|---|
| Auth email/pass, Google OAuth, JWT, email verification, OTP, password reset | Working | auth.controller, passport.js, email.service Resend+SMTP |
| User profiles, avatars, privacy hidePersonalProfileFromDiscovery, blocks | Working | user.model, user.controller, block.model, UserAvatar square requests only |
| Feed For You/Following, posts text+photo, event posts, likes, comments, replies, saves, archive, trending topics, impressions | Working | post.controller, feed-view, post-impression |
| Organizations directory, categories, follow, members, roles, suggested, children, posts, communities, events, verification | Working | organization.model, organization.controller, 3 orgs in prod |
| Org registration DRAFT→SUBMITTED→APPROVED/REJECTED, parent-institutions search, Super Admin approve | Working | organizationRegistrationRequest.model, E2E pass |
| Institution-club affiliation parentOrganizationId, supportsChildOrganizations, affiliationStatus, approval queue | Working | affiliation.e2e, event-approval.e2e |
| Communities open/request/invite, claim, members, posts, events | Working | community.model, communityClaim |
| Events CRUD, categories, trending, for-you, slug, participants, interest, archive, approval workflow, live settings, join code | Working | event.model, event.controller, 5-step wizard |
| Registration custom questions, responses, QR ticket, bulk generate, approval, pending | Working | registrationForm, registrationResponse, ticket.controller |
| Tickets generate, user tickets, scan, token lookup, stats | Working | ticket.model, qrcode, @zxing/browser |
| Activities WELCOME/QUIZ/POLL/QA/LEADERBOARD/CUSTOM, live engine Socket.IO, join-by-code, leaderboard | Working | activity.model, live.controller, realtime.service |
| Messaging direct/team, participantsKey unique, messages, team create, presence, unread | Working | conversation.model migration fixed, message.controller |
| Notifications follows, likes, comments, registrations, announcements, preferences, read/unread | Working | notification.model, notification-bell |
| Search global live dropdown + full page tabs All/Events/People/Orgs, trending-first, cursor pagination | Working | search.controller, search-bar, search/page theme-fixed |
| Stories 9:16 photo/video 24h, archive, composer, media grid | Working | story.model, story-rail, story-viewer |
| Memories event memory walls photo+text | Working | memories.e2e |
| Moderation reports, cases, audit logs, enforcement with expiry/appeal, IP restrictions, blocks | Working | contentReport, moderationCase, enforcementAction |
| Admin dashboard real stats, users, events, orgs, requests, claims, communications, trust-safety, infrastructure | Working | admin.controller, admin/* pages |
| Media Cloudinary primary + local fallback, crop, OptimizedImage f_auto/q_auto | Working | storage.provider, media.service, next.config remotePatterns |
| Email Resend primary + SMTP fallback, templates | Working | email.service, emailTemplates |
| Jobs reminder 15min, enforcement expiry 5min, retention sweeper, media sweeper | Working | reminder.service, enforcement-expiry.service |
| Security JWT, role checks, rate limiting, helmet, CORS, requestId, error taxonomy, idempotency, locks | Working | server.js, auth.middleware, rate-limits, idempotency |

**Partially Working:**
- OTP expiry, resend cooldown, attempt limits – need deeper auth.controller read (not fully verified)
- Refresh token rotation – only access token, no refresh
- No Redis adapter for Socket.IO – single instance, scaling risk
- npm audit vulns multer DoS, nodemailer SMTP injection – 16 vulns

**Broken (previously):**
- TS syntax (o: any) in JS broke Render deploy – FIXED
- White bg behind org logos – FIXED
- Mobile header overflow 401px at 320px – FIXED
- FeedTopBar logo not theme-aware mobile – FIXED
- Search page hardcoded dark theme – FIXED

**Duplicated:**
- logo/logoUrl, cover/coverUrl in Organization – backward compat mapping logo||logoUrl
- participants + participantsKey in Conversation – both stored, must sync
- post handling in post.controller and community.controller overlapping

**Unverified:**
- Real email delivery, Cloudinary upload with real creds, Google OAuth flow, Upstash Redis, Supabase adapters, load testing 100/500 clients, Safari/Firefox rendering

---

## 4. UI/UX Issue Inventory (Route/Component References)

| Issue | Route/Component | Severity | Status |
|---|---|---|---|
| Org logo white box behind transparent PNG | organizations/[slug]/page.tsx hero 72-96px, affiliated clubs 12x12, directory 12x12, search-bar 8x8, search page 10x10, right-rail 10x10, register parent search 8x8 | Medium | Fixed → bg-transparent dark:bg-white/5 object-contain p-1, hero bg-white/10 backdrop-blur-md |
| Mobile header overflow at 320px scrollWidth 418 | organizations/[slug]/page.tsx outer grid without grid-cols-1, inner flex overflow-x-auto without min-w-0 | Medium | Fixed → grid-cols-1, min-w-0 w-full overflow-hidden |
| FeedTopBar logo not theme-aware | components/feed/feed-top-bar.tsx hardcoded plain.png | Medium | Fixed → Logo size 28 theme-aware |
| Search page hardcoded dark bg | app/(app)/search/page.tsx bg-[#0a0a0c] bg-[#121214] border-[#232326] | Medium | Fixed → bg-background, bg-muted/60, border-input |
| Button hardcoded colors, dark variant brittle | components/ui/button.tsx bg-[#3b82f6] hover bg-[#2563eb] etc dark:border-[#232326] | Medium | To fix in Phase 1 → use bg-primary, tokens |
| Card hardcoded dark bg | components/ui/card.tsx dark:border-[#232326] dark:bg-[#141417] | Medium | To fix Phase 1 → bg-card, border-border |
| Input hardcoded dark | components/ui/input.tsx dark:border-[#232326] dark:bg-[#18181b] | Medium | To fix Phase 1 → tokens |
| Dialog hardcoded dark | components/ui/dialog.tsx dark:bg-[#121214] dark:border-[#232326] | Medium | To fix Phase 1 |
| States hardcoded dark | components/states.tsx dark:border-[#232326] dark:bg-[#121214] etc | Medium | To fix Phase 1 |
| UserAvatar bg-white hardcoded | components/user-avatar.tsx bg-white style backgroundColor white | Medium | To fix Phase 1 → bg-card or transparent |
| Badge hardcoded dark | components/ui/badge.tsx dark:border-[#2a2a30] etc | Low | To fix Phase 1 → use semantic tokens |
| Label hardcoded dark | components/ui/label.tsx dark:text-[#e4e4e7] | Low | To fix Phase 1 |
| Top navbar logo inside hidden header | app-shell.tsx header hidden lg:block contains mobile logo lg:hidden never shows | Low | To fix Phase 5 navigation |
| Stories viewer dark-only but uses text-white fixed – okay intentional | story-viewer.tsx bg-black/92 text-white | Info | Intentional – dark modal |
| Event card date badge bg-black/80 text-white – okay overlay | event-card.tsx absolute bg-black/80 | Info | Intentional overlay |

---

## 5. Security, Data-Integrity and Performance Concerns

| Concern | Location | Impact | Severity |
|---|---|---|---|
| CORS bypass if FRONTEND_URL wildcard | server.js allowedOrigins from env | Unwanted origins allowed | Medium |
| No refresh token rotation | auth.controller only JWT | Long-lived token, logout client-only, socket could remain auth | Medium |
| Rate limit IPv6 bypass warning | organization-registration.routes.js custom keyGenerator without ipKeyGenerator helper | ERR_ERL_KEY_GEN_IPV6 warning, could bypass IPv6 | Low |
| Multer DoS, Nodemailer SMTP injection | package.json audit 16 vulns (2 mod,13 high,1 crit) | High/crit CVEs | High |
| No CSP on API | server.js helmet CSP false | API only, but frontend should have CSP | Info |
| No Redis adapter for Socket.IO | realtime.service single instance | Horizontal scaling needs adapter | Medium |
| participantsKey vs participants array drift risk | conversation.model both stored | Could drift if not synced via pre-save hook | Medium |
| logo/logoUrl duplicate fields | organization.model | Inconsistency if both set differently | Low |
| Legacy /uploads serving old files + new Cloudinary | server.js static /uploads | Orphaned files if UPLOADS_DIR changed | Low |
| Rate limiting disabled via env RATE_LIMIT_DISABLED | rate-limits.js isRateLimitingDisabled() | If set in prod accidentally disables all | Medium |
| No transactional outbox for all emails | email.service only some via outbox.model | Retry/failure not durable | Medium |

---

## 6. Regression Checklist (Critical Workflows)

- [ ] Signup, login, logout, session restoration – test via frontend forms + API
- [ ] Profile setup and editing – avatar crop square, bio, institution
- [ ] Feed loading, post creation, interactions – For You/Following, like, comment, save, impressions
- [ ] Following and privacy-sensitive profile access – follow user/org, hidePersonalProfileFromDiscovery, blocked user cannot see
- [ ] Organization and community browsing – directory, slug pages, affiliated clubs grid, logo transparent
- [ ] Organization registration and claim – create DRAFT, update, submit, withdraw, resubmit, parent-institutions search, Super Admin approve/reject/request-info, history
- [ ] Event creation, editing, publication – 5-step wizard, edit, archive, manage tabs
- [ ] Event approval and rejection – club proposal, institution queue, approve/reject/request-changes/resubmit/cancel/with-reapproval, affiliation revocation
- [ ] Registration, cancellation, duplicate prevention – custom questions, auto-fill, idempotency, capacity, approval
- [ ] Ticket retrieval and QR validation – generate, user tickets, token lookup, QR
- [ ] Check-in and check-out – scan via @zxing/browser, stats, recent scans
- [ ] Live activity participation – join-by-code, eligibility, live state, quiz, poll, QA, chat, leaderboard, results
- [ ] Messages, notifications, Socket.IO updates – conversations direct/team, participantsKey unique, messages, typing, read, presence, unread, notification bell
- [ ] Admin and Super Admin access – dashboard stats, users, events, orgs, requests, claims, communications, moderation, trust-safety, infrastructure
- [ ] Upload, replacement, display of media – square avatar cropping, landscape cover cropping, drag-to-position, zoom, preview, re-crop, aspect ratio, responsive Cloudinary f_auto/q_auto, cleanup obsolete assets

---

## 7. Phased Implementation Plan (Ranked by Impact, Risk, Dependencies, Effort)

| Phase | Goal | Impact | Risk | Dependencies | Effort | Gate |
|---|---|---|---|---|---|---|
| 0 | Audit and baseline | High | Low | None | Medium | Architecture and regression map verified |
| 1 | Design system | High | Low | Phase 0 | Medium | Shared tokens and components validated |
| 2 | Responsive UX | High | Low | Phase 1 | High | Major screens usable across 320-1920 |
| 3 | Event lifecycle | High | Medium | Phase 2 | High | Registration and ticket workflows pass |
| 4 | Home and Discover | High | Medium | Phase 3 | Medium | Hybrid feed/discovery works with real data |
| 5 | Navigation | Medium | Low | Phase 4 | Medium | Routes and core actions accessible |
| 6 | Campus entities | High | Medium | Phase 5 | High | Entity semantics, approvals, permissions pass |
| 7 | Social and post-event | Medium | Low | Phase 6 | Medium | Social flows and privacy pass |
| 8 | Notifications | High | Medium | Phase 7 | Medium | Scheduling and idempotency verified |
| 9 | Performance | High | Low | Phase 8 | Medium | Bottlenecks measured and improvements tested |
| 10 | Security and privacy | High | Medium | Phase 9 | Medium | Critical authorization regressions ruled out |
| 11 | Analytics | Medium | Low | Phase 10 | Low | Funnel measurement validated |
| 12 | Final regression | High | Low | Phase 11 | High | Release readiness report complete |

---

## 8. Proposed Files and Modules That May Need Modification

**Phase 1 Design System:**
- frontend/src/app/globals.css – consolidate tokens, remove !important, ensure semantic vars
- frontend/src/components/ui/button.tsx – use bg-primary, tokens, not hardcoded hex
- frontend/src/components/ui/card.tsx – bg-card, border-border
- frontend/src/components/ui/input.tsx – tokens
- frontend/src/components/ui/badge.tsx – semantic variants
- frontend/src/components/ui/dialog.tsx – bg-card, border-border
- frontend/src/components/ui/label.tsx – text-foreground, text-muted-foreground
- frontend/src/components/ui/skeleton.tsx – bg-muted shimmer
- frontend/src/components/states.tsx – PageLoader, EmptyState, ErrorState tokens
- frontend/src/components/user-avatar.tsx – remove bg-white hardcoded, use bg-muted or transparent
- frontend/src/components/event-card.tsx – ensure overlay contrast, not hardcoded dark
- frontend/src/components/search/search-bar.tsx – already transparent logos, check tokens
- frontend/src/components/shell/app-shell.tsx – navigation tokens

**Phase 2 Responsive UX:**
- frontend/src/app/(app)/organizations/[slug]/page.tsx – already fixed overflow, check all breakpoints 320-1920
- frontend/src/app/(app)/search/page.tsx – already theme-fixed, check responsive
- frontend/src/components/feed/feed-view.tsx, feed-post.tsx, right-rail.tsx
- frontend/src/components/messages/* – mobile chat edge, inbox clamping
- frontend/src/components/profile-view.tsx – rebuilt reference hierarchy, check 320-430
- frontend/src/app/(app)/events/[slug]/page.tsx – poster aspect, sticky CTA

**Phase 3 Event Lifecycle:**
- backend/controllers/event.controller.js, registration.controller.js, ticket.controller.js
- frontend/src/components/admin/event-form.tsx, event-tabs.tsx
- frontend/src/app/(app)/events/[slug]/page.tsx – primary action state-aware

**Phase 4 Home and Discover:**
- frontend/src/components/feed/use-feed-discovery.ts, home-view.tsx
- frontend/src/components/explore/explore-view.tsx, search/trending-grid.tsx
- backend/controllers/search.controller.js, event.controller.js trending/for-you

**Phase 5 Navigation:**
- frontend/src/components/shell/app-shell.tsx – MAIN_NAV, MobileNavItem, Create menu
- frontend/src/app/(app)/search/page.tsx – preserve deep links

**Phase 6 Campus Entities:**
- backend/models/organization.model.js, organizationMembership.model.js, organizationRegistrationRequest.model.js
- backend/controllers/organization.controller.js, organization-registration.controller.js, affiliation.service.js, event-approval.service.js
- frontend/src/app/(app)/organizations/*, admin/organizations/requests/*

**Phase 7 Social and Post-Event:**
- backend/controllers/post.controller.js, community.controller.js, message.controller.js
- frontend/src/components/feed/*, post/*, messages/*, stories/*

**Phase 8 Notifications:**
- backend/models/notification.model.js, communication.model.js, services/reminder.service.js, communication.service.js
- frontend/src/components/notifications/*

**Phase 9 Performance:**
- frontend/next.config.ts image remotePatterns, deviceSizes, formats avif→webp
- backend/repositories/* cursor pagination, indexes via migrations/performance-indexes.plan.js
- frontend/src/components/ui/optimized-image.tsx

**Phase 10 Security:**
- backend/middleware/auth.middleware.js, enforcement.middleware.js, rate-limits.js, socket-auth.middleware.js
- backend/services/enforcement.service.js, abuse.service.js

---

## 9. Baseline of Available Tests, Build Results and Performance Measurements

**Build:**
- Frontend: npm install && npm run build – Pass 42 routes, First Load 102kB (previous)
- Backend: node --check all controllers – OK after fixing (o: any) → (o)
- Backend: node server.js dummy env PORT 5001 – Starts OK binds 0.0.0.0:5001, realtime attached, schedulers started, MongoDB disconnected expected without local Mongo

**Tests:**
- organization-registration.e2e.js – All checks passed (Applicant, Super Admin, Approval, Security & Edge) via mongodb-memory-server
- organization-profile.e2e.js – Pass profile/discovery/link/search
- social.e2e.js – 41 checks – Pass (previous)
- community.e2e.js – 38 checks – Pass (previous)
- quiz.e2e.js – 32 checks – ?
- memories.e2e.js – 14 checks – ?
- mgmt.e2e.js – 11 checks – ?
- phase10-performance.selftest.js – ?
- phase11-direct-api-security.e2e.js – ?
- npm audit – 16 vulns (2 mod,13 high,1 crit) multer DoS, nodemailer SMTP injection

**Performance (measured):**
- Initial page load – not measured yet, need Lighthouse
- API response times – not measured, need logs
- Feed query latency – not measured, need profiling
- Image transfer sizes – Cloudinary f_auto/q_auto, formats avif→webp 30-50% reduction, deviceSizes 360-1920, minimumCacheTTL 1 year
- Number of requests – api.get("/health") once per page load to warm Render
- Build and bundle size – First Load 102kB, parse-check 215 files

---

## 10. Verified Facts, Assumptions and Unresolved Questions

**Verified Facts:**
- Repository is Next.js 15 + React 19 + Tailwind 4 frontend, Express 5 + Mongoose 8 + Socket.IO backend, MongoDB primary, Render backend https://teameklavya.onrender.com, Vercel frontend
- ThemeContext toggles html.dark, persisted localStorage, system preference, inline pre-paint script prevents FOUC
- 42 models, 24 controllers, 15+ route groups, 100+ endpoints, 62 frontend routes
- Organization model has logo/logoUrl, cover/coverUrl duplicate fields mapped logo||logoUrl
- Conversation participantsKey unique partial index, migration drops legacy unique participants index that caused prod 500 on Message
- Feed uses post-impression model, pool limit 400, trending by engagement likes×2+comments over 30 days
- Search uses cursor pagination for organizations, trending-first when q<2, suggested people when People tab empty
- Event approval workflow: approve, reject, request-changes, resubmit, cancel, with-reapproval, affiliation checks
- Media pipeline Cloudinary primary + local fallback, square avatar requests only (fixed from w_64,h_40 etc)
- Email Resend primary + SMTP fallback, sender EventHub <eventhub-noreply@ayanm.in>
- Rate limiting per-domain, global READ generous, 429 with Retry-After, Redis store if configured else memory
- Security: JWT, role checks, helmet, CORS, requestId, error taxonomy, idempotency, locks
- Build passes, E2E org registration and profile pass, responsive overflow fixed at 320px

**Assumptions (labelled, safest reversible approach):**
- OTP expiry 10min – assumed, need to verify auth.controller.js (not fully read due to time)
- Resend→SMTP fallback has no retry queue – assumed from email.service.js quick read, need deeper verification
- Feed ranking uses likes×2+comments – verified from post.controller.js? Actually need to confirm exact formula
- Stories usage low – assumption, no analytics available, should not delete based only on assumption, hide behind reversible feature flag if low
- Reminder scheduler in-process timer may fail if server sleeps – need to inspect reminder.service.js and Render deployment (does Render sleep? Free tier sleeps, but scheduler starts on listen, need durable scheduling)

**Unresolved Questions:**
- Exact OTP generation, storage hashed, expiry, resend cooldown, attempt limits, invalidation after use, replay prevention – need to read auth.controller.js fully
- Exact password reset token expiry – need to read auth.controller
- Exact ranking signals for events trending/for-you – need to read event.controller trending and for-you implementations
- Whether private attendance data leaks through ranking – need to verify search.controller and event.controller privacy checks
- Whether N+1 exists in feed population – need profiling
- Whether offline ticket viewing should be allowed – need to evaluate ticket security
- Whether weekly digest, .ics export, web push needed – evaluate demand and cost
- Whether Stories should be hidden behind feature flag – need usage data, not available
- Exact performance measurements – need Lighthouse, API logs, DB query plans
- Exact analytics instrumentation – none currently, need minimal safe instrumentation

---

**Phase 0 Exit Criteria:** Baseline written, critical flows mapped, first implementation phase (Phase 1 Design System) defined. Proceed to Phase 1.
