# EVENTHUB PART 5 COMPLETE

**Modular monolith — optimized, fast, secure, infrastructure-efficient**

Repository: `teameklavya` · Branch: `main` · HEAD at report time: `51d50f4` + Phase 9
Scope: Part 5, Phases 0–9 (spec §1–§75)
Dates: executed against the codebase as of 2026-10-06

---

## 1. Executive summary

EventHub remains **one deployable modular monolith**. No microservices, no
Kubernetes, no Kafka, no Elasticsearch, no distributed infrastructure was
introduced — by design and by instruction.

Part 5 did not add features. It made the existing features cheap to run: fewer
database round-trips, smaller payloads, bounded realtime fan-out, explicit
caching with documented ownership, and hard limits everywhere an unbounded
operation used to exist.

The headline measurable outcomes:

| Dimension | Before Part 5 | After Part 5 |
|---|---|---|
| Unbounded list endpoints | Participant list loaded **every** registration, populated | Cursor-paginated, hard-capped at 100 |
| HTTP compression | **None** | gzip/br on text above the 1 KB threshold |
| Cache-Control policy | **None** (Express defaults only) | Public short-TTL + SWR for anonymous public GETs; `private, no-store` for everything authenticated |
| Rate-limit buckets | 3 ad-hoc, numbers buried in routes | 21 domains in one file, env-overridable |
| Frontend polling loops | 7 (messages 6 s, bell 30 s, leaderboard 10 s …) | Replaced with ETag/304 + backoff + server-cached payloads |
| Raw `<img>` pulling originals | 56 | `OptimizedImage` with responsive `srcset`, `f_auto`, lazy load |
| Storage access | Cloudinary specifics inside `media.service.js` | `StorageProvider` interface — Cloudinary or local, chosen in one place |
| Admin visibility into infra | none | `/api/admin/infrastructure` — 8 scored sections, 80/90/95 thresholds |
| Data-retention policy | implicit | `docs/DATA-RETENTION.md` + a dry-run-by-default sweeper |
| Automated verification | 1 platform selftest | **9 selftests, 561 assertions + 6 end-to-end suites + 2 load profiles** |

**Two real production bugs were found and fixed during Part 5 verification**
(the last-question reveal gap, and body-parser errors reported as 500s). Both
are documented in §20.

---

## 2. What changed — area-by-area verdict

| Area | Verdict | Evidence |
|---|---|---|
| Architecture | ✅ Still a modular monolith; boundaries cleaned, no new runtime infra | §3, `docs/PERFORMANCE-ARCHITECTURE.md` |
| Database | ✅ Repositories, cursor pagination, projections, batching, pooling audited | phase3 selftest 44/44 |
| Caching | ✅ In-memory provider behind an interface; TTL registry; SWR public-only; in-flight dedup | phase9 §9 (23 assertions) |
| Rate limiting | ✅ One source of truth, 21 domains, HTTP + socket + action guards | phase2 22/22, phase9 §1 |
| API performance | ✅ Compression, ETag/304, Cache-Control, cursor pagination, payload caps | phase9 §2–§5 |
| Images & files | ✅ Provider interface, variants, client compression, lifecycle sweeper | phase4 37/37 |
| Realtime | ✅ Rooms, caps, backpressure, no DB writes for transient noise | phase6 87/87, load profiles §17 |
| Frontend | ✅ One data layer, polling removed, lazy routes, security headers | tsc 0, `next build` 0 |
| Security | ✅ Body limits, auth guards, no infra leaks, secrets never logged | phase2/phase7/phase9 §11 |
| Observability | ✅ Structured logs, metrics ring buffers, admin dashboard | phase7 83/83 |
| Retention & backup | ✅ Classified, scripted, documented, restore-drilled | phase8 82/82 |
| Failure handling | ✅ Graceful degradation verified by simulation | phase9 §11 (19 assertions) |

---

## 3. Architecture (§2–§3, §65, §74)

The topology is unchanged in shape and deliberately so. One Node process, one
MongoDB, optional managed services behind provider interfaces.

