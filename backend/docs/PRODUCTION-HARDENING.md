# PRODUCTION HARDENING

Part 7 §32. The index to this documentation set, and a summary of what Part 7
changed.

Part 7 made **no architectural change**. No microservices, no Kubernetes, no
Kafka, no Elasticsearch; MongoDB, Upstash Redis and Supabase are all still in
their Part 6 roles. Everything below is about making the existing architecture
safe to run.

---

## 1. The documents

| Document | Read it when |
|---|---|
| `SECURITY-MODEL.md` | You need the boundary, credentials, the RLS decision, cache privacy, or the auth model |
| `DATA-CONSISTENCY.md` | You are asking why Mongo and Supabase disagree, or how drift is repaired |
| `PROVIDER-FAILURE-MATRIX.md` | Redis or Supabase is unhealthy and you need to know what still works |
| `INCIDENT-RUNBOOK.md` | Something is on fire |
| `RESTORE-DRILL.md` | You need to prove a backup, or restore one |
| `LOAD-TESTING.md` | You are about to ship something that might be slow |
| `OUTBOX-OPERATIONS.md` (this set, §5) | You are triaging a dead letter |
| `DISTRIBUTED-SYSTEMS.md` | Part 6 background: locks, idempotency, outbox |
| `REDIS-ARCHITECTURE.md` | Key layout, namespaces, TTLs |
| `SUPABASE-MIGRATION.md` | The eight migration gates |

---

## 2. The five invariants

Everything in Part 7 serves one of these. If a change threatens one, it does
not ship.

| Invariant | What it means in practice |
|---|---|
| **Mongo is the source of truth** | Supabase failing never breaks the event engine; reconciliation repairs drift |
| **Redis is never required for correctness** | It is an accelerator. Down means slower, never broken |
| **No infrastructure detail reaches a user** | No provider names, quotas, stack traces or raw DB errors — ten closed error codes and a safe message only |
| **No silent data loss** | A dead letter is kept and escalates by age; ambiguous drift is never auto-repaired |
| **No source deletion from Mongo** | No CLI flag can do it, and a test asserts none ever appears |

---

## 3. What to run, and when

| Command | When |
|---|---|
| `npm run test:all` | Every change. 1170 assertions, 6 e2e suites |
| `npm run preflight` | Before every deploy. Distinguishes CONFIGURED from HEALTHY |
| `node scripts/reconcile-supabase.js` | Scheduled, and after any Supabase outage. **Dry-run by default** |
| `REAL_PROVIDER_TESTS=true npm run test:real-providers` | Against a throwaway environment, before a significant provider change. **Never in CI** |
| `k6 run …` | See `LOAD-TESTING.md` |

---

## 4. Deploy checklist

1. `npm run test:all` — green.
2. `npm run preflight` — exit 0. A non-zero exit means stop, even if the
   message looks minor.
3. If the change touches keys: confirm `CACHE_KEY_VERSION` was bumped, or that
   it deliberately was not.
4. If it touches Supabase schema: read `SUPABASE-MIGRATION.md` and confirm
   which of the eight gates you are at. **Never past `verify` without zero
   drift.**
5. Confirm no dead letters are open. A deploy on top of an unresolved dead
   letter makes the next incident much harder to attribute.

---

## 5. Outbox operations in one place

The admin dashboard panel shows: backlog, processing rate, retrying, dead
lettered, oldest pending age, oldest dead-letter age, and a bounded sample of
recent dead letters (entity reference and error code only — never a payload).

```
backlog large + draining  → capacity; watch
backlog small + stuck     → investigate now
dead > 0                  → HIGH
dead > 0, older than 15m  → CRITICAL
```

The rate sits next to the backlog because a raw count cannot express the
difference between those first two rows, and getting it wrong in either
direction is expensive.

To repair:

```bash
node scripts/reconcile-supabase.js             # dry-run — always read this first
node scripts/reconcile-supabase.js --apply     # only once you agree with the report
```

---

## 6. What Part 7 found and fixed

Part 7 was mostly an audit, and the findings were real rather than theoretical.
The ones worth remembering, because they were invisible before:

**Silent data loss paths**
- A dead-lettered outbox entry was opaque: only a free-text `lastError`, nothing
  on the dashboard, nothing escalating. Now it carries stable codes and ages
  into HIGH then CRITICAL.
- Reconciliation did not exist. Drift between Mongo and Supabase was invisible
  and unrepairable.

**Rules that held only by coincidence**
- The Super Admin address was re-derived by hand in five modules. One edit would
  have produced a hole or a lockout.
- Two suspension paths existed; only one was guarded.

**Client faults reported as server outages**
- 41 error handlers echoed `error.message` straight to the client, leaking
  Mongo internals (model name, field path) and reporting 4xx input as 5xx.
- A malformed ObjectId returned 500 in three controllers, and a 200 000-char
  organisation name exceeded Mongo's index key limit and returned 500.

**Degradation that did the opposite of what it promised**
- A malformed (but HTTP 200) Redis response made the rate limiter **block**
  traffic, and made idempotency report "already claimed" — silently dropping
  legitimate writes.
- The distributed lock fell back to a process-local lock on error while
  reporting `locked: true`, so two instances could both hold it. Because
  acquire succeeded, the caller's `abort` choice was never consulted.

**Documents that described the wrong system**
- The security model documented HttpOnly/Secure/SameSite cookie auth. The API
  uses bearer tokens and sets no cookies at all.

---

## 7. Known limitations

Stated plainly, because a hardening report that claims completeness is not
trustworthy:

| Limitation | Status |
|---|---|
| Real-provider tests | Built and gated; **not yet run** against real Upstash/Supabase |
| Restore drill | Documented with real commands; **not yet executed** end to end |
| Load profiles A–H | Harness and budgets defined; **not yet run** |
| Horizontal scale test | Criteria defined; **not yet run** |
| Socket.IO Redis adapter | Deliberately **not** deployed; trigger documented |
| RLS | **Off**, deliberately; mandatory the moment a browser→Supabase path appears |
| Rate limits | Reviewed structurally, **not** against measured production traffic (§29) |

Each of these is runnable by an operator with access to the real environment.
None of them can be honestly completed from a development sandbox, and claiming
otherwise would be worse than leaving them marked incomplete.
