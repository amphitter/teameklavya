# EventHub — Performance & Infrastructure Audit (Part 5, §1)

> Audited **before any changes** (Part 5 rule: understand first). Every finding below is traceable to a file/line in the current repository. Backend: Express 5 + Mongoose + Socket.IO + Cloudinary (Render). Frontend: Next.js 15.5.9 + React 19 + Tailwind 4 (Vercel).

---

## 0. Provider reality (spec assumptions vs. what actually exists)

| Provider | Spec assumes | Actual state |
|---|---|---|
| **MongoDB** | Events, registrations, tickets, live results | ✅ Present — **and also hosts the entire social domain** (users, follows, posts, comments, reactions, saves, orgs, communities, notifications, messages, moderation). 33 models. |
| **Supabase / Postgres** | Social profiles, orgs, posts, messaging, notifications | ❌ **NOT PRESENT anywhere** (0 references). All social data lives in MongoDB. |
| **Cloudinary** | Images, optimized variants | ✅ Present — `services/media.service.js`, 5 MB cap, folder whitelist, an `optimizedUrl()` transformation helper that is **barely used**. |
| **R2** | Large files, certificates, exports | ❌ **NOT PRESENT** (0 references). No large-file storage; certificates are DB documents (no PDFs); CSV exports are generated in memory. |
| **Redis** | Future cache | ❌ Not present. **No cache of any kind exists** (no in-memory cache layer either). |
| **Socket.IO** | Realtime | ✅ Present (Part 4) — disciplined: in-memory rooms, throttled broadcasts, business-events-only persistence. |

**Consequence for Part 5:** the spec's Supabase/R2 items become **provider abstractions + documented migration paths** (§66), not new infrastructure to run today. Introducing Supabase/R2/Redis *now* would violate the "don't over-engineer, free-tier friendly, modular monolith" constraints. Domain ownership stays **logical** (event-domain vs social-domain collections, enforced by the repository layer) inside one MongoDB.

---

## 1. Inventory

- **API surface:** ~208 endpoints across 20 route files (`routes/*.js`).
- **Middleware:** `auth.middleware.js` (JWT requireAuth/requireAdmin), `socket-auth.middleware.js` (Socket.IO handshake JWT). That's all — no requestId, no cache, no per-domain rate limiting.
- **server.js stack:** helmet (CSP disabled — API-only), CORS (multi-origin), `express.json({limit:'10mb'})`, cookie-session (OAuth state), passport init, static `/uploads`, 3 rate-limit buckets, `GET /api/health`. **No compression. No ETag/Cache-Control policy. No request logging.**
- **Rate limiting today (3 coarse buckets):** global `/api` 400/15min (every endpoint shares this budget), `/api/auth` 25/15min, `/api/upload` 30/10min. express-rate-limit v8, draft-7 headers. **No per-domain buckets** (social, messaging, search, registration, realtime-join all share the global bucket).
- **Indexes:** broad coverage — 33 models, most with `index: true` on lookup fields; `event.model` (11), `liveAnswer` (7), `post` (6), `ticket` (4). Gaps noted in §3.
- **Frontend data layer:** one shared axios instance (`src/utils/api.js`) with JWT interceptor — good baseline, but **no caching, no deduplication, no stale time, no retry policy**. Typed wrappers exist in `src/lib/*.ts` (378 lines total).
- **Realtime (Part 4):** per-socket rate cooling (join 1.2s, commands 250ms, answers 400ms, chat/QA 1.5s, upvotes 500ms), throttled broadcasts (leaderboard 1s, poll 1s, QA list 400ms), in-memory room state, DB only for business events (sessions, answers, chat, Q&A).

---

## 2. Slow / expensive endpoints