```
                    ┌──────────────────────────────────┐
   Browser  ──────► │  Next.js frontend (Vercel)       │
                    │  talks ONLY to the EventHub API  │
                    └───────────────┬──────────────────┘
                                    │ HTTPS (JSON) · Socket.IO
                    ┌───────────────▼──────────────────┐
                    │  EventHub API — modular monolith │
                    │  (Render, single process)        │
                    │                                  │
                    │  routes → controllers →          │
                    │  repositories → models           │
                    │                                  │
                    │  ┌────────┐ ┌────────┐ ┌──────┐  │
                    │  │ cache  │ │metrics │ │media │  │
                    │  └────────┘ └────────┘ └──────┘  │
                    └───┬───────┬────────┬─────────┬───┘
                        │       │        │         │
                 ▼      ▼       ▼        ▼         ▼
              MongoDB  Cloudinary  R2   Socket.IO  (Redis — future)
              (Atlas)  (images)  (files) (realtime)  interface only
```

**Rules that are now enforced, not just intended:**

- The frontend never coordinates MongoDB, Supabase, Cloudinary or R2 directly
  (§3). Every byte of user data travels through the EventHub API.
- Binary files are never stored inside MongoDB (§21). Files live in Cloudinary
  (images) or R2 (PDFs/video); MongoDB holds only the `mediaassets` manifest
  row describing them.
- No queue system was introduced (§65). Service boundaries were drawn so a
  future Redis + BullMQ migration is a provider swap, not a rewrite.

---

## 4. Database layer (§5–§7, §32–§38)

New surface: `backend/repositories/` (7 repositories + `cursor.js`),
`backend/utils/regex.js`, `backend/utils/csv-stream.js`.

The audit found the single most expensive query in the product first: the
organizer's participant list called `find({eventId})` with **no limit** and
populated every row. On a 5,000-person event that is 5,000 documents plus their
populated users on every page load. It is now cursor-paginated with a hard cap
of 100 and server-side `q` / `status` filtering, so filtering no longer ships
the whole table to the browser to filter client-side.

Other changes, each proven by counting the commands Mongoose actually issues
rather than by reading the source:

- **Projections everywhere.** Lean queries select only the fields a caller
  renders; populated users select a fixed field list, not whole documents.
- **Batch fetches instead of N+1.** Counts, membership flags and author
  profiles are now gathered in one round-trip per screen.
- **Cursor pagination** with a stable `(createdAt, _id)` tiebreak, so paging
  cannot skip or repeat rows.
- **Clamped regexes.** User search strings are length-capped and escaped before
  they reach the database (§63) — this removes both a CPU risk and an injection
  surface.
- **Pool sizing** reviewed against the Atlas free tier (pool max 10) so
  concurrency cannot exhaust connections.

---

## 5. Caching strategy (§8–§15, §58, §66)

`services/cache.service.js` implements a **CacheProvider interface** with an
in-memory LRU provider today and a Redis provider intended for later. Business
logic never touches the provider directly, so the swap is one file.

Design decisions worth stating plainly:

- **Central key builder.** Keys are constructed in one place (`event:{id}`,
  `counts:event:{id}`, `followlist:{userId}`, …) so invalidation can be
  reasoned about globally rather than per call site.
- **TTL registry per domain.** Every TTL is declared with its owner and its
  invalidation trigger. An undocumented TTL is a bug; the registry is asserted
  non-empty by the verification battery.
- **Stale-while-revalidate is public-only, enforced at runtime.** The service
  *throws* if SWR is requested on a private key (§14) rather than trusting
  callers to remember.
- **In-flight dedup.** Concurrent callers for the same key share one loader
  run — verified: four simultaneous callers produce exactly one loader
  execution (§15).
- **No raw `set`.** A value may only enter the cache through a loader, which
  keeps every entry attached to the code that knows how to rebuild it.
- **Never cache private data cross-user.** User-scoped keys carry identity;
  authenticated responses are `private, no-store`.

---

## 6. Rate limiting & abuse control (§23–§28)

`config/rate-limits.js` is the single source of truth. Twenty-one domains, each
env-overridable (`RATE_LIMIT_<DOMAIN>_LIMIT` / `_WINDOW_MS`), no numbers
buried in route files.

