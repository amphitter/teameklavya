# EVENTHUB PART 6 COMPLETE

**Upstash Redis as shared infrastructure + Supabase PostgreSQL for the
relational/social domain**
Date: 2026-10-07 · 13 commits · 9 phases

---

## 1. Executive summary

Part 6 made EventHub behave like a horizontally scalable production system
**without ceasing to be a modular monolith**.

- **Redis (Upstash)** now backs four things that previously lived per-instance:
  cache, rate limiting, idempotency and distributed locks. Two instances
  behind a load balancer now share one view of all four.
- **Supabase (PostgreSQL)** now has a complete schema, provider and repository
  layer for the relational/social domain — profiles, follows, organizations,
  posts, communities, direct messages, notifications, moderation.
- **MongoDB was not replaced.** It remains the source of truth for events,
  registrations, quiz state and live sessions, and it still serves the social
  domain today.
- **No data has migrated.** The migration machinery is built and tested end to
  end; `SYNC_ENABLED` defaults to false. Running it is a human decision,
  gated by an 8-step runbook.

No microservices. No Kubernetes. No Kafka. No Elasticsearch. No distributed
transactions.

### Numbers

| | |
|---|---|
| Commits | 13 |
| New files | 27 |
| New assertions | **363** (phase10 selftest) |
| Pre-existing assertions | **561 — unchanged** (§17 floor: all pass) |
| **Total** | **924 across 10 suites, 0 failed** |
| e2e suites | 6/6 pass |
| New dependencies | **0** |

---

## 2. Phases

| # | Phase | Commit | Result |
|---|---|---|---|
| 0 | Infrastructure audit & plan | `8609011` | ✅ |
| 1 | Redis provider + key architecture | `9fff130` | ✅ |
| 2 | Distributed rate limiting | `8ec8695` | ✅ |
| 3 | Distributed idempotency | `8cb5f07` | ✅ |
| 4 | Distributed locking | `6d1b6a2` | ✅ |
| 5 | Supabase provider, schema & repositories | `4cace0b` | ✅ |
| 6 | Outbox, reconciliation & migration docs | `123ad7c` | ✅ |
| 7 | Failure behaviour & observability | `e1fe913` | ✅ |
| 8 | Testing (multi-instance, authorization) | `5a16e83` | ✅ |
| 9 | This report | — | ✅ |

---

## 3. Redis as shared infrastructure (§1–§6)

### 3.1 Provider (Phase 1)

`providers/redis/upstash.provider.js` — Upstash over plain `fetch`.
**No vendor SDK, no new dependencies.** Commands go as a JSON array in the POST
body, not in the URL path, because our keys contain colons, slashes and braces.

The provider **throws**; a `ResilientCacheProvider` circuit breaker decides.
That separation is what made fallback independently testable. A breaker rather
than per-call try/catch: a per-call catch pays the full network timeout on
*every* cache read during an outage — a latency cliff. The breaker fails fast
and probes for recovery.

**Key architecture (§3).** `services/cache.service.js` owns a `CACHE_REGISTRY`
declaring, per domain: owner, TTL, what invalidates it, and whether it is
private. The numeric TTL map is *derived* from the registry so the two cannot
drift. Prefix `eh:v1:` is versioned, so a format change is a namespace swap
rather than a migration. **Private keys are never served stale** — SWR is
refused outright, because serving one user's feed to another is a data leak no
amount of TTL tuning fixes.

### 3.2 Rate limiting (Phase 2) — 18 domains

One sliding-window primitive shared by both the HTTP limiters and the
socket/action guards, so there is one algorithm to fix. The window runs in
**Lua inside Redis**, not read-modify-write from the app: RMW races (two
instances both read "9 of 10" and both allow) and costs two round trips.

**The always-count contract.** The first version returned the pre-hit count
when full, so the 11th hit reported 10 — not `> 10` — and *every* limit was
effectively `limit + 1`. Both backends now always record the hit and report
`allowed` separately.

**Fails open.** A rate-limiter outage that blocks all traffic is a
self-inflicted outage, worse than temporarily absent rate limiting.

### 3.3 Idempotency (Phase 3)

One atomic command: `SET key value NX PX ttl`. `NX` is conditional and Redis
executes it atomically, so two instances racing cannot both win. No
read-then-write window. Keys are scoped per user, so one user's retry can never
block another's.

**Failure policy deliberately differs from rate limiting:** rate limiting fails
open; idempotency falls back to per-instance memory and, if even that fails,
**refuses the write**. The worst case is a duplicate registration, a double
payment, or two tickets for one seat.