| Endpoint | Why it's expensive | Severity |
|---|---|---|
| `GET /api/posts/feed` (for-you) | `FEED_POOL = 400` posts fetched with **4 populates each**, then ranked in JS, on **every** page request. Follow list fetched **3× per request** (visibilityFilter + scoring set + attachCounts). `countDocuments(filter)` runs on every page even though `hasMore` can be derived from the returned slice. | 🔴 HIGH |
| `GET /api/registration/responses/:eventId` | **Completely unbounded** — loads every registration for the event, populated, sorted, no limit, no pagination, no projection on answers. A 5,000-participant event = 5,000 populated docs serialized in one response. | 🔴 CRITICAL |
| `GET /api/registration/responses/:eventId/export` (CSV) | Loads the entire registration set into memory, builds the full CSV string in memory, non-streamed. Same unbounded read as above. | 🔴 CRITICAL |
| `GET /api/events` (browse/explore) | Free-text search = **5-field `$regex` with `$options:'i'`** — case-insensitive regex cannot use indexes → full collection scan per search keystroke-submit. 24 separate `countDocuments` call sites in event.controller. | 🟠 MED-HIGH |
| `GET /api/events/:id` (detail) | Multiple count queries per view (registrations, interests,…) + full event doc; uncached — every anonymous view hits Mongo. Public event detail is the #1 cacheable read in the app. | 🟠 MEDIUM |
| `GET /api/quizzes/:id/leaderboard` | Aggregation on every poll (frontend polls it every 10s while a quiz is live — legacy Part 2G path). | 🟠 MEDIUM |
| Feed `attachCounts` | Already **batched** (2 aggregates + 3 batched finds per page — no N+1 👍) but runs 5 queries per feed page + a full follow-list load; counts are never cached. | 🟡 LOW-MED |

---

## 3. Unbounded queries (verified)

| Query | File | Bound? |
|---|---|---|
| `getEventResponses` | registration.controller.js:290 | ❌ **NO limit** |
| `exportRegistrations` | registration.controller.js:306 | ❌ **NO limit** (full read into RAM) |
| `Follow.find({follower})` in feed | post.controller.js (×3 per request) | ❌ Unbounded — a user following N people loads N rows ×3 per feed page |
| `visibilityFilter` communities | post.controller.js:112 | ❌ Unbounded membership scan per feed request |
| Reminder scheduler audience | reminder.service.js:48 | ❌ Loads all registrations + interests per reminded event (1×/tick, low frequency) |
| Notifications list | notification.controller.js | ✅ capped 50 |
| Conversations / messages | message.controller.js | ✅ capped 50 / 100 |
| Comments, community members, org lists, followers/following | respective controllers | ✅ capped (20–100) with page/limit |
| Feed | post.controller.js | ✅ cursor + offset fallback, cap 20 |
| Live results board | live.controller | ⚠️ Bounded by event size but full leaderboard to every participant (acceptable one-shot; candidates for cap) |

---

## 4. N+1 analysis

**Mostly clean — the codebase already batches.** Verified:
- ✅ Feed counts/viewer state: batched `$in` aggregates + batched finds (`attachCounts`).
- ✅ Registration counts endpoint: batched (`getRegistrationCounts`).
- ✅ Conversation unread counts: single aggregation.
- ⚠️ **Semi-N+1:** feed requests perform the *same* follow-list query 3× (visibilityFilter, scoring, attachCounts) — not per-item, but 3× per request per user, unbounded in size.
- ⚠️ Reminder fan-out loads full user docs per event per tick.
- ⚠️ `populate` chains (4 populates × 400 pool docs on for-you feed) — not N+1 but heavy hydration cost.

---

## 5. High-write operations

| Operation | Detail | Risk |
|---|---|---|
| Notifications | `Notification.create` / `insertMany` on every like, comment, follow, message, event action — **no TTL, no cleanup, grows forever** | 🔴 growth |
| Live event writes | LiveAnswer/LiveMessage/QAQuestion per participant action — business events only ✅ (correct per §42), but **unbounded lifetime growth** (no retention policy) | 🟠 growth |
| `activity.save()` per question transition | Small docs, indexed — fine | 🟢 |
| Chat `LiveMessage` per message | Persisted forever, capped history fetch (50) but collection grows | 🟠 growth |
| AuditLog | Every admin/moderation action, no retention | 🟡 growth |
| Registration answers array | Custom-form answers embedded in RegistrationResponse docs (bounded by form size) | 🟢 |

---

## 6. High-read operations (per-authenticated-user baseline)

**The polling problem — 7 frontend polling loops, all against authenticated DB-backed endpoints:**