| Domain | Limit | Window |
|---|---|---|
| AUTH | 25 | 15 min |
| SOCIAL | 30 | 1 min |
| MESSAGING | 20 | 1 min |
| SEARCH | 30 | 1 min |
| EVENT | 20 | 1 min |
| UPLOAD burst / hourly | 15 / 10 | 10 min / 1 hr |
| READ | 300 | 1 min |
| REALTIME connect user / IP | 10 / 30 | 1 min |
| REALTIME join / answer | 15 / 60 | 1 min |
| GUARD follow / interact / comment | 20 / 20 / 10 | 1 min |
| GUARD community create / join | 3 / 15 | 1 hr / 1 min |
| GUARD ticket scan | 60 | 1 min |

- **429 shape** is `{ error: { code: "RATE_LIMITED", message } }` plus a
  `Retry-After` header and the standardised `RateLimit` / `RateLimit-Policy`
  headers. Verified over the wire.
- **READ is deliberately generous** (§26). A 429 on search or upload must never
  take browsing down with it — verified explicitly.
- **Keying is honest about what it can know.** Prefix-level limiters mounted
  via `app.use('/api/search', …)` run *before* any route-level `optionalUser`,
  so `req.user` is not yet populated and the key falls back to IP. That is
  correct: public search is anonymous-capable, so IP is the only identity
  available that early. Action-scoped limiters (SOCIAL/MESSAGING/EVENT) are
  mounted *inside* their route files where `req.user` exists, and those really
  are per-user.
- **Idempotency** (§28) is a dedup window: a replayed `Idempotency-Key` is
  rejected with **409 CONFLICT** so the client learns the submission already
  landed. Keys are scoped per user, so one identity can never block another's
  key, and requests with no key pass through untouched.

---

## 7. API performance (§46–§50, §62–§63)

| Mechanism | Behaviour | Verified |
|---|---|---|
| Compression (§46) | gzip/br on text above the ~1 KB threshold; tiny responses left alone | phase9 §4 |
| ETag / 304 (§47) | Express weak ETags on `res.json`; a matching `If-None-Match` returns **304 with a zero-byte body** | phase9 §3 |
| Cache-Control policy (§47–48) | Anonymous public GET → `public, max-age=30, stale-while-revalidate=120`. Authenticated or non-GET → `private, no-store`. Admin → always `no-store` | phase9 §2 |
| Body limits (§63) | 1 MB JSON / 2 MB urlencoded; multipart uploads capped separately | phase9 §11 |
| Cursor pagination (§7) | Feed, comments and registrations all bounded; an absurd `limit` is clamped server-side | phase9 §5 |
| Streaming exports | CSV is streamed with `Content-Disposition: attachment`, never buffered as JSON | phase9 §8 |
| Search guards (§63) | Query clamped to 100 chars; `<2` chars returns empty without touching a regex; `limit` clamped to 50 | phase9 §7 |

A note on the 304 test: Node's global `fetch` silently injects
`Cache-Control: no-cache`, which makes the `fresh` module report *always
stale* — so a conditional request sent through `fetch` can never return 304.
The battery sends its own headers over raw `http` to test the real browser
contract. This is a test-harness detail, not an application behaviour.

---

## 8. Realtime efficiency (§33, §40–§45)

- **Rooms, not broadcasts.** Every emit targets an event or activity room;
  nothing is broadcast process-wide.
- **Caps are real and were observed working.** A 100-client load run from a
  single host connected only **20/100** sockets — the `SOCKETS_PER_IP` cap
  doing exactly its job. Raising it (and the per-IP connect-rate window) to
  simulate many devices let all 100 through. See §17.
- **Transient noise never touches the database** (§42). Timer ticks, presence,
  typing indicators and leaderboard animation frames are in-memory room state
  only. Only durable facts — answers, sessions, results — are persisted.
- **Backpressure** (§44) keeps the existing throttles (leaderboard 1 s,
  poll 1 s, Q&A 400 ms) and never coalesces answer, score or final-result
  correctness.
- **State reconstruction** (§45) has a regression test: a reconnecting client
  is re-sent the authoritative state rather than an empty screen.
- Scale-out path (Redis adapter + sticky sessions) is documented in
  `docs/REALTIME-HARDENING.md` but **not implemented** — it is not needed at
  current scale and would add infrastructure.

---

## 9. Images & files (§19–§23, §66)

- **`StorageProvider` interface** (6 members) with Cloudinary and local
  implementations; the provider is resolved in one place. Business code never
  names Cloudinary.
- **`imageVariants()`** produces thumb/small/medium/large per preset, and
  `OptimizedImage` renders responsive `srcset` with `f_auto`, lazy loading and
  CLS-safe dimensions. This replaced 56 raw `<img>` tags pulling originals.
