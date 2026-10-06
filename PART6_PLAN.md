# EVENTHUB PART 6 — PLAN

**Distributed cache, Redis & selective Supabase architecture**

Baseline: `dacccc2` (Part 5 complete — 561 assertions, 0 failed; 6 e2e suites;
tsc + next build both exit 0)

> Step 18 of the Part 6 brief requires the audit and the plan **before** any
> code is modified. This document is that deliverable. Implementation does not
> begin until §11.

---

# PART A — AUDIT

## A1. Repository audit

83 files changed / 30 new in Part 5. Relevant surface today:

```
backend/
  config/      db.js · passport.js · rate-limits.js · socket-protocol.js
  middleware/  auth · action-guard · idempotency · request-context · socket-auth
  models/      35 Mongoose models
  repositories/ 8 files (community, cursor, event, message, notification,
                         organization, post, registration)
  services/    cache · metrics · infrastructure · storage.provider · realtime
               social · media · notification · ticket · result · completion …
  utils/       app-error · frequency-limiter · with-timeout · regex · crypto
  providers/   (does not exist yet)
```

There is **no** existing Redis, Postgres or distributed-primitive code. The
nearest precedent — and the pattern Part 6 will copy — is
`services/storage.provider.js`: a provider object with `name`,
`isConfigured()`, `configure()`, domain methods, and a circuit breaker from
`utils/with-timeout.js`.

## A2. Existing cache provider

`services/cache.service.js` already defines the interface the brief asks for:

```
CacheProvider = { get, getStale, set, del, delPrefix, size, flush }
```

`MemoryCacheProvider` implements it (LRU + TTL + stale retention for SWR).
The application-facing facade is deliberately narrow:

```
cache = { getOrSet, peek, invalidate, invalidatePrefix, stats, flush }
```

- There is **no raw `set`** on the facade — values only enter through a loader.
- SWR on a private key **throws** (`assertSwrAllowed`) rather than trusting
  callers.
- In-flight dedup via a `Map` of promises (§15).
- `maxEntries` from `CACHE_MAX_ENTRIES` (default 500); `CACHE_DISABLED=1`
  short-circuits everything.

**Gaps vs the brief:**

| Brief requirement | Today |
|---|---|
| `CACHE_PROVIDER=memory\|upstash` | ❌ provider hardcoded to memory |
| `UpstashRedisProvider` | ❌ does not exist |
| Boot when Redis unavailable | ❌ n/a (no Redis) |
| Namespaced/versioned keys `v1:event:{id}` | ❌ keys are unversioned |
| Key builder covers feed / profile / community-members / leaderboard / search | ❌ only 10 keys, no feed or search key |
| Registry records owner + TTL + invalidation + privacy | ⚠️ TTL registry is `name -> ms` only; no owner/invalidation/privacy fields |

Current keys: `event:{id}` · `counts:event:{id}` · `explore:{bucket}` ·
`trending:{topic}` · `org:{id}` · `community:{id}` · `counts:post:{id}` ·
`quiz:board:{id}` · `followlist:{userId}` · `static:{name}`.
`PRIVATE_PREFIXES = ["followlist:", "notif:", "user:", "msg:"]`.

## A3. Rate limiter

Two independent mechanisms, both process-local:

1. **`express-rate-limit`** for HTTP domains (`config/rate-limits.js`).
   21 domains in `DEFAULTS`; `LIMITS` built with per-domain env overrides;
   `standardHeaders: "draft-7"`; key = `u:{userId}` when authenticated else
   `ip:{ipKeyGenerator(ip)}`. Handler raises `RateLimitError` →
   `errorResponse()` → 429 + `Retry-After` + `RateLimit` + `RateLimit-Policy`.
   **Store is the library default (in-memory).**
2. **`SlidingWindow`** (`utils/frequency-limiter.js`) for action guards
   (`middleware/action-guard.js`) and socket guards
   (`services/realtime.service.js`). Backed by a plain `Map`, with a
   `MAX_TRACKED_KEYS = 20_000` safety valve. The file's own header says:
   *"NOT a distributed limiter."*

Both need a shared counter backend to satisfy the brief's Server A / Server B
scenario. The 429 contract itself (Retry-After, RateLimit headers, env
overrides) already exists and must be preserved verbatim.

## A4. Idempotency middleware

