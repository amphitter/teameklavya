# Performance architecture (Part 5, Phase 8 — spec §73, §74)

The complete picture of how EventHub stays fast and cheap on free-tier
infrastructure, and what to change when that stops being enough.

This documents what is **actually implemented** across Phases 1–8. Where
something is deliberately deferred, it says so.

---

## 1. Shape of the system

EventHub is a **modular monolith**: one Node process, one MongoDB, one
deployment. No microservices, no Kubernetes, no Kafka, no Elasticsearch, no
distributed cache — none of it is warranted at this scale, and all of it would
cost more in operational complexity than it saves.

Modularity is enforced by **boundaries inside the process**, not by network
hops:

```
backend/
  repositories/   ← data access per domain; the ONLY place queries are shaped
  services/       ← domain logic (cache, realtime, media, metrics, …)
  controllers/    ← HTTP-shaped request/response
  routes/         ← mounting + action-scoped rate limits
  middleware/     ← auth, request context, idempotency, action guards
  config/         ← rate limits, cache TTLs, socket protocol, achievements
```

The payoff: moving a module out later is a matter of exposing one service
interface over the network, not untangling a web of direct calls.

---

## 2. Architecture diagram (§74)

```
                          ┌────────────────────────────────┐
   Browser / Mobile       │   Next.js 15 (Vercel)          │
   ─────────────────      │   ─────────────────────────    │
                          │   src/lib/query.ts             │
                          │     • shared cache + dedup     │
                          │     • staleTime / cacheTime    │
                          │     • adaptive polling         │
                          │     • optimistic mutations     │
                          │   OptimizedImage (sized vars)  │
                          │   next/dynamic for heavy libs  │
                          └───────────────┬────────────────┘
                                          │  HTTPS / JSON (JWT)
                                          │  WSS (Socket.IO)
                          ┌───────────────▼────────────────┐
                          │   EventHub API — one process   │
                          │   Express 5 (Render)           │
                          ├────────────────────────────────┤
                          │ helmet · CORS · compression    │
                          │ request-context (requestId)    │
                          │ HTTP cache policy              │
                          │ body limits 1mb / 2mb          │
                          │ ─────────────────────────────  │
                          │ rate limits (per domain)       │
                          │ idempotency · action guards    │
                          │ ─────────────────────────────  │
                          │ controllers → services →       │
                          │              repositories      │
                          └──┬────────┬────────┬───────┬───┘
                             │        │        │       │
              ┌──────────────▼──┐  ┌──▼──────┐ │  ┌───▼────────────┐
              │  MongoDB Atlas  │  │ Cache   │ │  │ Socket.IO      │
              │  512 MB free    │  │ (in-proc│ │  │ in-memory rooms│
              │                 │  │  LRU)   │ │  │ + caps + sweep │
              │ • repositories  │  │         │ │  └────────────────┘
              │ • cursor paging │  │ provider│ │
              │ • lean() +      │  │ interface    │
              │   projections   │  │ (§66)   │ │  ┌────────────────┐
              │ • batch counts  │  └─────────┘ │  │ Cloudinary     │
              │ • pool max 10   │              │  │ (images)       │
              └─────────────────┘              └──┤ R2 (large files│
                                                  │ local fallback)│
                                                  └────────────────┘

   Rule (§3): the browser NEVER talks to MongoDB, Cloudinary or R2 directly.
   Every byte crosses the EventHub API.
```

---

## 3. Database

**Pooling.** `MONGO_MAX_POOL_SIZE=10`. On a 512 MB free cluster, a larger pool
costs more connections than the cluster can serve and buys no throughput.

**Query shaping lives in `repositories/`.** Controllers never build queries.
That single rule is what made the Phase 3 work possible: removing an N+1 meant
editing one repository method, and every caller inherited the fix.

**The patterns that matter:**

- **`lean()` + projections.** Reads that feed JSON never need hydrated
  documents. Select only the fields rendered.