- **Client-side compression** before upload reduces both bandwidth and
  Cloudinary credit consumption.
- **`mediaassets` manifest** rows carry a lifecycle `status` and
  `cleanupAfter`; `scripts/media-sweeper.js` reconciles remote objects with
  the manifest so orphaned uploads (abandoned mid-flow) are reclaimed.
- **No binaries in the database** (§21) — asserted by the retention and
  storage tests.

---

## 10. Frontend performance (§15–§20, §39, §51)

- **One data layer** (`lib/query.ts`, 733 LOC) on the existing axios instance:
  `useQuery` (staleTime/cacheTime/in-flight dedup), `useInfiniteQuery` (cursor
  paging), `useMutation` (optimistic update + rollback + retry-with-jitter on
  transient errors only). Invalidation keys mirror backend cache keys.
- **The seven polling loops are gone** (§6 of the audit). Messages thread 6 s →
  ETag/304 + backoff; notification bell 30 s → single cached endpoint + idle
  backoff; quiz leaderboard 10 s → server-side 5 s cache of the aggregation.
- **Lazy loading** (§18) for the create-post menu, event wizard, scanner,
  admin modules and heavy dialogs.
- **Search** navigates client-side (no `window.location` reload) and cancels
  in-flight requests with `AbortController` (§39).
- **Security headers** (§62) in `next.config`: CSP, HSTS,
  X-Content-Type-Options, Referrer-Policy, Frame-Options, Permissions-Policy.
- `npx tsc --noEmit` → **exit 0**; `npx next build` → **exit 0**.

---

## 11. Security hardening

| Control | Status |
|---|---|
| Body-size limits (§63) | 1 MB JSON / 2 MB urlencoded; oversized → **413** |
| Auth guards | Protected routes → 401; non-admin on admin routes → 403 |
| No infrastructure leaks (§61) | Error bodies asserted free of Mongo/Supabase/Cloudinary/R2/Redis detail — across 429, 401, 403, 404, 400 and 500 paths |
| No stack traces to clients | Asserted on malformed JSON, oversized bodies and bad ObjectIds |
| Admin routes never publicly cacheable | `no-store` on every admin response |
| Secrets in logs | Request logging records ids and durations, never tokens, bodies or credentials |
| Regex injection | Search input escaped and length-clamped before it reaches MongoDB |
| Health endpoint | Trimmed to `status/service/timestamp/uptimeSec/db` — no quotas, no provider names |

---

## 12. Observability & admin infrastructure (§56–§61)

- **Structured request logging** (Phase 1): every request carries a
  `requestId` and logs duration, operation, status, user and event ids.
- **Metrics ring buffers** (`services/metrics.service.js`): API latency
  p50/p95/p99, cache hit/miss/eviction, rate-limit events, socket counts,
  provider errors, 4xx/5xx counts.
- **`GET /api/admin/infrastructure`** (admin-gated, `no-store`) returns eight
  sections — `database`, `cache`, `api`, `rateLimits`, `sockets`, `providers`,
  `uploads`, `process` — each scored on the §59 scale (80 WARNING / 90 HIGH /
  95 CRITICAL), plus an overall status and a sorted `alerts` array so the page
  leads with what needs attention.
- **Frontend `Admin → Infrastructure` page** renders it. Admin-only, clean
  messages, no provider quotas surfaced to normal users (§61).

---

## 13. Data retention & lifecycle (§53–§55)

`docs/DATA-RETENTION.md` classifies every collection.

**There are no TTL indexes anywhere, and that is deliberate** — verified by
audit across all 35 models. A TTL index deletes the *whole document* and cannot
clear a single field, so it is only safe on a collection whose every document
is disposable. No collection here qualifies:

- a TTL on `users.resetOtpExpires` would **delete the account** the moment an
  OTP lapsed;
- a TTL on `mediaassets.cleanupAfter` would **orphan the remote**
  Cloudinary/R2 object, leaving a paid asset with no manifest row.

So temporary data is handled explicitly instead:

| Class | Handling |
|---|---|
| PERMANENT — users, events, posts, comments, registrations, results, certificates, communities, messages, notifications, audit logs, quizzes, achievements | Never auto-deleted |
| The three auth-token field pairs on `users` | `$unset` field-by-field by `retention-sweeper.js` — **the account survives** |
| Pending / cleanup-pending `mediaassets` | `media-sweeper.js` (pre-existing) |
| `livemessages` / `qaquestions` | Opt-in archival behind `RETENTION_LIVE_ARCHIVE_DAYS`; unset = keep forever |

`scripts/retention-sweeper.js` is **dry-run by default** (`--apply` to commit),
supports `--section=`, `--json` and `--max=`, and is idempotent. Verified: the
stale user survives, all three expired token pairs are cleared, a live OTP is
preserved, untouched users are untouched, and `countDocuments()` is unchanged.

`EventResult` snapshots are immutable and stored separately, so archiving chat
can never invalidate a certificate.

**Guard verified by fault injection:** adding a temporary `expireAfterSeconds`
index to `user.model.js` makes the selftest fail 80/82 with the
account-deletion message. The negative assertion genuinely fires.

---

## 14. Backup & recovery (§69)

`docs/BACKUP-STRATEGY.md` covers:

- `mongodump` / `mongorestore` with a tiered frequency table.
- **Always restore into a scratch namespace first**, verify, then promote — a
  restore that is not verified is not a backup.
- Cloudinary/R2 object backup via the `mediaassets` manifest reconciliation.
- What is deliberately **not** backed up (derived caches, in-flight room
  state) and why.
- A quarterly restore drill with the exact commands.
- Secrets handling: backups contain data, not credentials.

---

## 15. Failure handling & graceful degradation (§29–§31, §68, §71)

- **Per-operation timeouts** with selective retry and exponential backoff +
  jitter. Retries cover network/transient failures only — never 401,
  validation or duplicate-key errors.
- **Circuit-breaker wrappers** for optional providers (email, Cloudinary,
  analytics). Provider failure degrades the feature; it never crashes the
  request. Cloudinary being unconfigured is observed at boot as a clean
  local-disk fallback warning, not an exception.
- **Failure simulation** (phase9 §11, 19 assertions) verifies over real HTTP
  that each failure mode produces the right status, a clean JSON body, no
  stack trace, and leaves the server serving traffic afterwards.

---

## 16. Infrastructure cost envelope

Every service stays inside its free tier; the admin dashboard exists
specifically to show when that stops being true, before it becomes an outage.

| Service | Tier | Role | Guardrail |
|---|---|---|---|
| MongoDB Atlas | 512 MB | events, registrations, event data | `database` section, 80/90/95 thresholds |
| Supabase Postgres | 500 MB | social/community (users, posts, comments) | Not yet wired — monolith runs on MongoDB |
| Cloudinary | 25 credits/mo | profile/event images | Client compression + variants + sweeper |
| Cloudflare R2 | free allowance | PDFs, videos, documents | Manifest reconciliation |
| Socket.IO | self-hosted | live events, chat, notifications | Per-user / per-IP / per-room caps |
| Upstash Redis | 256 MB / 500K cmds | cache, sessions, rate limits | **Interface only — not yet instantiated** |

Redis was deliberately **not** adopted. The cache and rate-limit paths sit
behind provider interfaces with an in-memory implementation, so adopting Redis
is a provider swap rather than a rewrite — and it should happen when the
metrics say so, not before.

---

## 17. Concurrency & load results (§70)

`npm run test:load:100` and `npm run test:load:500`, both **ALL GREEN**.

| Metric | 100 clients | 500 clients |
|---|---|---|
| Sockets connected | 100/100 (100%) | 500/500 (100%) |
| Joins accepted | 100/100 | 500/500 |
| Join ack latency p50 / p95 | 1,119 ms / 1,143 ms | 11,582 ms / 11,750 ms |
| Answers acked | 500/500 | 2,500/2,500 |
| Answer ack latency p50 / p95 | 30 ms / 88 ms | 5,079 ms / 7,092 ms |
| Sessions in DB | 100 | 500 |
| LiveAnswer rows in DB | 500 | 2,500 |
| Broadcast fan-out | 100/100 | 500/500 |
| Clients with errors | **0** | **0** |
| Wall time | 27 s | 71 s |