`middleware/idempotency.js` — an in-process `Map` (`seen`) keyed
`${scope}:${key}` with `WINDOW_MS = 2 min` and `MAX_KEYS = 10_000`.
Replay → `ConflictError` → **409**.

**Two gaps:**

1. It is **process-local**, so Server B cannot see Server A's key.
2. It is mounted on only **two routes**: `POST /api/posts` and
   `POST /api/registration/responses`. The brief explicitly names ticket
   issuance, quiz submissions, payments and event submissions — none of which
   are currently protected.

Note the current semantics are **reject-on-replay** (409), not
return-cached-response. The brief's requirement is "never create duplicate"
rows, which 409 satisfies; the brief also says Server B "must recognize the
existing key", which it will.

## A5. Authentication & identity

This is the most consequential finding for the Supabase work.

- Canonical identity is the **MongoDB `users._id`** (24-hex ObjectId).
- JWT payload: `{ id, role, email, purpose: "auth" }`, HS256, `JWT_SECRET`,
  7-day expiry (`JWT_EXPIRES_IN`).
- `requireAuth` verifies the token, **rejects** any `purpose !== "auth"`
  (so short-lived OAuth exchange codes are not session tokens), checks
  `suspendedAt`, then sets `req.user = decoded`.
- `optionalUser` is the soft variant used on public routes.
- Super-admin is by email (`SUPER_ADMIN_EMAIL`), not by a role column.
- OAuth is Google via Passport; `config/passport.js` throws at require-time
  if OAuth env vars are absent.

**Consequences for Supabase:**

- **Supabase Auth is not used and must not be introduced.** Authentication
  stays exactly as it is — the brief says "never silently change
  authentication."
- Supabase rows must reference the EventHub user id. Because a Mongo ObjectId
  is not a Postgres `uuid`, Part 6 will derive a **deterministic UUIDv5** from
  the ObjectId (namespaced by a fixed app UUID) and use that as the Postgres
  `user_id` / `profiles.id`. Derivation is pure, so no mapping table and no
  lookup is needed to go from one to the other in either direction.
- Row Level Security will be **enabled but not relied upon**: the EventHub API
  is the single business/security boundary, so the server uses the service-role
  key and enforces authorization in application code (brief §14).

## A6. MongoDB models — 35 total

**Event/business core (stays in MongoDB, source of truth):**
`user` · `event` · `registrationForm` · `registrationResponse` · `ticket` ·
`activity` · `question` · `quiz` · `quizParticipation` · `liveAnswer` ·
`liveMessage` · `qaQuestion` · `participantSession` · `eventResult` ·
`certificate` · `pollResponse` · `auditLog` · `mediaAsset`

**Relational/social domain (candidate for Supabase):**
`follow` · `organization` · `orgFollow` · `community` · `communityMember` ·
`communityClaim` · `post` · `comment` · `reaction` · `conversation` ·
`message` · `notification` · `block` · `eventInterest` · `achievement`
(config) · `eventInterest`

The split matches the brief's list in §8 closely. Note `eventInterest` is
listed in the brief's Supabase schema but is event-domain data — it will be
flagged for a deliberate decision (§B3).

## A7. Social/community models — existing constraints

These map **directly** onto Postgres unique constraints and composite indexes:

| Model | Unique constraint | Other composite indexes |
|---|---|---|
| `follow` | `(follower, followee)` | `(followee, status, createdAt)`, `(follower, status, createdAt)` |
| `orgFollow` | `(user, organization)` | `(organization)` |
| `communityMember` | `(community, user)` | `(user, status)`, `(community, status, createdAt)` |
| `communityClaim` | `(community, organization)` | `(status, createdAt)` |
| `reaction` | `(post, user)` | — |
| `block` | `(blocker, blocked)` | — |
| `eventInterest` | `(event, user)` | `(user, createdAt)`, `(event, createdAt)` |
| `conversation` | `(participants)` — array-unique | `(updatedAt DESC)` |
| `post` | — | `(createdAt DESC, _id DESC)`, `(author, createdAt)`, `(event, createdAt)`, `(status, createdAt)`, `(topics, status, createdAt)`, `(community, status, createdAt)` |
| `comment` | — | `(post, createdAt)` |
| `message` | — | `(conversation, createdAt DESC)` |
| `notification` | — | `(user, createdAt DESC)`, `(user, read)` |

