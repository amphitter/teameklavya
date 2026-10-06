# PART 5 — Optimization & Infrastructure Hardening Plan

> Modual monolith only. No Kubernetes, no Kafka, no Elasticsearch, no new running infrastructure. Everything lands inside the existing Express + Next.js app. Audit-first: see `docs/PERFORMANCE-AUDIT.md` (Phase 0, complete).
>
> **Provider reality:** no Supabase/R2/Redis exists today. Those spec items become provider abstractions + migration paths (§66), not new services. MongoDB remains the single database with logical domain ownership enforced by the repository layer.

## Phase 0 — Infrastructure audit ✅ DONE
`docs/PERFORMANCE-AUDIT.md` — providers, endpoints, queries, polling, growth, storage, realtime, security gaps, priority matrix.

## Phase 1 — Core platform services ✅ DONE (21/21 selftest)
- **`utils/app-error.js`** — error taxonomy (§67): ValidationError, UnauthorizedError, ForbiddenError, NotFoundError, RateLimitError, DatabaseUnavailableError, StorageUploadError, ProviderUnavailableError + `errorResponse()` normalizer. No raw provider errors to clients (§61).
- **`middleware/request-context.js`** — requestId + structured logging with duration/operation/status/userId/eventId/provider (§56); never logs secrets/tokens/contents.
- **`services/cache.service.js`** — CacheService over a **CacheProvider interface** (§8, §66): in-memory LRU now, Redis later without business-logic changes. Centralized **key builder** (`event:{id}`, `org:{id}`, `community:{id}`, `trending:{topic}`, `counts:event:{id}`, `followlist:{userId}`, …) (§11); **TTL registry per domain** (§12); **stale-while-revalidate** for public data only (§14); **in-flight request dedup** (§15); hit/miss metrics hooks (§58).
- **`services/metrics.service.js`** — in-memory ring buffers: API latency p50/p95/p99, cache hit/miss/eviction, rate-limit events, socket counts, provider errors, 4xx/5xx counts (§57–58).
- **`utils/with-timeout.js`** — per-operation timeouts + selective retry with exponential backoff + jitter (retry network/transient only, never 4xx-auth/validation/duplicate) (§29–30).
- **Circuit-breaker wrappers** for optional providers (email, Cloudinary, analytics): provider failure degrades, never crashes (§31, §68) — email already non-blocking; verify + harden.
- **server.js**: `compression` (skip pre-compressed types) (§46), body limits 1mb JSON / 2mb urlencoded (§63), ETag + Cache-Control policy middleware (public short TTL for public GETs, `private, no-store` for authenticated) (§47–48), error normalizer wired into the final handler.

## Phase 2 — Rate limiting, abuse & idempotency ✅ DONE (config/rate-limits.js central buckets, action-guard, idempotency window, socket connect/join/answer guards, docs/IDEMPOTENCY-AUDIT.md, tests/phase2.selftest.js)
- **`config/rate-limits.js`** + central applier: per-domain buckets (§24): AUTH (login/signup/OTP — keep 25/15m), SOCIAL (follow/like/comment/post/save ~30/min), MESSAGING (send ~20/min), SEARCH (~30/min), EVENT (registration/check-in/join ~20/min), UPLOAD (init 10/hr + tighter 15/10m), REALTIME (socket connect per user/IP, event join, answer), READ (generous browsing bucket — do not throttle normal use) (§26).
- **429 shape**: `{ error: { code: "RATE_LIMITED", message } }` + `Retry-After` (§25). No infra details leaked.
- **Abuse guards** (§27): follow/unfollow + like/unlike loop limits (action-frequency caps on top of unique indexes), comment flood, community-create cooldown, live-join spam (socket-side already partly done — add per-user caps), upload session limits (§23).
- **Idempotency audit** (§28): registration (unique response per user+event — verify), check-in (idempotent scan), follow/like/save (unique compound indexes — verify each), event interest (unique), post double-click (client disable + optional client-request-id dedup window). Fix any gap found.

## Phase 3 — Database layer: repositories, queries, pagination, counters ✅ DONE (44/44 selftest)
**New surface:** `backend/repositories/` (7 repositories + `cursor.js`), `backend/utils/regex.js`, `backend/utils/csv-stream.js`, `backend/tests/phase3.selftest.js`.

All results below are **proven against a live (in-memory) MongoDB** by counting the actual commands Mongoose issues — not asserted from source.

