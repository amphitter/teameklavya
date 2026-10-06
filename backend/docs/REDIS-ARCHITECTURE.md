# Redis Architecture

**Part 6, Phases 1–4 — brief §1–§6**
Provider: Upstash, 256 MB, 500K commands/month, accessed over HTTP.

---

## 1. What Redis is for

Redis is **shared infrastructure**, never a system of record.

| Use | Phase | Key namespace |
|---|---|---|
| Cache (SWR) | 1 | `eh:v1:cache:<domain>:<id>` |
| Rate limiting | 2 | `eh:v1:rl:<domain>:<id>` |
| Idempotency | 3 | `eh:v1:idem:<scope>:<key>` |
| Distributed locks | 4 | `eh:v1:lock:<name>` |

**Never stored in Redis (§2):** events, registrations, users, payments, quiz
results, messages, certificates. If Redis vanished, the product would slow down
and lose some rate-limit history — it would not lose data.

---

## 2. The provider

`CACHE_PROVIDER=memory|upstash`. One module
(`providers/redis/upstash.provider.js`) speaks to Upstash over plain `fetch`.

**No vendor SDK, no new dependencies.** The SDK pulls in a realtime stack we
are not using (§12), and PostgREST-style URL building is all we need.

Commands go as a **JSON array in the POST body**, not in the URL path — our
keys contain colons, slashes and braces, and URL-path encoding those is a bug
farm.

### Key rules
- **Keys are never built in a controller.** `services/cache.service.js` owns a
  central `CACHE_REGISTRY` declaring, per domain: owner, TTL, what invalidates
  it, and whether it is private. The numeric TTL map is *derived* from the
  registry so the two cannot drift.
- **Prefix `eh:v1:`** — versioned, so a future format change is a namespace
  swap rather than a migration.
- **Private keys are never served stale** (§14). SWR is refused outright for
  any domain marked private, because serving one user's feed to another is a
  data leak that no amount of TTL tuning fixes.

### Fallback
The provider **throws**; a `ResilientCacheProvider` circuit breaker decides.
That separation is why fallback is independently testable.

A circuit breaker rather than per-call try/catch: a per-call catch would pay the
full network timeout on *every* cache read during an outage — a latency cliff.
The breaker fails fast and probes for recovery.

---

## 3. Rate limiting (Phase 2)

18 domains in `config/rate-limits.js`. Both the HTTP limiters and the
socket/action guards share one sliding-window primitive, so there is one
algorithm to fix.

The window is computed in **Lua inside Redis**, not read-modify-write from the
app. RMW races (two instances both read "9 of 10" and both allow) and costs two
round trips; the script is atomic and costs one.

**The always-count contract:** both backends always record the hit and report
`allowed` separately. The early version returned the pre-hit count when full,
which meant the 11th hit reported 10 — not `> 10` — so *every* limit was
effectively `limit + 1`. The library blocks on `totalHits > limit` and
validates `positiveHits >= 1`, so a refused request must still increment.

**Fails open.** A rate-limiter outage that blocks all traffic is a
self-inflicted outage, worse than temporarily absent rate limiting.

---

## 4. Idempotency (Phase 3)

One atomic command: `SET key value NX PX ttl`. `NX` is conditional and Redis
executes it atomically, so two instances racing cannot both win — one gets
`OK`, the other `nil`. No read-then-write window.

Keys are scoped per user (`u:<id>:<key>`), so one user's retry can never block
another's. Only keys are stored, never response bodies.

**Failure policy deliberately differs from rate limiting:** rate limiting fails
open; idempotency falls back to per-instance memory, and if even that fails the
write is **refused**. The worst case is a duplicate registration, a double
payment, or two tickets for one seat — not worth trading for availability.

---

## 5. Distributed locks (Phase 4)

`DistributedLockService` with five properties:

| Property | Implementation |
|---|---|
| Unique owner token | random UUID per acquisition, stored as the value |
| TTL | every write uses `PX`; no TTL-less code path exists |
| Safe release | compare-and-delete Lua, never a bare `DEL` |
| Bounded timeout | `withLock` polls up to `waitMs`, then gives up |
| Explicit failure | `onUnavailable: "proceed" \| "abort"` chosen at the call site |

A bare `DEL` would let a slow holder whose lock already expired delete a
*different* owner's lock. Compare-and-delete is atomic, so this cannot happen.

`withLock` returns `{ran, locked, result?, reason?}`. **`ran: false` is always
reported, never swallowed** — a silently skipped export is a bug.

Used only where mutual exclusion is genuinely required (media sweeper, export
generation, event finalization). A unique index is atomic, free and cannot
deadlock, so it is preferred wherever it can express the constraint.

---

## 6. Command budget

500K commands/month is the binding constraint, not the 256 MB.

| Operation | Commands | Notes |
|---|---|---|
| Cache get | 1 | pipeline writes 2 (live key + `::stale` shadow) |
| Rate limit check | 1 | Lua, one round trip |
| Idempotency claim | 1 | `SET NX PX` |
| Lock acquire | 1 | `SET NX PX` |
| Lock release | 1 | `EVAL` |

The `::stale` shadow doubles cache *writes* but makes SWR possible: on expiry
the stale value is served while one request refreshes, so a hot key never
stampedes. Worth the commands.

**Not yet adopted (§12):** the Redis Socket.IO adapter. Real time is
single-instance today; the abstraction exists and the adapter is a config change
when horizontal realtime is actually required — not before.
