# PROVIDER FAILURE MATRIX

Part 7 §12 · §32. Compares companion to `REDIS-ARCHITECTURE.md` and
`DISTRIBUTED-SYSTEMS.md`.

---

## 1. Why this document exists

Redis is shared, ephemeral infrastructure. Supabase is a downstream target.
Neither is the source of truth. That means a failure in either must **degrade
the product, not break it** — and "degrade" has to mean something specific and
tested, not "hopefully it still works".

This matrix is the specification of what happens for each failure mode. It is
written down because these decisions are impossible to recover from logs during
an incident: if you are reading this while Redis is down, you need to know
whether the API is supposed to be working.

**The governing rule:** Redis failure must not destroy the core product, and
Supabase failure must not destroy the event engine.

---

## 2. Redis failure modes

Redis is reached over HTTP (Upstash REST), so every failure arrives as one of
six shapes.

| # | Mode | What arrives | System behaviour |
|---|---|---|---|
| 1 | **Unavailable** | connection refused / DNS failure | Breaker opens → memory fallback |
| 2 | **Timeout** | request exceeds `timeoutMs` | Breaker counts a failure → memory fallback |
| 3 | **HTTP 500 / 5xx** | non-2xx response | Breaker counts a failure → memory fallback |
| 4 | **Malformed** | 200 with an unparseable or unexpected body | Treated as a failure → memory fallback |
| 5 | **Slow** | succeeds, but over the latency budget | Succeeds, and is recorded; sustained slowness trips the breaker |
| 6 | **Partial** | pipeline where one command succeeds and one fails | The failed command is reported; the pipeline is not assumed atomic across a partial failure |

### The circuit breaker

Every Redis command is a network round-trip. If Redis is down and we
caught-and-fell-back **per operation**, every cache read would pay the full
connect/timeout cost before degrading — a latency cliff across the whole
application, at exactly the moment the system is already unwell.

So the provider sits behind a breaker:

```
closed (healthy) ──failures ≥ threshold──► open (fail fast, use memory)
        ▲                                        │
        └──────── probe succeeds ──────── cooldown elapses (half-open)
```

While open, calls go straight to the memory provider without touching the
network. After the cooldown it probes once; a success closes the breaker.

**Fallback is observable, not silent.** Every degradation increments a counter
that the admin dashboard surfaces. "We have been running without Redis for
three days" should be visible on a dashboard, not discovered during a
post-mortem.

---

## 3. Behaviour by subsystem

The important property: **each subsystem chooses its own degradation**, because
the cost of being wrong differs per use.

| Subsystem | On Redis failure | Why this choice |
|---|---|---|
| **Cache** | Fall back to in-process memory | A cache miss is slow, never wrong. Correctness does not depend on the cache. |
| **Rate limiting** | **Fail OPEN** (allow the request) | Blocking legitimate traffic because a counter is unreachable is a self-inflicted outage. Accepting some abuse is cheaper than rejecting real users. |
| **Idempotency** | In-memory fallback for ordinary writes; **refuse** business-critical writes | The whole point is preventing duplicates. An idempotency store that silently forgets is worse than none, because it returns "new" for a retry that already happened. |
| **Distributed lock** | Caller decides: `proceed` or `abort` | Only the call site knows whether running unlocked is safe. |
| **Session/auth** | Unaffected — sessions are JWTs verified locally | Deliberate: authentication must never depend on Redis. |

### 3.1 Cache — fall back to memory

A stale or absent cache entry costs latency, not correctness. On failure the
request recomputes the value and continues.

### 3.2 Rate limiting — fails OPEN

This is a deliberate asymmetry. If the limiter cannot count, it **allows**:

- The failure mode of failing open is *some abuse gets through*, which is
  recoverable and visible in request logs.
- The failure mode of failing closed is *every request is rejected*, which is
  a full outage caused by a component that only exists to protect against
  abuse.

A limiter that takes the whole site down is a worse bug than the abuse it
prevents.

### 3.3 Idempotency — refuse rather than duplicate

This is the one place we choose unavailability over incorrectness.

A retried payment, registration or form submission that the idempotency store
cannot remember will be **applied twice**. Duplicating a registration is a
data-integrity bug that has to be found and cleaned up by hand; refusing the
request with a clear error is immediately visible, retryable, and safe.

- **Ordinary writes** fall back to the in-process store. Single-instance, so
  it is weaker, but the blast radius is small.
- **Business-critical writes** are **refused** rather than allowed through
  unprotected. The request fails loudly.

### 3.4 Locks — the call site decides

`withLock` takes `onUnavailable: "proceed" | "abort"` and defaults to
`proceed`. Only the caller knows whether running unlocked is safe:

| Call site | Choice | Reasoning |
|---|---|---|
| Media sweeper | `proceed` | Sweeping twice is idempotent; skipping a sweep leaves garbage. |
| Admin CSV export | `abort` | Two concurrent exports of the same dataset produce two conflicting files. |
| `event:end` finalization | `abort` | Finalizing twice can double-issue results or certificates. |

A lock whose holder dies is **not** lost: every lock has a TTL, so the resource
frees itself. That is why the TTL is mandatory rather than optional — a lock
without one is a permanent outage waiting for one unlucky crash.

---

## 4. Supabase failure modes

Supabase holds the relational/social copy. MongoDB remains the source of truth,
so the event engine keeps working without it.

| Mode | System behaviour |
|---|---|
| **Unavailable / timeout** | The outbox entry fails with backoff and is retried. Nothing is lost. |
| **Rejects a write** (constraint, 4xx) | The entry is retried a bounded number of times, then **dead-lettered**. |
| **Rejects permanently** (schema mismatch) | Dead-lettered — retrying a schema error forever would spin forever and change nothing. |
| **Slow** | Requests time out and are retried; the outbox backlog grows and the dashboard reports the age of the oldest pending entry. |

### Why the outbox makes this survivable

The outbox carries a **reference**, not a payload. `applyEntry` re-reads the
current state from MongoDB before writing. Consequences:

- **Ordering stops mattering.** Two out-of-order entries both converge on the
  current truth.
- **Retry is always correct.** Re-applying an entry re-reads and re-upserts.
- **Deletes self-handle.** A delete re-reads a document that no longer exists
  and deletes the target row.

After `maxAttempts` the entry is dead-lettered and **kept**, with
`lastErrorCode`, `lastErrorAt` and `deadLetteredAt`. It is never silently
discarded — a dead letter is silent data loss otherwise, which is why the
dashboard escalates one to HIGH and then CRITICAL as it ages (§5).

### Recovery

`scripts/reconcile-supabase.js` detects and repairs drift once Supabase is
healthy again. It defaults to **dry-run**; `--apply` is required to change
anything. It enqueues repairs rather than writing directly, so what
reconciliation fixes is exactly what the live path would have produced.

---

## 5. What is never true

Stated negatively because these are the assumptions that cause incidents:

- **Redis is never required for correctness.** If it is down, the product works
  more slowly.
- **Supabase is never required for the event engine.** If it is down, social
  data stops syncing and events continue.
- **A failed cache read is never a failed request.**
- **A failed rate-limit check is never a rejected request.**
- **A failed idempotency check IS a rejected request** for business-critical
  writes — the one deliberate exception.
- **No provider error, quota, or stack trace ever reaches a user.** Provider
  failures are logged server-side with the request ID.