### 3.4 Locking (Phase 4)

`DistributedLockService` with the five required properties: unique UUID owner
token · TTL on every write · compare-and-delete release (never a bare `DEL`) ·
bounded timeout · explicit `onUnavailable: "proceed" | "abort"` per call site.
`withLock` returns `{ran, locked, result?, reason?}` — **`ran: false` is always
reported, never swallowed**, because a silently skipped export is a bug.

Wired to exactly three sites where mutual exclusion is genuinely required:

| Site | Why a lock, not something cheaper |
|---|---|
| Media sweeper | Two overlapping sweeps select the same candidates and both delete |
| Admin users CSV export | Full-table read into RAM; concurrent builds are pure waste |
| `event:end` finalization | The `liveState` guard is a non-atomic check-then-act |

**Deliberately not locked:** certificate generation (already an atomic
`$setOnInsert` upsert) and the streaming registration export (bounded memory;
holding a lock for a multi-minute stream is worse than the duplicate work). A
unique index is atomic, free and cannot deadlock, so it is preferred wherever
it can express the rule.

---

## 4. Supabase for the relational domain (§7–§9, §13)

### 4.1 Schema

`db/supabase/schema.sql` — **25 tables, 51 FKs, 31 CHECK constraints, 48
indexes, 17 triggers.** Validated with `sqlglot` plus checks that no FK, trigger
or index references a missing table or column.

**§9 identity: `profiles.id` TEXT PRIMARY KEY holding the canonical EventHub
id.** No mapping table, because a mapping table *is* a second identity. It
costs 24 bytes/key versus a UUID's 16; accepted and documented in the schema
header.

**RLS deliberately omitted.** Authorisation lives in the tested API layer;
duplicating it as policies creates two sources of truth that can disagree. The
service-role key bypasses RLS, so leaving it off is not a risk today.

**Cross-store ids (events) are TEXT, never FKs.** A foreign key across two
databases cannot be enforced, and pretending otherwise is a silent-data bug
waiting to happen.

**Counters are trigger-maintained**, so no code path can forget one. This is
also why the Postgres feed is strictly cheaper: `likes_count`/`comments_count`
ride on the posts row, so attaching them costs zero extra queries where Mongo
needed two aggregations per page.

### 4.2 Provider & repositories

`providers/supabase/` — the boundary. **The service-role key is read in
exactly one module**, and `supabaseStats()` never exposes the key, the host, or
upstream error text.

`repositories/supabase/` — 14 repositories, each mirroring its MongoDB
counterpart's method surface, so Phase 6's cutover is a one-line swap in
`repositories/index.js` rather than a controller rewrite (§66).

**One pagination dialect.** The Supabase repositories reuse
`repositories/cursor.js` verbatim, so a client cannot tell which store
answered — asserted by envelope-shape equality against `cursor.buildPage()`.

---

## 5. Consistency without distributed transactions (§10, §11)

```
Mongo write ──▶ outbox entry ──▶ claim (atomic) ──▶ re-read Mongo ──▶ upsert
                     │                                    │
                     └──────── reconciliation ────────────┘
```

### The decision everything follows from

**The outbox entry holds a reference, not a payload copy.** Every apply
re-reads current Mongo state. Three consequences:

1. **Ordering stops mattering.** Two queued changes to one entity land on the
   same final state either way. A payload-carrying outbox would let an
   out-of-order apply resurrect stale fields — a bug that appears only under
   load and is near-impossible to reproduce.
2. **Retry is trivially correct** — re-processing re-reads reality.
3. **Deletes handle themselves** — a source row gone at apply time removes the
   target instead of writing from memory.

### The limitation we do not paper over

**Enqueue is not atomic with the business write.** This codebase uses no
MongoDB multi-document transactions, so a crash between the two loses the entry.

We state this in the model, the docs and the plan rather than implying the
outbox is sufficient. **Reconciliation is a correctness requirement, not an
optimisation** — it is the only thing standing between a crash and silent data
loss. The outbox gives prompt propagation; reconciliation gives the guarantee.

### Migration status: prepared, not executed

`SYNC_ENABLED` defaults to false. Nothing is wired to a controller.
`docs/SUPABASE-MIGRATION.md` defines 8 gates: prepare → schema → backfill →
drain → **verify** → dual-read → cutover → retire.