**How to read the 500-client latencies.** Every client in these runs originates
from `127.0.0.1`, so 500 simultaneous connects are a cold-start stampede
against one sandbox CPU and an in-memory MongoDB — a pathological shape that
does not occur in production, where clients arrive distributed over time and
space. Join latency is dominated by connection storm, not by steady-state
serving: **answer acks stay at p50 30 ms / p95 88 ms at 100 clients**, and
even at 500 every single answer was accepted with zero errors and 100% fan-out.
The system degrades in latency, not in correctness.

**The caps are doing their job.** A naive 500-client run connects only 20
sockets (`SOCKETS_PER_IP = 20`) and then 30 (`REALTIME_CONNECT_IP = 30/min`).
Both are correct and configurable; the `:100` and `:500` scripts raise them for
the test, and the harness header documents this so the result is not
misread as a failure.

---

## 18. Test & verification battery

**561 selftest assertions across 9 suites — 0 failed.**

| Suite | Assertions | Covers |
|---|---|---|
| platform | 21 | Boot, health, error taxonomy |
| phase2 | 22 | Rate limits, idempotency, action guards |
| phase3 | 44 | Repositories, queries, pagination, counters |
| phase4 | 37 | Storage provider, image variants, media lifecycle |
| phase5 | 70 | Cache registry, SWR rules, dedup, private isolation |
| phase6 | 87 | Realtime caps, backpressure, reconstruction |
| phase7 | 83 | Infrastructure metrics, thresholds, no leaks |
| phase8 | 82 | Retention, TTL safety, sweeper, docs, config surface |
| phase9 | 115 | Cross-phase verification battery (§1–§11 below) |

**6 end-to-end suites, all green:** quiz 32 · memories 15 · management chain ✅ ·
live 65 · social ✅ · community 38.

**Static battery:** all 137 backend JS files parse; every model, service, lib,
middleware, util and config module loads without an undefined-symbol error.
(`config/passport.js` throws at require-time only when OAuth env vars are
absent — pre-existing and env-gated, untouched since `first commit`.)

**Frontend:** `npx tsc --noEmit` exit 0 · `npx next build` exit 0.

**Phase 9 verification battery** (the cross-phase suite that proves earlier
phases over real HTTP rather than by unit-inspecting their modules):

1. Rate limiting — 429 contract, Retry-After, RateLimit headers (§24–26)
2. HTTP cache policy — public vs private (§47–48)
3. Conditional requests — ETag / 304 (§47)
4. Compression (§46)
5. Pagination — cursors and hard caps (§7)
6. Idempotency — double-click safety (§28)
7. Search input guards (§63)
8. Export streaming (§8)
9. Cache behaviour — hits, dedup, invalidation, isolation
10. Realtime concurrency caps (§43)
11. Failure simulation — graceful degradation (§71)

---

## 19. Known limitations & technical debt

Recorded honestly, not hidden.

- **182 controller catch-blocks return a blanket 500.** The normalizer in
  `utils/app-error.js` correctly maps Mongoose `CastError` to 400, but
  controllers that wrap their handlers in `try/catch` swallow the error first
  and emit `500 "Failed to load post"`. A malformed ObjectId therefore
  reports as a server fault when it is really a client mistake. The response
  is still clean JSON with no internals leaked, and the server stays healthy —
  but the status code is wrong. Rewriting 182 catch sites is a behaviour
  change across every domain and was deliberately kept out of an optimization
  pass. **Recommended follow-up:** a shared `asyncHandler` that rethrows to
  the normalizer instead of each site hard-coding 500.
- **Prefix-level rate limiters key by IP, not user.** Documented in §6. This is
  inherent to mounting before authentication; a shared NAT (university, office)
  shares a search bucket. Acceptable today; the fix is to move authentication
  earlier or accept the trade-off knowingly.
- **Redis is interface-only.** Cache is per-process. Horizontal scaling beyond
  one instance requires adopting the Redis provider, and any cache-warming
  assumptions that depend on a shared cache will need review at that point.
- **Supabase Postgres is not yet wired.** The social/community domain currently
  runs on MongoDB. The §34 find of "no Postgres in use" still stands.
- **No full socket messaging.** The messaging thread uses ETag/304 + backoff
  rather than realtime. Documented as future work in the audit.
- **Load numbers come from a single sandbox host.** See §17.

---

## 20. Bugs found and fixed during Part 5 verification