- **Over-fetch by one, derive `hasMore`.** Feeds and lists fetch `limit + 1`
  rows and infer whether another page exists. This removes an entire
  `countDocuments()` round trip per page — the single largest win on the
  hottest screen.
- **Cursor pagination, not offset.** `createdAt|_id` cursors stay stable as
  content is added; `skip(n)` degrades linearly and duplicates/skips rows when
  the underlying set shifts.
- **Batch the fan-out.** Registration counts for a page of 12 events are one
  `counts/batch` call, not twelve.
- **Cache the social graph.** One cached `getFeedContext(viewerId)` load
  replaced five per-request queries (follows, org follows, registrations,
  interests, memberships) that were being re-fetched three times per feed page.

---

## 4. Caching (`services/cache.service.js`)

In-process LRU behind a **provider interface** (§66): `getOrSet`, `peek`,
`invalidate`, `invalidatePrefix`, `stats`, `flush`. Swapping in Redis later
means implementing that interface — call sites do not change.

Guarantees enforced centrally, not by convention at call sites:

- A **TTL registry** documents owner, TTL and invalidation trigger per domain.
- **Private prefixes can never be served stale-while-revalidate.** User-scoped
  data is never shared across identities.
- **In-flight dedup**: concurrent identical loads share one promise (§15).
- **Stale-while-revalidate** for public reads: serve instantly, refresh quietly.

Invalidation is explicit and mirrors the frontend's key shape (`["event", id]`),
so a server-side invalidation and a client-side one describe the same thing.

---

## 5. Rate limiting (`config/rate-limits.js`)

Central, per-domain buckets: `AUTH`, `SOCIAL`, `MESSAGING`, `SEARCH`, `EVENT`,
`UPLOAD_BURST`, `UPLOAD_HOURLY`, `READ`. Applied at the prefix level in
`server.js`; action-scoped domains are mounted inside their route files so
browse/list endpoints stay under the generous `READ` bucket only.

Socket-side adds the cross-socket dimension (`REALTIME_CONNECT_USER`,
`REALTIME_CONNECT_IP`, `REALTIME_JOIN`, `REALTIME_ANSWER`), and Phase 6 adds
**concurrency caps** on top — see §8.

Every limit is env-overridable and can be disabled wholesale with
`RATE_LIMIT_DISABLED=1` for local development.

---

## 6. API

- **Compression** for JSON, skipped for `/uploads` (already-compressed bytes).
- **HTTP cache policy**: anonymous GETs on public read prefixes get
  `public, max-age=30, stale-while-revalidate=120`; everything else gets
  `private, no-store`. Diagnostics are explicitly `no-store`.
- **Body limits**: 1 MB JSON, 2 MB urlencoded. Files travel as multipart with
  their own cap, never base64 in JSON (§63).
- **Idempotency** (`middleware/idempotency.js`): a client-supplied
  `Idempotency-Key` makes a double-click or a retry after a flaky connection
  a no-op instead of a duplicate.
- **Action guards** (`middleware/action-guard.js`): follow/unfollow and
  like/unlike loops are capped above the raw rate limit, because those are
  legitimately rapid but pathological at volume.
- **Structured errors** (`utils/app-error.js`): one response shape. Stacks,
  provider messages and Mongo errors are logged with the `requestId` and never
  sent to a client (§61).

---

## 7. Images and files

- **Cloudinary** for images, **R2** for large files, **local disk** as a dev
  fallback so the app runs with no credentials at all.
- **No binaries in MongoDB** (§21). Ever.
- **Sized variants.** The frontend requests a variant matched to its layout box
  rather than the original. `PRESET_WIDTHS` (frontend) and `VARIANT_PRESETS`
  (backend) must stay in sync — a mismatch silently ships oversized images.
- **Client-side compression before upload** (`utils/compress-image.ts`).
- **Orphan lifecycle** (§55): upload → `pending` with `cleanupAfter` → domain
  write attaches it → `active`. A failed write leaves `cleanup_pending`, and
  `scripts/media-sweeper.js` reclaims record **and** remote object together.