| Loop | Interval | Endpoint(s) hit |
|---|---|---|
| Notification bell (list) | 30s | notifications list |
| Notification bell (count) | 30s | unread count |
| Messages page (list) | 12s | conversations + unread agg |
| Messages page (thread) | **6s** | messages + read-update write! |
| Header messages badge | 30s | unread count |
| Quiz live leaderboard | 10s | quiz leaderboard aggregation |
| Live timer tick | 250ms | **client-only** (no network) ✅ |

A single user idling on the Messages page generates **~25 requests/minute**, including a **write** (`updateMany` read-receipts + `deleteMany` notifications) every 6 seconds — the read-receipt write fires on every poll even with no new messages. This is the single biggest bandwidth + DB-op + rate-limit-budget consumer in the app.

---

## 7. Caching opportunities (with owner/TTL/invalidation)

| Candidate | Type | Suggested TTL | Invalidation trigger |
|---|---|---|---|
| Public event detail | public | 60–300s | event update/delete, live state change |
| Events browse/explore pages | public | 60s | event create/update/publish |
| Trending topics (`getTrending`) | public | 60–300s | post create (lazy) |
| Popular events | public | 300s | registration count change (lazy) |
| Public org profile + stats | public | 5–15min | org update, follow change |
| Public community metadata | public | 5–15min | community update |
| Registration/interest counts per event | public | 30–60s | registration/interest write |
| Feed count aggregates (like/comment counts) | public per-post-set | 30–120s | like/comment write (fine-grained) |
| User follow-list (for feed) | private per-user | 30–60s | follow/unfollow |
| Quiz leaderboard (live) | public per-quiz | 5–10s (aligns with the 10s poll) | quiz answer |
| Static config (categories, live settings defaults) | public | hours | deploy |

**Cache must never share across users:** feed fragments, notifications, messages, registration state, viewer-specific anything (§10). No cache exists today, so the key builder + TTL registry (§11–12) must land before any cache call site.

---

## 8. Storage risks

- **Uploads buffer through Node RAM** (multer memoryStorage → Cloudinary stream). 5 MB cap mitigates, but 20 concurrent 5 MB uploads = 100 MB RSS on a free Render instance. No signed direct upload (§22 gap).
- **No image variants**: original URLs stored and served; frontend renders raw Cloudinary URLs at natural size (see §9). Backend `optimizedUrl()` helper exists but is unused in feed/post/media responses.
- **No orphan cleanup**: if Cloudinary upload succeeds but the DB write fails, the asset is orphaned; no `cleanup_pending` tracking (§55 gap).
- **No R2/large-file path**: CSV exports and future certificates have no object-storage destination. (Provider abstraction only — do not add R2 now.)
- `/uploads` local static folder still mounted (legacy local uploads) — disk usage on the API dyno, unbounded.

---

## 9. Frontend performance findings

| Finding | Evidence | Impact |
|---|---|---|
| **34 raw `<img>` tags, 0 `next/image`** | all pages | No lazy loading, no responsive sizes, no CDN transforms, CLS from unsized images, full-res phone photos in feed |
| **No code splitting beyond route level** | 0 `dynamic()`/`React.lazy` usages | Heavy dialogs (create wizard, editors, scanner) ship in route bundles |
| **7 polling loops** (see §6) | messages, notifications, quiz | Bandwidth + DB ops + rate-limit budget |
| **No data cache/dedup layer** | axios only | Refetch on every mount/navigation; 5 components mounting = 5 identical requests; no stale-while-revalidate |
| **`window.location.href` navigation for search submit** | search/page.tsx | Full page reload for a simple query |
| **localStorage JWT** | utils/api.js | Standard-but-XSS-exposed token storage (auth design, out of Part 5 performance scope; noted) |
| No request cancellation | axios usages | Obsolete searches/responses can overwrite fresh state (minor — search is submit-based) |
| next.config.ts is empty | no headers/images config | No security headers on frontend, no remote-image domains config |

**Positives to preserve:** single axios instance + typed lib wrappers, route-level code splitting by App Router, Suspense on search, submit-based (not per-keystroke) search, 250ms client-only timer (no network), socket-based live pages (no polling) from Part 4.

---

## 10. Realtime risks