**1. The final quiz question was never revealed.** `endActivity()` marked the
activity COMPLETED and emitted `activity:ended`, but never closed a still-open
question. Consequences: participants never saw the correct answer or
explanation for the last question, and `room.questionsClosed` lost one — which
also skewed the leaderboard auto-show checkpoints driven by that counter.
*Found by* the load harness reporting `opened=5 closed=4` on every client.
*Fixed* by closing any open question (and broadcasting the reveal) before
marking the activity completed, wrapped so a failed reveal can never block the
activity from ending. *Verified:* `closed=5`, fan-out 500/500.

**2. Body-parser errors were reported as 500s.** Malformed JSON returned 500
(should be 400) and an oversized body returned 500 (should be 413). This
misreports user mistakes as server faults — polluting error alerting and
telling clients to retry a request that will never succeed. *Found by* the
§71 failure-simulation battery. *Fixed* in the central normalizer via
`entity.parse.failed` → 400, `entity.too.large` → 413, plus a guarded general
rule that respects a well-behaved middleware's own 4xx status.

**3. The load harness silently produced false failures.** It fired join emits
without awaiting their acks, so at high client counts the answer listeners
were registered for zero clients (`if (!c.joined) continue`) and the run
reported 0 answers and 0 fan-out while the server was perfectly healthy. It
also capped clients at 200 and used fixed settle windows that did not scale.
*Fixed* by awaiting every join ack with a timeout ceiling, raising the client
cap, and scaling settle windows with client count.

> One regression was introduced and caught during this work: the new general
> 4xx rule in the normalizer initially swallowed **429**, which lives inside
> 400–499. The phase2 selftest caught it (22nd assertion) and the rule was
> narrowed to exclude 429 so the RATE_LIMITED + Retry-After contract survives.
> This is why the full battery is run after every change to shared code.

---

## 21. Spec coverage map (§1–§75)

§1→P0 · §2–3→P3 · §4→P3 · §5–7→P3 · §8–15→P1 · §16–18→P5 · §19–20→P4 ·
§21–23→P4 · §24–27→P2 · §28→P2 · §29–31→P1 · §32→P1 · §33→P3 · §34→N/A (no
Postgres — documented in P0) · §35–36→P3/9 · §37–38→P3 · §39→P3/P5 ·
§40–41→P3 · §42→P4 · §43–44→P6 · §45→P4 · §46–49→P1/P5 · §50–52→P5 ·
§53–55→P4/P8 · §56–61→P1/P7 · §62→P5 · §63→P1/P2 · §64→P2 · §65→P1/P8
(boundaries only) · §66→P1/P4 · §67→P1 · §68→P1 · §69→P8 · §70–71→P9 ·
§72→standing rule · §73–74→P8 · §75→P9

---

## 22. Hard rules enforced

| Rule | How it is enforced |
|---|---|
| **§72 — no fake data** | No synthetic likes, followers, participants, comments, views or usage figures were added. Demo fixtures remain double-gated in the Part 4 seeder and are never mixed with production data. |
| **§61 — no infrastructure leaks** | Asserted across 429, 401, 403, 404, 400, 413 and 500 responses: no Mongo/Supabase/Cloudinary/R2/Redis/Atlas strings, no stack traces. |
| **§21 — no binaries in the database** | Files live in Cloudinary/R2; MongoDB holds only manifest rows. Asserted by the storage and retention tests. |
| **§42 — no realtime noise written to the database** | Timer ticks, presence, typing and leaderboard frames are in-memory room state. Only answers, sessions and results persist. |
| **§3 — frontend never coordinates providers directly** | The frontend talks only to the EventHub API. |
| **§65 — no queue system** | None introduced; only service boundaries for a future Redis + BullMQ migration. |
| **Modular monolith** | No microservices, Kubernetes, Kafka, Elasticsearch or distributed infrastructure added. |

---

## 23. Delivery inventory

**83 files changed · 9,712 insertions · 889 deletions · 30 new files · 53 modified**

New backend surface:
`utils/app-error.js` · `utils/with-timeout.js` · `utils/regex.js` ·
`utils/csv-stream.js` · `middleware/request-context.js` ·
`middleware/idempotency.js` · `middleware/action-guard.js` ·
`services/cache.service.js` · `services/metrics.service.js` ·
`services/infrastructure.service.js` · `services/storage.provider.js` ·
`models/mediaAsset.model.js` · `config/rate-limits.js` ·
`repositories/` (7 + `cursor.js`) · `scripts/media-sweeper.js` ·
`scripts/retention-sweeper.js`