| # | Fix | Before | After |
|---|---|---|---|
| P0-1 | Participant list (`getEventResponses`) | **UNBOUNDED** — every registration loaded + populated | Cursor-paginated, hard-capped at `MAX_LIMIT` 100, server-side `q` + `status` (§7, §41) |
| P0-2 | CSV export | Whole event in RAM + full CSV string in memory | **Streams** in 200-row batches — memory is O(batch), not O(event) (§40) |
| P0-3 | `getRegistrationCounts` | **2 queries per event id** (2N) | **ONE aggregation** for the whole batch (§36) |
| P0-4 | `getRegistrationStats` | 5 queries (3 counts + 2 aggregates) | **ONE `$facet`** aggregation (§40) |
| P0-5 | Feed | `Follow.find` ran **3×** per request + a per-page `countDocuments` | Social graph resolved **once** per user and cached (PRIVATE, identity-scoped key); `hasMore` derived from an over-fetched slice (§35) |
| P0-6 | Public event detail | Fresh Mongo read for every visitor | Cache-first via `cache.peek()` → **0 DB queries on a hit**; private events **never** cached; missing events never cached as `null` (§9, §10) |
| P0-7 | Duplicate indexes | 4 duplicate B-trees (event.slug, user.email, user.username, ticket.token) | Removed — measured against the **compiled** schema, not source text |

Also shipped: `MAX_LIMIT` centralised in `repositories/cursor.js` (§7 — `limit > 100` can never be accepted); server-side search caps (§63); **CSV formula-injection guard** (§62); `cache.peek()` added to `CacheService` so cache-first reads can't poison a key with `null`.

Frontend: `admin/events/[id]/registrations` moved from client-side filtering to **server-side** debounced search + status filter with cursor "Load more" — required, because paginating the endpoint while filtering client-side would have searched only the first 100 rows.

**Cache invalidation matrix (§13) — every write that feeds a cached read:**

| Write | Invalidates |
|---|---|
| follow / unfollow / accept / decline request | `followlist:{actorId}` |
| org follow / unfollow | `followlist:{userId}` + `org:{id}` + `counts:org:{id}` |
| event interest toggle (both directions) | `followlist:{userId}` + `event:{id}` + interest count |
| registration submitted | `counts:event:{id}` + `stats:event:{id}` + `followlist:{userId}` |
| event update / delete | `event:{id}` + `event:slug:{slug}` + counts + `explore:*` + `trending:*` |

> One regression was caught and fixed during verification: org follows initially did **not** invalidate the feed context, so the "Following" tab kept showing orgs the user had just unfollowed. Invalidation is now wired on every path above.

**Not yet optimised (deferred, deliberately):** `getEvents` (browse/explore) still uses a 4-field case-insensitive `$regex` and ~24 `countDocuments` call sites — that is Phase 4/5 work and needs care, since changing it alters search semantics.

- **`repositories/`** (§4): EventRepository, RegistrationRepository, PostRepository, OrganizationRepository, CommunityRepository, MessageRepository, NotificationRepository (+ shared cursor helpers). Controllers stop owning query construction for these domains; domain ownership (event vs social) enforced here (§2).
- **Cursor pagination everywhere it's list-shaped** (§7): registrations/participants (currently UNBOUNDED — P0), feed (already cursor — keep), comments, followers/following, notifications, messages, community members, search results. Response shape `{ items, nextCursor, hasMore }`; server-side max limit (≤100) everywhere (§63).
- **Feed optimization** (§38): single follow-list fetch per request (reuse via 30–60s per-user cache), drop per-page `countDocuments` (derive `hasMore` from slice), reduce pool hydration cost (populate only what cards render), keep deterministic ranking (already follows §38 priorities).
- **Response projection** (§6): feed cards, participant rows, registration lists — only screen-required fields; no full docs.
- **Counter caching** (§37): registration/interest counts per event (30–60s TTL, invalidated on write), like/comment counts via cached aggregate fragments, unread counts (short TTL). Bounded staleness, documented.
- **Search hardening** (§39): min query length (2), result cap, indexed prefix-anchored regex where possible, case-insensitive collation index evaluation; document text-index option as future.
- **Dashboards** (§40): verify COUNT/aggregate-only (admin.controller mostly aggregates already — audit + fix any full loads).
- **CSV export** (P0): stream via cursor → json2csv transform → res stream; never buffer whole export.
- **Batching audit** (§36): reminder fan-out, notification fan-out (already insertMany), org/member lookups — batch where >1 round trip remains.