- ✅ **No DB writes for presence/timers/animation** (Part 4 discipline holds — §42 already satisfied).
- ✅ Broadcast throttling exists (leaderboard 1s, poll 1s, QA 400ms) — §44 largely satisfied.
- ⚠️ **No per-user connection cap / per-IP cap** — a malicious client can open hundreds of sockets (each = 1 auth DB hit + room memory).
- ⚠️ **No room-size cap** on `event:join`.
- ⚠️ **Scale-out path undefined:** Socket.IO on multiple instances needs the Redis adapter + sticky sessions; current in-memory room state is single-instance. Must be documented (not built) per the no-over-engineering rule.
- ⚠️ Reconnect state reconstruction exists and is correct (`GET /live/state` + join snapshot) ✅ (§45 already satisfied).
- ⚠️ Legacy Part 2G quiz (`/quizzes/*`) uses HTTP polling leaderboard, not the Part 4 engine — keep cached, don't rebuild.

---

## 11. Security/config gaps (perf-adjacent)

- `express.json` limit **10 MB** — far too large for JSON APIs (§63; uploads don't use JSON bodies).
- Error responses return raw `error.message` in several controllers (Mongoose/provider messages can leak internals — §61/§67).
- No `Retry-After` on 429s; limiter message shape is `{success,message}`, not the standardized `{error:{code,message}}` (§25).
- No Cache-Control policy anywhere; Express default weak ETags exist for `res.json` but nothing sets public/private semantics (§47–48).
- Frontend serves no security headers (next.config empty) — CSP/HSTS belong there (§62).
- One global 400/15min bucket shared by all endpoints means a burst on one route can throttle normal browsing everywhere (§24/§26).

---

## 12. Database growth risks (retention)

Unbounded collections with **no TTL/cleanup policy**: `Notification` (per social action), `LiveMessage`, `QAQuestion`, `LiveAnswer` (per live event), `AuditLog`, `Report`. At 512 MB free-tier Atlas, live-event + notification history is the primary growth driver. OTP reset tokens live on User docs with expiry fields (verify cleanup). **No docs/DATA-RETENTION.md exists.**

---

## 13. What's already good (preserve — do not regress)

1. Cursor pagination on feed (+ offset fallback) with server-side cap 20.
2. Batched feed enrichment — no per-item N+1.
3. Populate field projections everywhere (`AUTHOR_FIELDS`, `EVENT_FIELDS`, …).
4. Limit caps on 15+ list endpoints.
5. Broad compound/single index coverage (33 models).
6. Socket.IO discipline: per-socket cooldowns, throttled broadcasts, business-events-only persistence, reconnect snapshots.
7. helmet + CORS multi-origin + 3 rate-limit buckets (correct library, draft-7 headers).
8. Central axios instance with auth interceptor; typed lib wrappers.
9. Cloudinary folder whitelist + MIME/size validation on upload.
10. `/api/health` endpoint exists.

---

## 14. Priority matrix for the plan

| P | Fix | Spec refs |
|---|---|---|
| **P0** | Rate-limit architecture (per-domain buckets, 429 shape, Retry-After) · body-size limits · error normalization (no leaks) | §24–27, §63, §67 |
| **P0** | Kill unbounded reads: `getEventResponses` pagination + projection; streamed CSV export | §5–7, §40–41 |
| **P0** | CacheService + key builder + TTL registry + SWR + in-flight dedup; cache public event/org/explore/trending/counts | §8–14 |
| **P1** | Repository layer (7 repos) · feed triple-fetch fix · hasMore without countDocuments · counter caching | §4–6, §36–37 |
| **P1** | Frontend: replace 7 polling loops (socket-lite or interval+ETag/cached), data-cache layer on axios, `<img>` → optimized, prefetch, lazy dialogs | §15–20, §39 |
| **P1** | Compression + Cache-Control/ETag policy + security headers | §46–48, §62 |
| **P2** | Socket connection caps · room caps · admin infra dashboard + metrics · structured logging/requestId | §43, §56–60 |
| **P2** | Data retention docs + TTL cleanup jobs · backup strategy doc · media orphan cleanup · provider abstraction (Storage/Email) · PERFORMANCE-ARCHITECTURE.md | §53–55, §65–66, §69, §73 |
| **P2** | Load/failure test extensions + final verification battery | §70–71, §75 |

*Audit complete. No architectural changes were made in this phase.*