Two things need care in Postgres:

- `conversation.participants` is an **array** with a unique index. In Postgres
  this becomes a `conversation_members` join table with
  `UNIQUE (conversation_id, user_id)`, plus a canonical-pair constraint for
  1:1 DMs (a sorted-pair unique index).
- `post.images` / `post.mentions` are arrays. The brief asks for `post_media`,
  so images move to a child table; `mentions` becomes a join table rather than
  a JSON blob.

## A8. Realtime architecture

All realtime state is **in-process**:

- `rooms: Map<eventId, { participants: Map, organizers: Map, lastRanks, leaderboardVisible, questionsClosed }>`
- `bySocket` / `byUser` / `byIp` maps for concurrency caps.

This is why the brief says (§12) *do not* immediately add the Socket.IO Redis
adapter: the adapter shares **pub/sub**, but it does **not** share this
in-process participant registry. Turning it on without moving that state would
break participant caps, organizer detection and the stale-socket sweep across
instances. Part 6 will deliver the abstraction + documentation and an explicit
readiness checklist, not the adapter itself.

Current guarantees to preserve: room isolation, per-user/per-IP/per-room caps,
backpressure throttles (leaderboard 1 s, poll 1 s, Q&A 400 ms), timer/typing/
presence/animation frames stay ephemeral (§42), durable answers/results persist.

## A9. Environment configuration

`.env.example` is organised in labelled blocks by Part/Phase (Phase 7 budgets,
Phase 6 caps, Phase 4 media, Phase 8 retention). Part 6 will add two more
blocks in the same style: **Redis** and **Supabase**.

Existing knobs that matter here: `CACHE_MAX_ENTRIES`, `CACHE_DISABLED`,
`RATE_LIMIT_DISABLED`, `RATE_LIMIT_<DOMAIN>_LIMIT|_WINDOW_MS`,
`REALTIME_CAP_*`, `INFRA_BUDGET_CACHE_COMMANDS=500000` (already references the
Upstash free tier — good, the budget hook exists).

## A10. Audit summary — what Part 6 must and must not do

**Must:** add a Redis provider behind the existing interface; version the cache
keys; make rate limits, idempotency and locks shared; add a Supabase provider
boundary; keep identity canonical; document migration and failure behaviour;
extend the admin dashboard.

**Must not:** rewrite the app; replace MongoDB; introduce microservices,
Kubernetes, Kafka or Elasticsearch; change authentication; delete Mongo data;
attempt distributed transactions; expose provider credentials to the frontend.

---

# PART B — DECISIONS REQUIRING A RECORDED CHOICE

## B1. Cache namespace format

Brief asks for `cache:event:{eventId}` **and** `v1:event:{id}`. These are
combined into one prefix:

```
eh:v1:cache:event:{eventId}
└┬┘ └┬┘ └──┬──┘ └────┬────┘
 │   │     │         └── domain + id
 │   │     └──────────── key class (cache | rl | idem | lock | temp)
 │   └────────────────── schema version — bump to invalidate everything
 └───────────────────── app namespace — avoids collisions on a shared Redis
```

Examples: `eh:v1:cache:event:665f…`, `eh:v1:rl:AUTH:u:665f…`,
`eh:v1:idem:u:665f…:abc123`, `eh:v1:lock:certificate:665f…`.

Bumping `v1 → v2` invalidates the entire cache with one env change, which is
exactly the migration safety the brief asks for.

## B2. Cache entry registry

The TTL registry becomes structured, and the test suite asserts that **every**
key produced by the builder has a registry row with all four fields:

```js
REGISTRY = {
  EVENT: { ttl: 3*60*1000, owner: "event",        privacy: "public",
           invalidatedBy: ["event:update", "event:publish", "event:delete"] },
  FEED:  { ttl: 60*1000,   owner: "feed",         privacy: "private",
           invalidatedBy: ["post:create", "follow:change"] },
  …
}
```

`privacy: "private"` is cross-checked against `PRIVATE_PREFIXES`, so a key
cannot be classified public while living under a private prefix.

## B3. `eventInterest` — deliberate exception

The brief lists `event_interests` in the Supabase schema, but it is
`(event, user)` — an edge between the **event core** (Mongo) and a user.
Putting it in Postgres would split one relationship across two databases with
no benefit. **Decision: keep `eventInterest` in MongoDB**, and document the
deviation with the reason. Everything else in the brief's §8 list moves.

