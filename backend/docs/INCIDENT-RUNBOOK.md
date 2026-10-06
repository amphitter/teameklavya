# INCIDENT RUNBOOK

Part 7 §24 · §32.

Severities, and the first thing to do for each alert.

---

## 1. First, every time

1. **Confirm it is real.** Check `npm run preflight` and the admin dashboard.
2. **Write down the time you started.** Timelines matter afterwards.
3. **Decide severity** from the table below.
4. **Communicate before you fix.** A known incident is better than a silent one.

---

## 2. Severity ladder (§24)

| Severity | Meaning | Response | Examples |
|---|---|---|---|
| **INFO** | Notable, no action needed now | Review in normal hours | Cache version bumped; a reconciliation pass repaired 3 rows |
| **WARNING** | Degraded; needs attention today | Investigate within a few hours | Redis fallback active > 15 min; outbox backlog > 10 000; p95 regression on one endpoint |
| **HIGH** | User-visible impact, or integrity at risk | Respond now | Dead letter present (fresh); Mongo primary degraded; error rate > 1%; a provider unreachable |
| **CRITICAL** | Data loss, or the product is down | All hands; communicate immediately | Dead letter aged > 15 min; Mongo unreachable; error rate > 10%; **any suspected data loss** |

**Data loss escalates immediately to CRITICAL regardless of scope.** A single
lost record is CRITICAL, because the first question is always "how many more
are there?"

---

## 3. Alert → first action

### Dead letter present (HIGH → CRITICAL at 15 min)
A dead letter is a change that reached MongoDB and never reached Supabase.
**This is silent data loss until someone looks.**

```bash
# What failed, and is it still failing?
node scripts/reconcile-supabase.js            # dry-run
node scripts/reconcile-supabase.js --apply    # only when you agree with the report
```

Dead letters are **kept**, never discarded. Read `lastErrorCode` — it is one of
our stable codes, never a raw SQLSTATE. Fix the cause before replaying, or you
will dead-letter it again.

### Outbox backlog growing
Distinguish the two cases — the count alone cannot:
- **Backlog large but draining** → capacity issue; watch it.
- **Backlog small and stuck** → something is broken; investigate now.

The dashboard shows processing rate next to backlog for exactly this reason.

### Redis unavailable (WARNING)
**By design, the product keeps working.** Verify, then fix:

1. Confirm the dashboard shows fallback active.
2. Confirm rate limiting has failed OPEN and the app is serving.
3. Confirm idempotency is refusing — not duplicating — critical writes.
4. Fix Redis. Locks are the one thing to check carefully: a lock served by the
   process-local fallback is **not** mutually exclusive.

### Supabase unavailable (WARNING)
The event engine is **unaffected** — MongoDB is the source of truth. Social
data stops syncing and the outbox backlog grows; nothing is lost. Reconcile once
Supabase returns.

### Cache hit ratio collapse
A latency rise with a hit-ratio collapse is a cache problem, not a capacity
problem. Check: was the namespace or version bumped? Is invalidation
over-firing? Did a key shape change?

### Latency regression on one endpoint
Consult `docs/LOAD-TESTING.md` §4 for the budget. A global p95 that is fine
while one endpoint is slow is invisible in aggregate — per-endpoint budgets
exist for this.

### Suspected data loss (CRITICAL, always)
1. **Stop writes to the affected path** if you safely can.
2. **Snapshot before repairing** — never repair over the evidence.
3. Determine scope: how many entities, over what window.
4. Then repair, via reconciliation.
5. Write the timeline while it is fresh.

---

## 4. Never do these during an incident

| Don't | Why |
|---|---|
| Delete a dead letter to clear the alert | It is the only record of what was lost |
| Run `--apply` before reading the dry-run | Repair is not reversible in place |
| Enable RLS or change schema mid-incident | Adds a second variable to a situation you do not yet understand |
| Raise a rate limit to stop 429s | Masks the symptom and removes the protection (§29) |
| Restart repeatedly to "clear it" | Destroys the evidence and often makes it worse |
| Restore without reading `RESTORE-DRILL.md` | A restore is the least reversible operation there is |

---

## 5. Afterwards

Write down: what happened, when it started, when it was detected, what the
user impact was, what fixed it, and **what would have detected it sooner**.
The last question is the one that improves the system.
