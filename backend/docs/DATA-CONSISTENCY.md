# DATA CONSISTENCY

Part 7 §2 · §3 · §4 · §6 · §32. How EventHub keeps MongoDB and Supabase from
drifting apart, and what happens when they do.

---

## 1. The shape of the problem

Two databases, no distributed transactions, and a deliberate decision not to
introduce any.

- **MongoDB** is the source of truth for the event/business domain.
- **Supabase** holds the relational/social copy.

A write lands in MongoDB and is then propagated. The gap between those two
moments is where inconsistency lives, and the only question is how it is
managed — not whether it exists.

**The outbox enqueue is NOT atomic with the business write.** This is stated
plainly because pretending otherwise is how the system ends up silently losing
data. The write commits; the enqueue is a separate operation that can fail.
Reconciliation exists because of that gap, not as an optimisation.

---

## 2. The outbox

```
business write ──► MongoDB ──► outbox entry (reference only)
                                    │
                                    ▼
                          worker claims, re-reads Mongo, applies to Supabase
                                    │
                          fail ──► backoff + jitter ──► retry
                                    │
                          exhausted ──► DEAD LETTER (kept, never discarded)
```

### The entry carries a reference, not a payload

This single decision is what makes everything else safe:

- **Ordering stops mattering.** Two entries applied out of order both re-read
  the *current* state, so both converge on the truth.
- **Retry is always correct.** Re-applying re-reads and re-upserts.
- **Deletes self-handle.** A delete re-reads a document that no longer exists
  and removes the target row.
- **Nothing goes stale.** There is no snapshot in the queue that could describe
  a state the database has moved past.

### Backoff

Exponential with **full jitter**, capped. The cap matters: without it a dead
upstream schedules a retry hours out and the data sits stale long after
recovery. The jitter matters: without it every failed entry retries at the same
instant, and the recovering upstream is immediately knocked over again.

---

## 3. Dead letters

After `maxAttempts` the entry is **dead-lettered, not deleted**. It keeps:

`id · entityType · entityId · operation · attempts · lastErrorCode · lastErrorAt · createdAt · deadLetteredAt`

`lastErrorCode` is one of **our** stable codes, never a raw Postgres SQLSTATE —
a SQLSTATE leaks schema detail and is not stable enough to alert on.

**Never stored here:** passwords, tokens, the Supabase service-role key, Redis
credentials, request bodies. The entry identifies *which* entity failed, never
*what* was in it.

A dead letter is **silent data loss** if nobody looks, so the dashboard does
not merely count them — it ages them. `dead > 0` is HIGH; past 15 minutes it is
CRITICAL.

---

## 4. Reconciliation

`scripts/reconcile-supabase.js` — **dry-run by default**; `--apply` is required
to change anything.

It detects eight conditions:

| # | Condition |
|---|---|
| 1 | A Mongo entity with no outbox record |
| 2 | An outbox entry with no target row |
| 3 | A target row whose fields differ from Mongo |
| 4 | A Mongo entity deleted but still present in Supabase |
| 5 | Stale target fields |
| 6 | Failed / retrying entries |
| 7 | Dead-lettered entries |
| 8 | **Ambiguous drift** — reported, never auto-repaired (see §6) |

### Repair enqueues; it never writes directly

Reconciliation puts a repair on the **same outbox path** the live sync uses. So
what reconciliation fixes is exactly what the live path would have produced —
there is no second, subtly different write path to keep in sync.

### §6: normalisation before comparison

Naive comparison produces false drift that drowns out real drift. Before
comparing:

- `Date` ⇄ ISO string
- `ObjectId` ⇄ string
- `null` ⇄ `undefined`
- Array ordering, where order is not meaningful (topics, interests)
- Sub-second timestamp precision is tolerated — Mongo and Postgres do not
  store identical precision

**Trigger-owned columns are excluded entirely.** Postgres maintains
`likes_count`, `followers_count`, `posts_count`, `comments_count` and
`updated_at`. Comparing them would flag every row, and the resulting noise
would make the report useless.

**Ambiguous columns (`deleted_at`, `status`, `role`) are flagged, never
auto-repaired.** When two stores disagree about whether something is deleted,
the system does not know which is right — and guessing wrong destroys data that
cannot be recovered. A human decides.

### §3: checkpoints, bounded and resumable

`{ lastCheckedAt, lastCheckedId }` per entity type, with keyset resume. Batches
are bounded and streamed with a cursor — the collection is never loaded whole.

A run that reaches the end marks itself `wrapped` so the next pass starts over.
Without wrapping, rows created *before* the checkpoint would never be checked
again, and the checkpoint would become a blind spot that grows with time.

### §4: idempotent

Running reconciliation twice reports zero repairs the second time, creates no
duplicate profiles/posts/communities/memberships/notifications/messages, and
leaves EventHub IDs stable. Two properties deliver this: `enqueue` returns
`null` when an identical `PENDING` entry already exists, and application is an
upsert on the canonical id.

---

## 5. Migration safety (§7)

The eight gates are unchanged: `prepare → schema → backfill → drain → verify →
dual-read → cutover → retire`.

**NO SOURCE DELETION FROM MONGO.** No CLI flag may delete production Mongo
data. There is none, and a test asserts that no migration script contains
`--delete-source`, `--purge-mongo`, `--drop-source`, `--delete-mongo`, or calls
`deleteMany` / `deleteOne` / `dropDatabase` / `collection.drop`.

Retirement requires all of: manual confirmation, independent verification,
backup confirmation, zero drift, zero dead letters, a restore test, and explicit
admin approval.

---

## 6. Consistency guarantees, stated honestly

| Guarantee | Status |
|---|---|
| A committed Mongo write is never lost | **Yes** — Mongo is the source of truth |
| Supabase eventually matches Mongo | **Yes**, via outbox + retry + reconciliation |
| Supabase is instantly consistent | **No** — eventual, by design |
| Cross-database transactions | **No** — deliberately none |
| A dead-lettered entry is retried forever | **No** — bounded, then kept for inspection |
| Reconciliation can destroy data | **No** — it enqueues; ambiguous cases are never auto-repaired |