## Phase 4 — Storage & image optimization ✅ DONE (37/37 selftest)
**New surface:** `services/storage.provider.js`, `models/mediaAsset.model.js`, `scripts/media-sweeper.js`, `tests/phase4.selftest.js`; frontend `components/ui/optimized-image.tsx`, `utils/compress-image.ts`.

| # | Fix | Before | After |
|---|---|---|---|
| §66 | Storage access | Cloudinary specifics lived in `media.service.js` | **StorageProvider interface** (6 members) with Cloudinary + local implementations; provider chosen in one place |
| §19 | Image delivery | One `getOptimizedImageUrl()` helper, barely used; 56 raw `<img>` tags pulling originals | `imageVariants()` (thumb/small/medium/large per preset) + `OptimizedImage` with responsive `srcset`, `f_auto`, lazy loading, CLS-safe dimensions |
| §19/§20 | Presets | ad-hoc pixel values | Canonical presets (avatar/logo/poster/post/banner) mirrored **exactly** between backend `VARIANT_PRESETS` and frontend `PRESET_WIDTHS` |
| §20 | Upload size | Flat 5 MB for everything | **Per-folder ceilings** (avatars 2 MB, posters 8 MB, posts 5 MB) + on-device canvas compression before upload |
| §62 | Upload trust | `file.mimetype` from the browser was believed | **Magic-byte sniffing** — a PNG labelled `image/jpeg` is rejected |
| §55 | Orphaned assets | Upload-then-failed-write leaked bytes forever | `MediaAsset` lifecycle (`pending → active → cleanup_pending`) + `scripts/media-sweeper.js` (dry-run by default, 24h grace) |
| §57 | Upload metrics | failures only | successes + **failure rate** for the Phase 7 dashboard |
| §49 | Assets | `next.config.ts` empty | AVIF/WebP, Cloudinary remote pattern, `optimizePackageImports` tree-shaking |

**Bug found and fixed:** the inherited Cloudinary URL regex used a single `\/[^\/]*` group that swallowed whichever path segment came first — it silently **deleted the version marker** (`/v1712345678/`) on every transform, and stacked transformations instead of replacing them. Rewritten with explicit segment parsing: transformation is replaced, version and asset path are always preserved.

**Sweeper verified end-to-end:** with 3 assets in the DB (stale `pending`, `active` carrying a stale timestamp, fresh `pending` inside its grace window) the reclaimable query returned exactly the one stale `pending` asset. An `active` asset is never reclaimed, even with an expired `cleanupAfter` — the §53 "user content is permanent" rule holds structurally, not by convention.

Frontend: `OptimizedImage` migrated into the 6 hot paths (event card, user avatar, feed post, posts grid, event post card, profile cover); compression wired into the 3 highest-volume uploaders (create post, event poster, avatar/cover).

- **Cloudinary variants** (§19–20): `imageVariants()` helper (thumb 160 / small 400 / medium 800 / large 1200, f_auto q_auto); store `media.variants` or transform-on-delivery URLs; API responses return sized URLs (never originals for cards).
- **Upload pre-optimization** (§20): client-side canvas resize (max 1600px poster / 400px avatar) + size guard before POST; server keeps 5MB cap + MIME checks.
- **Upload rate/session limits** (§23): init cooldown per user; stricter than generic upload bucket.
- **Orphan cleanup** (§55): `cleanup_pending` marking on failed DB-write-after-upload; safe sweeper job (DEV/script + documented).
- **StorageProvider interface** (§21–22, §66): Cloudinary now; R2/S3 as documented future target (signed direct upload path designed, not built — multer buffering is acceptable under the 5MB cap today).
- **Frontend `<img>` → optimized images** (§19): sized Cloudinary URLs + width/height attrs + loading=lazy (next/image remote config evaluated; plain optimized `<img>` acceptable where next/image fights Cloudinary) — kills the 34-raw-img problem + CLS.

