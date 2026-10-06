# Supabase Migration Runbook

**Part 6, Phase 6 — brief §10, §11**
Status: **prepared, not executed.** No data has moved. MongoDB is the source of
truth for the social domain until every gate below is signed off.

---

## 1. Scope

| Store | Owns | Status |
|---|---|---|
| **MongoDB** | events, registrations, quiz state, live sessions, results, certificates | Stays. Source of truth. |
| **MongoDB** | profiles, follows, posts, comments, reactions, communities, DMs, notifications, moderation | **Migrating** to Supabase. |
| **Supabase** | the relational/social domain listed above | Empty until §4. |

The split is not "old database / new database". It is domain ownership: the
social graph is relational (edges, aggregates, constraints) and Postgres is
better at it; events are document-shaped and MongoDB is better at those. Both
stay.

---

## 2. The rule that governs everything

> **Never delete MongoDB data until it has been independently verified.**

"Verified" does **not** mean the backfill printed success. A program grading its
own homework is not verification. Verification is
`scripts/verify-supabase.js` — a separate script that reads both stores
independently, compares counts **and** field-level content, and exits non-zero
on drift.

**Deleting a Mongo collection is a manual act performed by a human after this
script exits 0.** There is no automated path that deletes source data, and
there is deliberately no `--delete-source` flag anywhere.

---

## 3. Sequence

Each step is a gate. Do not start step *n+1* until step *n* is green.

### Step 1 — Prepare (done)
- [x] `db/supabase/schema.sql` written and validated
- [x] `backend/providers/supabase/` — client, boundary, credentials isolated
- [x] `backend/repositories/supabase/` — repositories mirroring the Mongo surface
- [x] Outbox machiney (`models/outbox.model.js`, `services/outbox.service.js`)
- [x] Consumer (`services/social-sync.service.js`)

### Step 2 — Create the schema
```bash
psql "$SUPABASE_DB_URL" -f backend/db/supabase/schema.sql
```
Requires `pgcrypto` and `pg_trgm`; both are available on Supabase.

### Step 3 — Backfill (dry run first)
```bash
node backend/scripts/backfill-supabase.js                  # dry run
node backend/scripts/backfill-supabase.js --apply          # enqueue
```

**The backfill enqueues — it does not write.** It creates outbox entries with
`source: "backfill"` that the normal consumer applies. This is deliberate: a
separate write path would mean the data you verified is not the data the live
path produces. One code path is what makes verification meaningful.

Order is FK-safe: `profiles → organizations → communities → posts → …`.
PostgREST rejects a row whose FK target is absent, so order is correctness.

Resume-safe: re-running skips entities already queued.

### Step 4 — Drain
```bash
SYNC_ENABLED=true node -e "require('./services/social-sync').drain({limit:100000,maxMs:600000})"
```
Watch for `dead` entries — they are kept, never dropped.

### Step 5 — Verify (the gate)
```bash
node backend/scripts/verify-supabase.js --sample=500
# exits 0 = verified, 1 = drift

node backend/scripts/verify-supabase.js --repair   # re-queue divergent rows
```

Repair writes to **Supabase only**. Repeat drain → verify until clean.

Counter columns (`followers_count`, `likes_count`, …) are excluded from
comparison: they are trigger-maintained in Postgres and application-maintained
in Mongo, so they only converge once all rows have landed. Comparing them
mid-migration produces noise that hides real drift.

### Step 6 — Dual-read
Flip one repository at a time in `repositories/index.js`. Read from Supabase,
compare against Mongo, and log divergence without serving it. Run for a full
traffic cycle.

### Step 7 — Cutover
Serve from Supabase. Keep writing to Mongo. Keep the outbox flowing in both
directions so rollback remains possible.

### Step 8 — Retire source data
**Manual. Human. After §5 has been green continuously.** Take a final Mongo
backup first, keep it for at least 30 days, and delete collections — not
databases.

---

## 4. Rollback

| Failure point | Action |
|---|---|
| Schema creation fails | Drop the schema. Nothing in Mongo changed. |
| Backfill enqueues wrongly | `db.outbox.deleteMany({source:"backfill"})`. Supabase rows are disposable. |
| Sync applies bad rows | Set `SYNC_ENABLED=false`. Truncate the affected Supabase tables. Fix the mapper. Re-run. |
| Verification finds drift | `--repair`, re-drain, re-verify. |
| Dual-read diverges | Flip the repository back. Mongo was never modified. |
| After cutover | Flip reads back to Mongo. The outbox kept it current, so no data is lost. |

Rollback is cheap at every step **because Mongo is never modified**. That is
the entire argument for the sequencing.

---

## 5. Known limitations (stated, not hidden)

1. **Enqueue is not atomic with the business write.** The codebase uses no
   MongoDB multi-document transactions, so a crash between writing the document
   and enqueueing the entry loses the entry. Reconciliation is therefore a
   correctness requirement, not an optimisation.

2. **Ordering is not guaranteed.** Two queued changes to one entity may apply in
   any order. This is safe *because the consumer re-reads* current state rather
   than replaying a captured payload — final state is correct either way.

3. **Counters converge eventually, not instantly.** Trigger-maintained in
   Postgres, application-maintained in Mongo.

4. **No RLS.** Authorisation lives in the API layer (§14). The service-role key
   bypasses RLS entirely. Revisit only if a key ever reaches a client.

---

## 6. Consistency model

**Eventual, bounded by the outbox lag.** §11 forbids distributed transactions
between MongoDB and Supabase; the outbox replaces them with
at-least-once delivery + idempotent application = exactly-once effect.

```
Mongo write ──▶ outbox entry ──▶ claim (atomic) ──▶ re-read Mongo ──▶ upsert Supabase
                     │                                    │
                     └── reconciliation (the guarantee) ───┘
```

Every target write is an upsert on the canonical id, so applying an entry N
times is indistinguishable from applying it once.