---

## 8. Realtime

One Socket.IO server, in-memory rooms. See `docs/REALTIME-HARDENING.md` for the
full detail.

- **Presence is never persisted** (§42). Rooms, socket registries and live
  scores in flight die with the process; durable results live in
  `participantsessions` and `eventresults`.
- **Concurrency caps**: 5 sockets/user, 20/IP, 500 participants/room.
- **Stale-socket sweep** every 5 min reconciles presence against the transport.
- **Broadcasts are throttled; correctness never is.** Leaderboard 1 s, poll
  distribution 1 s, Q&A 400 ms, answer 400 ms/socket, organizer command 250 ms.
  Scores are persisted and acked *before* any throttled board refresh.
- **State reconstruction on reconnect** returns the full payload, including the
  open question.

---

## 9. Frontend

- **One data layer** (`src/lib/query.ts`, §16): shared cache, in-flight dedup,
  `staleTime`/`cacheTime`, optimistic mutations with rollback, retry that is
  strictly limited to transient failures, and cursor-based `useInfiniteQuery`.
  ~700 lines, zero new dependencies, React-Query-shaped API so swapping in
  `@tanstack/react-query` is a rename.
- **Adaptive polling**: paused on hidden tabs, backoff after repeated identical
  responses, instant reset when data changes. Replaced six fixed-interval loops.
- **Client-side navigation** — no `window.location` full reloads in-app.
- **Prefetch on hover/focus** warms the exact key the destination reads;
  skipped on `(hover: none)` devices so mobile pays nothing.
- **Debounced, abortable search** — a superseded query can never overwrite a
  newer one.
- **Lazy-loaded heavy libraries**: `@zxing/browser` (QR scanner) and
  `react-easy-crop` load on demand. The scanner route went 121 kB → 6.7 kB.

---

## 10. Monitoring and failure handling

- **Structured logging** (`middleware/request-context.js`): every request gets
  an id and a JSON log line with method, path, status and duration.
- **Metrics** (`services/metrics.service.js`): latency percentiles, cache
  hit/miss/eviction, rate-limit events, socket counts, provider outcomes,
  upload success/failure, status buckets. Bounded ring buffers — memory cannot
  grow without limit.
- **Admin dashboard**: `GET /api/admin/infrastructure` (Phase 7) scores
  everything against budgets on the 80/90/95 scale.
- **Graceful degradation**:
  - Storage provider outage → local fallback, never a failed request (§68).
  - Cache unavailable → reads fall through to the database.
  - Snapshot build failure during `event:end` → logged, completion still
    succeeds; results are never blocked by analytics.
  - Failed prefetch → silent; a warm-up is never an error.
- **No infrastructure detail to users** (§61). The public `/api/health` reports
  "up" and nothing else; every internal figure is behind the admin route.

---

## 11. Deferred on purpose

| Deferred | Why | Trigger to adopt |
|---|---|---|
| Redis | One process; in-process LRU is sufficient and free | More than one instance |
| BullMQ / queues (§65) | No write burst justifies it yet | A workload that must survive a restart |
| Socket.IO Redis adapter | Single instance today | Horizontal scale-out |
| Elasticsearch | Postgres/Mongo text search is adequate | Search becomes a product feature |
| Read replicas | One cluster | Read throughput saturates |

The service boundaries are already drawn, so each of these is an implementation
detail behind an existing interface rather than a rewrite.

---

## 12. Verification

```
platform 21 · phase2 22 · phase3 44 · phase4 37 · phase5 70 · phase6 87 · phase7 83
e2e: quiz 32 · memories 15 · mgmt ✅ · live 65 · social ✅ · community 38
```

`npm run test:all` runs every suite. `docs/PERFORMANCE-AUDIT.md` holds the
Phase 0 baseline these numbers are measured against.