## B4. Supabase identity

Deterministic UUIDv5 from the Mongo ObjectId, namespace fixed at deploy time:

```
profiles.id  = uuidv5(EVENTHUB_UUID_NAMESPACE, "user:" + mongoObjectIdHex)
```

Pure function → no mapping table, no lookup, derivable offline from either
side. `profiles.eventhub_user_id text UNIQUE NOT NULL` keeps the raw ObjectId
for traceability and reconciliation.

## B5. Consistency model

No distributed transactions. Every cross-provider mutation follows the same
shape, and each step is individually retry-safe:

1. Mongo business write (source of truth)
2. Outbox row in Mongo (`{ aggregate, event, payload, status, attempts }`)
3. Retry-safe consumer projects to Supabase
4. Cache invalidation (Redis)
5. Notification

Because Mongo is authoritative, a failed projection is replayable from the
outbox — the Supabase side is a derived read model, never the judge of truth.

---

# PART C — IMPLEMENTATION PHASES

Rule for every phase: **write the selftest in the same phase**, and re-run the
full Part 5 battery (561 assertions + 6 e2e) before committing. No existing
test may be removed or weakened.

### Phase 0 — Audit & plan ✅ (this document)

### Phase 1 — Redis provider + key architecture (brief §1, §3)
- `backend/providers/redis/` — `UpstashRedisProvider` implementing
  `CacheProvider` over Upstash REST (`fetch`, no vendor SDK, no new deps).
- `CACHE_PROVIDER=memory|upstash` selection; **boot must not fail** when Redis
  is unreachable — degrade to memory and count the fallback.
- Versioned, namespaced key builder + structured registry (B1, B2), covering
  event / event-counts / feed / profile / community / community-members /
  leaderboard / search.
- Credentials stay server-side; a guard test asserts no Redis env var is
  referenced anywhere in `frontend/`.
- Selftest: `tests/phase10.selftest.js` §1–§3.

### Phase 1 — RESULT: ✅ **DONE** (89/89 selftest)

**`backend/providers/redis/upstash.provider.js`** — Upstash REST client
implementing the existing `CacheProvider` interface. **No vendor SDK, no new
dependencies**: Upstash speaks HTTP, so this is plain `fetch` sending commands
as a JSON array in the POST body rather than URL-encoded in the path (our keys
contain colons, slashes and braces). Commands batch through `/pipeline` so the
live key and its SWR shadow are written as an atomic pair.

Three decisions worth recording:
- **The provider throws; it does not swallow.** Deciding what to do when Redis
  is broken belongs to the resilient wrapper, not the transport — that
  separation is what makes the fallback independently testable.
- **SWR is emulated with a `::stale` shadow key.** Redis cannot return a value
  that has already expired, which is exactly what stale-while-revalidate
  needs. Every `set` writes both, in one pipeline.
- **`delPrefix` reports LOGICAL entries, not physical keys.** Counting shadow
  keys would make Redis report double the memory provider's number for
  identical work, so the two providers would disagree for no caller-visible
  reason.

**`services/cache.service.js`**
- `CACHE_PROVIDER=memory` (default) | `upstash`. Verified to boot and serve
  with Redis absent, unconfigured, **and** pointed at a dead endpoint.
- `ResilientCacheProvider` wraps Redis with memory behind a **circuit
  breaker**. The breaker is not decoration: a per-operation `try/catch` would
  pay the full network timeout on every cache read during an outage — a
  latency cliff across the whole app — whereas the breaker fails fast and
  probes periodically to notice recovery. Every degradation increments a
  counter for the dashboard.
- Key format `eh:v1:cache:event:{id}`. Bumping the version invalidates the
  entire cache via one env change.
- Registry now declares **owner + ttl + invalidatedBy + privacy**, asserted
  complete for every entry. The numeric `TTL` map is **derived** from the
  registry so the two cannot drift — it stays numeric because repositories
  pass `TTL.X` straight into `getOrSet`.

**Compatibility work (the real cost of this phase).** The facade became async
because Redis makes every cache operation a network round-trip. 19 src call
sites updated to `await`; invalidators made **awaitable but non-rejecting** so
the ~20 existing fire-and-forget invalidation calls stay valid without adding
a Redis round-trip to write paths. 4 existing tests updated to await the
now-async facade — **no assertion removed or weakened**.