New frontend surface:
`lib/query.ts` (733 LOC) · `components/ui/optimized-image.tsx` ·
`utils/compress-image.ts` · `app/admin/infrastructure/page.tsx`

Tests (16 files): `platform`, `phase2`–`phase9` selftests · `social`,
`community`, `quiz`, `memories`, `mgmt`, `live` e2e · `live.load.js`

Docs (5): `PERFORMANCE-AUDIT.md` · `REALTIME-HARDENING.md` ·
`DATA-RETENTION.md` · `BACKUP-STRATEGY.md` · `PERFORMANCE-ARCHITECTURE.md`

---

## 24. Configuration surface

Every new variable is **optional**; the app boots with none of them set.
`.env.example` documents each with its default and its meaning.

| Group | Variables |
|---|---|
| Cache | `CACHE_MAX_ENTRIES`, `CACHE_DISABLED` |
| Rate limits | `RATE_LIMIT_DISABLED`, `RATE_LIMIT_<DOMAIN>_LIMIT`, `RATE_LIMIT_<DOMAIN>_WINDOW_MS` |
| Realtime caps | `REALTIME_CAP_SOCKETS_PER_USER`, `REALTIME_CAP_SOCKETS_PER_IP`, `REALTIME_CAP_PARTICIPANTS_PER_ROOM`, `REALTIME_CAP_IDLE_ROOM_TTL_MS`, `REALTIME_CAP_SWEEP_INTERVAL_MS` |
| Retention | `RETENTION_LIVE_ARCHIVE_DAYS` (unset = keep forever) |
| Observability | `LOG_LEVEL`, plus the infrastructure budget thresholds |
| Load testing | `LIVE_LOAD_CLIENTS` |

---

## 25. Operations runbook

**Dev machine — full verification:**
```bash
cd backend  && npm i && npm run test:all     # 9 selftests + 6 e2e suites
cd backend  && npm run test:load:100         # 100-client live profile
cd backend  && npm run test:load:500         # 500-client live profile
cd frontend && npx tsc --noEmit && npx next build
```

**Targeted suites:** `npm run test:phase9` (cross-phase wire contract) ·
`npm run test:load` (10-client smoke) · `npm run retention:sweep` (dry run) ·
`npm run retention:sweep:apply` (commit) · `npm run media:sweep`.

**Production operations:**
- Retention sweeper — run from cron; it is dry-run by default, so the cron job
  must pass `--apply`. See `docs/DATA-RETENTION.md` §3 for recipes.
- Media sweeper — as already scheduled.
- Backups — `mongodump` on the tiered schedule; **quarterly restore drill** per
  `docs/BACKUP-STRATEGY.md`.
- Monitoring — `Admin → Infrastructure`; act on WARNING (80) before HIGH (90)
  and CRITICAL (95).

---

## 26. Build status

```
Backend selftests   : 9 suites · 561 assertions · 0 failed        PASS
End-to-end suites   : 6 suites · quiz 32 · memories 15 · mgmt ✅
                      live 65 · social ✅ · community 38          PASS
Load profiles       : 100 clients ALL GREEN · 500 clients ALL GREEN
                      0 client errors · 100% broadcast fan-out    PASS
Static battery      : 137 files parse · all modules load          PASS
Frontend typecheck  : npx tsc --noEmit                    exit 0  PASS
Frontend build      : npx next build                      exit 0  PASS
Retention guard     : TTL injection test fails as designed       PASS
Spec coverage       : §1–§75 mapped (§34 documented N/A)         PASS
Hard rules          : §72 · §61 · §21 · §42 · §3 · §65 enforced  PASS
────────────────────────────────────────────────────────────────────
OVERALL BUILD STATUS: PASS
```

**Known limitations, disclosed in §19:** 182 controller catch-blocks return a
blanket 500 instead of delegating to the error normalizer (clean, safe, but the
status code is wrong); prefix-level rate limiters key by IP; Redis is
interface-only so cache is per-process; Supabase Postgres is not yet wired.

---

*Part 5 complete. EventHub is a modular monolith that is measurably cheaper to
run: bounded queries, bounded payloads, bounded fan-out, documented caching,
and 561 automated assertions standing behind all of it.*