## Phase 5 — Frontend performance
- **`lib/query.ts`** — single data layer on the existing axios instance (§16): useQuery (staleTime/cacheTime/dedup via in-flight map), useInfiniteQuery (cursor pagination), useMutation (optimistic updates + rollback + retry-with-jitter on transient errors only), invalidation keys mirroring backend cache keys (§11), prefetch helpers (§17: event-card hover → prefetch detail; feed end → next page). No second competing system (none exists today); react-query-compatible API shape for a future swap.
- **Kill the 7 polling loops** (§6 of audit): messages thread 6s → ETag/304 + backoff + cached response; notification bell 30s → single cached endpoint + longer idle backoff; quiz leaderboard 10s → server-side 5s cache of the aggregation. (Full socket-messaging is out of scope — documented as future; the goal is 304s + cached payloads, not new infra.)
- **Lazy loading** (§18): dynamic() for create-post menu, event wizard, scanner, admin/super-admin modules, heavy dialogs.
- **Search page**: client-side navigation (no `window.location` reload), AbortController cancellation (§39).
- **next.config**: security headers (CSP carefully scoped, HSTS, X-Content-Type-Options, Referrer-Policy, Frame-Options, Permissions-Policy) (§62), remote image patterns.
- **Mobile** (§51): verify lazy images, small payloads, no heavy animations on low-end (prefers-reduced-motion already partially honored — audit).

## Phase 6 — Realtime hardening
- Socket connection caps: max sockets per user (e.g. 5) + per-IP (e.g. 20), room join cap per event (config), stale-socket sweep (§43).
- Backpressure verification (§44): existing throttles documented (leaderboard 1s / poll 1s / QA 400ms); answer/score/final-results correctness never coalesced.
- State reconstruction already correct (§45) — add regression test.
- Document Redis-adapter + sticky-session scale-out path (no implementation).

## Phase 7 — Observability & admin infrastructure dashboard
- `/api/admin/infrastructure` (admin-only, §59–60): DB storage/counts, cache hit rate/size/evictions, API latency percentiles, rate-limit event counts, socket connections, provider health (Cloudinary/email ping), upload failures, thresholds (80/90/95 = WARNING/HIGH/CRITICAL).
- Frontend `Admin → Infrastructure` page (§60). Admin-only, clean messages, no provider quotas leaked to normal users (§61).
- Structured request logging from Phase 1 surfaced per-route (slow-query warnings, N+1 heuristics).

## Phase 8 — Docs & retention
- `docs/DATA-RETENTION.md` (§53–54): TEMPORARY (OTP tokens, upload records, live runtime docs policy) vs PERMANENT (events, posts, registrations, results, certificates — never auto-deleted). TTL indexes only on temporary classes; cleanup script for live chat/Q&A archives with explicit policy.
- `docs/BACKUP-STRATEGY.md` (§69): mongodump frequency/retention/restore drill, Cloudinary metadata export, provider notes.
- `docs/PERFORMANCE-ARCHITECTURE.md` (§73): the full architecture doc (caching, rate limits, DB, frontend, realtime, images, API, pooling, pagination, batching, monitoring, failure handling) + §74 final architecture diagram.
- `.env.example` updates for every new optional var.

## Phase 9 — Tests, verification battery, final report
- Extend e2e: rate-limit 429 shape + Retry-After, cursor pagination (registrations/feed/comments), cache behavior (hit/miss/invalidation/SWR/private-isolation), idempotency (double-click), compression header, ETag/304, socket caps, search guards, export streaming.
- Load extension: 100/500-client profile on live load harness + rapid like/follow/join storm profile (§70); failure-simulation notes (§71).
- Full static battery in sandbox (node --check sweep, python balance/symbol sweeps) + documented runbook for dev-machine execution (§75).
- `PART5_FINAL_REPORT.md` — all sections per the Part 5 final-report contract.

## Coverage map (spec § → phase)
§1→P0 · §2–3→P3 (logical ownership + composition kept) · §4→P3 · §5–7→P3 · §8–15→P1 · §16–18→P5 · §19–20→P4 · §21–23→P4 · §24–27→P2 · §28→P2 · §29–31→P1 · §32→P1 (pool audit) · §33→P3 · §34→N/A (no Postgres — documented in P0 audit) · §35–36→P3/9 · §37–38→P3 · §39→P3/P5 · §40–41→P3 · §42→already ✅ (P4 of Part 4) · §43–44→P6 · §45→already ✅ · §46–49→P1/P5 · §50–52→P5 · §53–55→P4/P8 · §56–61→P1/P7 · §62→P5 · §63→P1/P2 · §64→P2 · §65→P1/P8 (boundaries only) · §66→P1/P4 · §67→P1 · §68→P1 · §69→P8 · §70–71→P9 · §72→standing rule · §73–74→P8 · §75→P9

## Standing rules
- No new running infrastructure (no Redis/queues now) — only interfaces + docs for them.
- Real data only (§72); demo fixtures stay double-gated (Part 4 seeder).
- Every cache documents owner/TTL/invalidation in the TTL registry.
- Never cache private data cross-user; user-scoped keys carry identity.
- All existing features preserved — this is optimization, not redesign.
