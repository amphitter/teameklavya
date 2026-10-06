# Distributed Systems

**Part 6 — brief §11, §15**
How EventHub behaves like a horizontally scalable system while remaining a
modular monolith.

---

## 1. The constraint

EventHub is a **modular monolith**. No microservices, no Kubernetes, no Kafka,
no Elasticsearch. Two instances may run behind a load balancer, so anything that
assumes "there is only one process" is a bug.

That means coordination must happen **outside the process**:

| Problem | Where it is solved |
|---|---|
| Shared cache | Redis (Phase 1) |
| Rate limiting across instances | Redis (Phase 2) |
| Duplicate submissions | Redis idempotency (Phase 3) |
| Mutual exclusion | Redis locks (Phase 4) |
| Cross-store consistency | Outbox + reconciliation (Phase 6) |

---

## 2. No distributed transactions (§11)

There is no commit protocol spanning MongoDB and Supabase. Pretending otherwise
would be fiction, so we do not try. What replaces it:

### At-least-once delivery + idempotence = exactly-once effect

```
Mongo write ──▶ outbox entry ──▶ claim (atomic) ──▶ re-read source ──▶ upsert
                     │                                    │
                     └────── reconciliation ──────────────┘
```

Every target write is an **upsert on the canonical id**, so applying an entry N
times is indistinguishable from applying it once. The effect is exactly-once
even though delivery is at-least-once.

### The consumer re-reads instead of replaying

An outbox entry stores `{entityType, entityId, op}` — **not a copy of the
changed row**. Every apply re-reads the current document.

This is the most consequential decision in the whole design:

1. **Ordering stops mattering.** Two queued changes to one entity can apply in
   any order and land on the same final state. With a copied payload,
   out-of-order delivery silently resurrects stale fields — a bug that appears
   only under load and is near-impossible to reproduce.
2. **Retry is trivially correct.** Re-processing re-reads reality.
3. **Deletes handle themselves.** If the source row is gone at apply time, the
   target is removed rather than written from memory.

### Reconciliation is the guarantee

Enqueueing is **not** atomic with the business write — this codebase uses no
MongoDB multi-document transactions. A crash between the two loses the entry.

We do not hide that. `scripts/verify-supabase.js --repair` scans for entities
present in Mongo but missing or divergent in Supabase and re-enqueues them.
**The outbox provides prompt propagation; reconciliation provides the
guarantee.** Any design that treats reconciliation as an optimisation is wrong,
because it is the only thing standing between a crash and silent data loss.

---

## 3. Failure behaviour (§15)

The rule: **an infrastructure failure degrades the product, it does not become
the user's problem.** And never turn someone else's outage into your own.

| Component | On failure | Why |
|---|---|---|
| Redis (cache) | Serve from Mongo via circuit breaker | Slower, correct |
| Redis (rate limit) | **Fail open** | Blocking all traffic is a self-inflicted outage |
| Redis (idempotency) | Fall back to per-instance memory; refuse if that fails too | A duplicate registration is worse than a 503 |
| Redis (locks) | `onUnavailable` per call site | Destructive work aborts; read-only work proceeds |
| Supabase | Social features degrade; events unaffected | Social is a separate domain |
| Cloudinary / R2 | Upload fails with a clean `StorageUploadError` | No raw provider errors (§61) |
| MongoDB | Core is unavailable; nothing to degrade to | Surface a clean error |

**Events must survive a social-store outage.** They are different domains on
different stores, which is the practical payoff of the split.

### No leaks (§61)

Users never see: MongoDB/Supabase/Cloudinary/R2/Redis quotas, database errors,
stack traces, or provider credentials. Every provider normalises upstream
errors. Connection strings and service-role keys are scrubbed even from logs —
a Postgres error happily echoes the DSN, and a DSN is a credential.

---

## 4. Backpressure and bounds

Nothing in the system runs unbounded:

- **Every list is keyset-paginated**, hard-capped at `MAX_LIMIT = 100`
  (`repositories/cursor.js`). OFFSET is not used anywhere: it degrades linearly
  and skips or duplicates rows when the set shifts mid-scroll.
- **Every Supabase read is clamped** to `maxRows` in the client, so an
  unbounded `select *` is impossible to write by accident.
- **Drains are bounded** by count *and* wall-clock, so a large backlog cannot
  starve whatever scheduled it.
- **Retry backoff is exponential with full jitter**, and capped. Jitter matters
  more than it looks: without it, every entry that failed during an outage
  becomes retryable at the same instant, and the recovering database is hit by a
  synchronised thundering herd — the classic way a brief blip becomes a
  sustained one.
- **Sweeper jobs are bounded per run** with dry-run as the default.

---

## 5. Idempotency map

| Operation | Mechanism |
|---|---|
| Registration, payment, ticket issue, quiz/event submission | Redis idempotency keys, per-user scoped |
| Follow / like / save / join community | Unique constraint on `(a, b)` — atomic, free, no lock |
| Achievement unlock | Unique on `(user_id, code)` |
| Conversation creation | Unique on `(LEAST(a,b), GREATEST(a,b))` |
| Certificate generation | `$setOnInsert` upsert on `(event, user)` |
| Outbox application | Upsert on canonical id |

**A unique constraint beats a lock wherever it can express the rule.** It is
atomic, free, cannot deadlock, and cannot be forgotten. Locks are reserved for
work spanning multiple writes that no constraint can express — which is why
Phase 4 wired exactly three of them.

---

## 6. What is deliberately not built

| Not built | Why |
|---|---|
| Redis Socket.IO adapter (§12) | Realtime is single-instance. Abstraction exists; adopt when actually required. |
| Queue system / BullMQ (§65) | Service boundaries are designed for it; adopting it now would be speculative complexity. |
| Kafka / event bus | Massively out of scale for this deployment. |
| Row Level Security | Authorisation lives in the tested API layer. Two sources of truth would disagree. |
| Read replicas, sharding | Not a problem this system has. |

---

## 7. Observability

- **Outbox**: per-status counts plus the age of the oldest undelivered entry.
  A large backlog is fine if it is draining; a small one is alarming if it has
  sat for an hour. Age is the number that matters.
- **Supabase**: query count, timing, slow queries, N+1 warnings.
- **Redis**: availability, latency, hit ratio, commands, errors, fallback count.
- **N+1 detection**: queries are attributed to the request that caused them via
  `AsyncLocalStorage`, so an N+1 shows up as a *count* rather than as
  unexplained latency. Detecting it globally would tell us nothing about any
  single request.

All admin-only (§16).
