# LOAD TESTING

Part 7 §20 · §21 · §32.

Profiles, metrics, and the thresholds that decide "we are not ready".

**These cannot be run here.** Every profile needs a real backend, a real
MongoDB, and (for C–H) a real Redis. What follows is the harness and the
pass/fail criteria, ready to execute against a real environment.

---

## 1. Tooling

`k6` — scriptable, reports percentiles natively, and does not become the
bottleneck itself.

```bash
k6 run --out json=results.json load/profile-a.js
```

**Run the load generator from a different host than the API.** Otherwise you
are measuring the generator's CPU, not the API's.

---

## 2. Profiles

| # | Profile | Shape | What it is really testing |
|---|---|---|---|
| A | Browse | 100 rps, 95% reads (explore, event detail, feed) | Cache hit ratio, read path |
| B | Registration burst | 500 users registering inside 60s | Write contention, idempotency under load |
| C | Live activity | 500 participants joining one live activity | **Socket.IO fan-out; the hardest case** |
| D | Feed scroll | Sustained paginated reads | Keyset pagination, N+1 regressions |
| E | Write-heavy mix | 50/50 read/write | Outbox throughput, cache invalidation |
| F | Sustained soak | Profile A for 2 hours | **Memory leaks, connection exhaustion** |
| G | Cache cold-start | Flush Redis, then A | That Redis failure does not break the app |
| H | Multi-instance | Two API instances sharing Redis | Horizontal consistency of limits, locks, idempotency |

Profile F is the one teams skip and the one that finds leaks. Profile G is the
one that proves §12's claims under load rather than in a unit test.

---

## 3. Metrics

| Metric | Source | Why |
|---|---|---|
| p50 / p95 / p99 latency | k6 | Averages hide the users who are actually suffering |
| **Error rate** | k6 | The only metric that matters if it is non-zero |
| **Cache hit ratio** | metrics service | A collapse here explains a latency rise |
| **Outbox lag** | admin dashboard | Supabase falling behind; the staleness users would see |
| p95 by endpoint | metrics service | A global p95 hides one slow endpoint |
| CPU / memory | host | Saturation, and leaks (F) |
| Mongo op latency | Atlas / dashboard | Distinguishes "our code" from "the database" |
| Redis latency + error rate | provider | Distinguishes "our code" from "the cache" |

---

## 4. Budgets (§25)

| Endpoint class | p95 | p99 |
|---|---|---|
| Cached reads | 150 ms | 400 ms |
| Uncached reads | 400 ms | 900 ms |
| Writes (non-critical) | 600 ms | 1.5 s |
| Registration / payment | 1.2 s | 3 s |
| Live socket emit | 250 ms | 700 ms |

**Error rate must stay under 1%**, and under 0.1% for writes.

A p95 that is fine while p99 is terrible means a subset of users is having a
broken experience and the average will never show it.

---

## 5. §20 Profile C — the one to watch

500 participants in a single live activity is the hardest scenario in the
product, because a write fan-out to 500 sockets plus 500 clients reading
concurrently is where in-memory state and socket backpressure both break.

Watch specifically:

- **Socket.IO fan-out time** — the delay between an answer being recorded and
  every participant seeing it
- **Reconnect storm** — drop 100 clients at once and confirm recovery; a
  reconnect storm that re-runs expensive work on join will take the room down
- **Memory growth over the session** — the leak shows here, not in profile A

---

## 6. §21 Horizontal scale test

Two API instances, one Redis. The question is whether anything is still
**process-local** that should be shared.

| Test | Pass condition |
|---|---|
| A writes → B reads | B sees the write (no sticky-session dependence) |
| B writes → A reads | A sees it |
| Rate limit across both | The limit is **shared**, roughly double a single instance's allowance — not double the intended quota |
| Idempotency across both | A duplicate sent to B after A is **rejected** |
| Lock across both | Two instances cannot run the same locked job concurrently |
| Cache invalidation across both | A write on A invalidates what B cached |

If a rate limit is not shared, an attacker multiplies their quota by the number
of instances. If a lock is not shared, mutual exclusion does not exist.

**This is also the trigger test for §22** — see below.

---

## 7. §22 — when the Socket.IO Redis adapter becomes necessary

**Do NOT deploy the adapter pre-emptively.** It is not currently enabled and
current single-instance realtime behaviour is unchanged.

The adapter is required when **both** are true:

1. `replicas > 1`, **and**
2. live rooms span replicas — a participant on instance A must receive an event
   emitted from instance B

Until both hold, the adapter adds a Redis dependency to the realtime path and a
new failure mode for no benefit. Enabling it early would make realtime depend on
Redis, violating the rule that Redis failure must never break the core product.

**Trigger check:** during profile C or H, if a participant connected to
instance A does not receive an event emitted on instance B, the adapter is now
required.

---

## 8. What "failed" looks like

Record the profile, the numbers, and the verdict. A load test that produces
numbers without a verdict is a screenshot, not a test.

| Profile | p50 | p95 | p99 | Err % | Cache hit | Verdict |
|---|---|---|---|---|---|---|
| | | | | | | |