**Results:** phase10 **89 passed, 0 failed**. Full regression: **650
assertions across 10 suites, 0 failed**; e2e quiz 32 · memories 15 · mgmt ✅ ·
live 65 · social ✅ · community 38.

### Phase 2 — Distributed rate limiting (brief §4)
- `RateLimitStore` interface with memory + Redis implementations; Redis uses a
  Lua sliding window (atomic, one round-trip).
- `RATE_LIMIT_PROVIDER=memory|upstash`. All 21 domains preserved; env overrides
  preserved; 429 / Retry-After / RateLimit / RateLimit-Policy preserved.
- `SlidingWindow` gains a pluggable backend so action guards and socket guards
  share counters too.
- Fail-open on Redis error (a limiter outage must not take browsing down) with
  a recorded counter.
- Multi-instance simulation: two independent limiter instances sharing one
  store see one bucket.

### Phase 3 — Distributed idempotency (brief §5)
- Redis-backed `SET NX PX` key store, same 409 semantics, same per-user scoping.
- Extend mounting to ticket issuance, bulk tickets, quiz submission and event
  submission — not just posts and registrations.
- Memory fallback when Redis is down (degraded but still dedupes per instance).

### Phase 4 — Distributed locking (brief §6)
- `DistributedLockService`: `acquire` / `release` / `withLock`, unique owner
  token, TTL, safe release (token check — never delete another owner's lock),
  timeout, fail-open or fail-closed per call site.
- Applied to: certificate generation, export generation, event finalization,
  leaderboard finalization, media cleanup.
- A test asserts no lock survives its TTL.

### Phase 5 — Supabase provider, schema & repositories (brief §7, §8, §9, §13)
- `backend/providers/supabase/` — client over REST (service-role key,
  server-side only), timing metrics, N+1 detection, repository boundary.
- `db/supabase/schema.sql` — the full §8 schema: PKs, FKs, unique constraints,
  composite indexes, CHECK constraints, timestamps, soft deletes.
- Repositories for profiles, follows, organizations, posts, comments,
  reactions, communities, conversations, messages, notifications, reports,
  blocks, achievements.
- Cursor pagination mandatory on every collection; no unbounded queries.

### Phase 6 — Migration, consistency & docs (brief §10, §11)
- `docs/SUPABASE-MIGRATION.md` — backfill → verify → dual-read → cutover,
  with the "never delete Mongo data until independently verified" rule and a
  rollback path.
- `docs/REDIS-ARCHITECTURE.md`
- `docs/DISTRIBUTED-SYSTEMS.md`
- Outbox + reconciliation job; retry-safe consumers.

### Phase 7 — Failure behaviour & observability (brief §15, §16)
- Verify graceful degradation for Redis, Supabase, Mongo, Cloudinary and R2
  unavailability. Core event functionality survives where possible.
- Extend `/api/admin/infrastructure` with `redis` (availability, latency, hit
  ratio, commands, errors, fallback count) and `supabase` (latency, query
  count, errors, connection health, slow queries). Admin-only.

### Phase 8 — Testing (brief §17)
- `tests/phase10.selftest.js` — Redis hit/miss, fallback, distributed rate
  limiting, distributed idempotency, lock acquire/release, invalidation,
  private isolation, Supabase CRUD, pagination, authorization, consistency,
  retry, provider failure, multi-instance simulation.
- **All 561 existing assertions and all 6 e2e suites must still pass.**

### Phase 9 — Final report
- `PART6_FINAL_REPORT.md`.

---

# PART D — STANDING RULES

- MongoDB remains the source of truth for the event/registration/quiz/live
  domain. Nothing is deleted from Mongo until a migration is independently
  verified.
- No permanent business data in Redis. Redis is shared *ephemeral*
  infrastructure only.
- The frontend never talks to Redis, Supabase, Cloudinary or R2. It talks to
  the EventHub API.
- No provider credential ever reaches the frontend or a log line.
- Errors never expose provider names, credentials or stack traces.
- No distributed transactions: idempotency, outbox, retry-safe consumers,
  reconciliation, eventual consistency.
- Rate limits must never make normal browsing unusable.
- Every phase ships with its own selftest and a full regression run.