The governing rule: **never delete MongoDB data until it has been independently
verified.** `scripts/verify-supabase.js` is a separate second opinion that reads
both stores, compares counts *and* field-level content, and exits non-zero on
drift. There is no `--delete-source` flag anywhere; retiring source data is a
manual human act.

**Backfill enqueues rather than writing directly**, so the data you verify is
the data the live path produces. A separate backfill write path would make
dual-read verification meaningless.

---

## 6. Failure behaviour & observability (§15, §16)

### Degradation, verified

| Component | On failure |
|---|---|
| Redis (cache) | Serves from Mongo via circuit breaker — slower, correct |
| Redis (rate limit) | **Fails open** — blocking traffic is a self-inflicted outage |
| Redis (idempotency) | Memory fallback; refuses if that fails too |
| Redis (locks) | `onUnavailable` per call site |
| Supabase | Social degrades; **events unaffected** |
| Cloudinary / R2 | Clean `StorageUploadError`, no raw provider errors |

**Events survive a social-store outage** — the practical payoff of the split.

### Dashboard panels (admin-only)

`GET /api/admin/infrastructure` gained `redis` and `supabase`, still gated by
`requireAuth, requireAdmin`.

**The redis panel aggregates all four consumers, not just the cache.** The
Part 5 cache panel reports occupancy; it would show green while the rate
limiter, idempotency store and lock service were all silently degraded.

Health is **inferred, never pinged**. A synthetic PING adds latency to an admin
click, can fail for reasons unrelated to the provider, and worst of all reports
OK while every real call is falling back.

**Intent vs reality — the signal worth knowing about.** `CACHE_PROVIDER=upstash`
with no `UPSTASH_REDIS_REST_URL` makes every consumer boot into memory. Nothing
errors, so the system looks healthy, but every cross-instance guarantee Part 6
exists to provide is silently gone. The panel reports `configured` (what env
intends) and `backends` (what consumers are actually on), raising at least a
WARNING when they disagree. This is the class of fault that otherwise surfaces
weeks later as *"why did two instances both issue the same ticket?"*

**The supabase panel includes the outbox backlog**, because Supabase health and
outbox health are one question from two ends: a growing backlog with a healthy
Supabase means the consumer is at fault; a healthy backlog with an erroring
Supabase means the store is. Dead-lettered entries escalate straight to
CRITICAL — silent data loss is the one outcome the outbox exists to prevent.

---

## 7. Testing (§17)

Most of §17 landed incrementally with each phase — deliberately, because a test
written alongside the code it covers catches the bug while the context is fresh.

**Regression floor held exactly:**
```
21 + 22 + 44 + 37 + 70 + 87 + 83 + 82 + 115 = 561   (pre-existing, unchanged)
                                        + 363       (phase10, new)
                                        = 924       total, 0 failed
```

**Multi-instance simulation (§26).** Two `DistributedLockService` instances
sharing one Redis runner but each holding its **own** memory fallback — the
separate fallbacks are what make them separate processes; sharing a backend
object would let them see each other's in-process state and prove nothing.
Asserted: A acquires, B refused, A releases, B acquires; idempotency refused
across instances; the rate-limit bucket is shared, so two instances get 5 calls
between them, not 10. The counter-example is asserted too: with no shared store,
**both** instances acquire the same lock.

**Authorization & the frontend boundary (§27).** No frontend file imports a
Supabase client or hardcodes a JWT-shaped key. The service-role key is read in
exactly one backend module. `role` is constrained by the database rather than
trusted from a client.

---

## 8. Bugs found and fixed

### In implementation code

1. **Lua off-by-one vs express-rate-limit.** Returning the pre-hit count when
   full meant the 11th hit reported 10, which is not `> 10`, so every one of
   the 18 limits allowed `limit + 1`.
2. **`scrub()` did not redact Postgres DSNs.** A connection string is a
   credential (host + user + password) and Postgres errors echo it.
3. **`community_members` missing the `id` tiebreaker** in its keyset index.
   `created_at` is not unique, so two members joining in the same instant could
   straddle a page boundary and one would be silently lost.

### In the test harness (found by tests that failed)

4. **Fake Upstash `SET … NX PX` read the TTL from index 4** — the literal
   `"PX"` flag — giving `Number("PX") === NaN` and making every conditional key
   immortal. The Phase 3 idempotency TTL assertions had been passing vacuously.
5. **Fake PostgREST did not implement upsert**, so every idempotence assertion
   passed against a strawman that created a new row per insert.
6. **Dead-letter test mutated `attempts` in memory without persisting it**, so
   it never reached `maxAttempts`.
7. **Service-role-key detector matched the bare string**, flagging a helpful
   error message in a script — which would have discouraged exactly the
   actionable failure text we want.

Numbers 4 and 5 are the important ones: in both cases **the tests were passing
while proving nothing.** A green suite is only meaningful if the double behaves
like the real system.

---

## 9. Configuration surface

| Variable | Default | Purpose |
|---|---|---|
| `CACHE_PROVIDER` | `memory` | `memory` \| `upstash` |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | — | Required for the Redis path |
| `RATE_LIMIT_PROVIDER` | = `CACHE_PROVIDER` | Rate-limit backend |
| `IDEMPOTENCY_PROVIDER` | = `CACHE_PROVIDER` | Idempotency backend |
| `LOCK_PROVIDER` | = `CACHE_PROVIDER` | Lock backend |
| `SUPABASE_URL` | — | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **Server-side only**, never to the browser |
| `SUPABASE_MAX_ROWS` | `1000` | Hard ceiling on any single read |
| `SUPABASE_TIMEOUT_MS` | `8000` | |
| `SUPABASE_NPLUSONE_THRESHOLD` | `20` | Queries per request before warning |
| `SYNC_ENABLED` | `false` | **Gates applying outbox entries** |
| `OUTBOX_LEASE_MS` | `60000` | Lease before a stalled entry is retried |

**Every one is optional.** With none set, the app boots exactly as it did
before Part 6, serving the social domain from MongoDB.

---

## 10. Known limitations (stated, not hidden)

1. **Enqueue is not atomic with the business write.** Reconciliation is the
   guarantee, not an optimisation.
2. **Ordering is not guaranteed** across outbox entries. Safe by design, because
   the consumer re-reads rather than replaying.
3. **Counters converge eventually, not instantly** — trigger-maintained in
   Postgres, application-maintained in Mongo.
4. **No RLS.** Authorisation lives in the API layer. Revisit only if a key ever
   reaches a client.
5. **No data has migrated.** Everything Supabase-side is prepared and tested,
   awaiting a human.
6. **The Redis Socket.IO adapter is still not adopted** (§12). The abstraction
   exists; adopt when horizontal realtime is actually required.

---

## 11. Delivery inventory

**Redis (`backend/providers/redis/`)** — `upstash.provider.js`,
`sliding-window.store.js`, `rate-limit-store.adapter.js`,
`idempotency.store.js`, `lock.service.js`

**Supabase (`backend/providers/supabase/`)** — `client.js`, `index.js`

**Schema** — `backend/db/supabase/schema.sql`

**Repositories (`backend/repositories/supabase/`)** — `base.repository.js`,
`profile`, `organization`, `community`, `post`, `message`, `notification`,
`moderation`, `index.js`

**Consistency (`backend/services/`)** — `outbox.service.js`,
`social-sync.service.js`; `backend/models/outbox.model.js`

**Scripts** — `backend/scripts/backfill-supabase.js`, `verify-supabase.js`

**Docs** — `SUPABASE-MIGRATION.md`, `REDIS-ARCHITECTURE.md`,
`DISTRIBUTED-SYSTEMS.md`

**Modified** — `services/cache.service.js`, `services/infrastructure.service.js`,
`middleware/idempotency.js`, `config/rate-limits.js`,
`utils/frequency-limiter.js`, `controllers/admin.controller.js`,
`services/realtime.service.js`, `scripts/media-sweeper.js`, 6 route files,
`.env.example`

---

## 12. Build status

```
PLATFORM        21 passed, 0 failed
PHASE 2         22 passed, 0 failed
PHASE 3         44 passed, 0 failed
PHASE 4         37 passed, 0 failed
PHASE 5         70 passed, 0 failed
PHASE 6         87 passed, 0 failed
PHASE 7         83 passed, 0 failed
PHASE 8         82 passed, 0 failed
PHASE 9        115 passed, 0 failed
PHASE 10       363 passed, 0 failed
─────────────────────────────────────
TOTAL          924 passed, 0 failed

e2e: quiz 32 · memories 15 · mgmt ✅ · live 65 · social ✅ · community 38
```

**Hard rules enforced:** no microservices · no Kubernetes · no Kafka · no
Elasticsearch · MongoDB not replaced · no distributed transactions · no
permanent business data in Redis · no manual Redis keys in controllers ·
frontend never depends on Supabase · no permanent locks · no removed or
weakened tests · no faked data (§72) · no infrastructure leaks to users (§61).
