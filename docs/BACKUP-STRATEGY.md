# Backup & restore (Part 5, Phase 8 — spec §69)

EventHub's durable state lives in **two** places, and a backup that covers only
one of them is not a backup:

1. **MongoDB** — everything except binary files (§21: no binaries in the DB).
2. **Cloudinary / R2** — the actual images, PDFs and videos.

A restore must reunite the two. Database rows referencing a `publicId` whose
object no longer exists produce broken images — recoverable-looking data that
is quietly wrong.

---

## 1. MongoDB

### Taking a backup

```bash
# Full logical dump (compressed)
mongodump --uri="$MONGO_URI" --gzip --archive=eventhub-$(date +%F).archive.gz

# Single collection — useful before a risky migration
mongodump --uri="$MONGO_URI" --gzip --archive=events-$(date +%F).gz \
          --db=eventhub --collection=events
```

Use `--uri` with the Atlas connection string. For Atlas, `mongodump` against a
free-tier cluster is fine; schedule it off-peak.

### Frequency and retention

| Tier | Frequency | Retention | Rationale |
|---|---|---|---|
| Daily | every 24 h | 7 days | Recovers "yesterday's mistake" |
| Weekly | Sunday | 4 weeks | Recovers slow-burn corruption |
| Monthly | 1st | 12 months | Compliance / long-view |

Keep at least one copy **off the database host**. A dump sitting next to the
database it came from does not survive the failure you are insuring against.

### Restoring

```bash
# Into a scratch database FIRST — never straight onto production
mongorestore --uri="$MONGO_URI" --gzip --archive=eventhub-2026-10-06.archive.gz \
             --nsFrom='eventhub.*' --nsTo='eventhub_restore.*'

# Verify, then promote
mongorestore --uri="$MONGO_URI" --gzip --archive=eventhub-2026-10-06.archive.gz --drop
```

`--drop` replaces existing collections. **Always** restore into a scratch
namespace and eyeball the counts before promoting — `--drop` on the wrong
target is unrecoverable.

### Atlas-managed alternative

If you are on a paid Atlas tier, continuous backups with point-in-time restore
are strictly better than `mongodump` cron. Use them, and keep this document's
restore drill as the thing you rehearse.

### Verify integrity before trusting a dump

```bash
# Structural check on the archive's BSON
mongorestore --uri="$MONGO_URI" --gzip --archive=<file> --dryRun
```

---

## 2. Cloudinary / R2 (the binaries)

MongoDB rows and their remote objects are only related by a `publicId` string.
There is no referential integrity, so the remote store needs its own plan.

### Cloudinary

Cloudinary is the system of record for images; it is not a backup.

- **Export metadata** periodically so a restore has something to reconcile
  against. The Admin API `resources` endpoint paginates through every asset:

  ```bash
  curl "https://api.cloudinary.com/v1_1/$CLOUD_NAME/resources/image?max_results=500" \
       -u "$API_KEY:$API_SECRET" > cloudinary-inventory-$(date +%F).json
  ```

  Walk `next_cursor` until exhausted. This manifest is what lets you prove,
  after an incident, exactly which assets existed and which are now missing.

- **Back up the originals**, not the derived variants. Transformations are
  reproducible from the original; the original is not reproducible from
  anything. Copy originals to cheap object storage on the same cadence as the
  weekly database dump.

- Watch the monthly credit allowance. Transformations are the expensive
  operation, not storage — which is why the frontend requests sized variants
  (§19) instead of originals.

### Cloudflare R2

Large files (PDFs, videos, documents) live here.

- Enable **versioning** on the bucket if available on your plan — it turns an
  accidental overwrite into a recoverable event.
- Mirror the bucket to a second location periodically (`rclone sync`), or rely
  on R2's own durability for single-object loss and keep the manifest from
  `mediaassets` as your index.

### The `mediaassets` collection is your manifest

Every upload writes a `mediaassets` row with `publicId`, `status` and — for
unattached assets — `cleanupAfter`. That collection is the authoritative list of
what *should* exist remotely. After any restore, reconcile in both directions:

```
rows with no remote object  → broken references (restore the object, or clear the field)
remote objects with no row  → orphans (reclaim them; they cost money)
```

---

## 3. What is deliberately NOT backed up

These are reconstructed on boot and have no durable value:

- **Cache contents** — in-memory, dies with the process, refills on demand.
- **Realtime presence** — rooms, socket registries, live scores in flight (§42:
  presence is never persisted). Durable results live in `participantsessions`
  and `eventresults`.
- **Metrics counters** — latency rings and counters are process-lifetime (see
  the Phase 7 dashboard; figures reset on restart by design).
- **`node_modules`, build output, logs** — reproducible.

Backing these up wastes space and creates the illusion of a complete restore
when the important half is missing.

---

## 4. The restore drill

**An untested backup is a hypothesis.** Schedule this — quarterly is reasonable,
and always after a schema migration.

1. Provision a throwaway MongoDB instance (a local `mongod` is fine).
2. Restore the most recent daily dump into it.
3. Point a copy of the API at it with `MONGO_URI` overridden, on a spare port.
4. Verify, and record the numbers:
   - [ ] `users`, `events`, `posts`, `registrationresponses` counts match the
         pre-incident figures from the Phase 7 dashboard inventory.
   - [ ] A known event detail page loads and its banner image renders
         (proves the DB ↔ Cloudinary link survived).
   - [ ] A known certificate resolves (proves `eventresults` survived).
   - [ ] Login works (proves credential material restored intact).
5. Time the whole run. **RTO** (how long to restore) and **RPO** (how much data
   you lose) are the two numbers an incident actually needs, and you only learn
   them by measuring.
6. Tear down the throwaway.

Record the results next to this document. If step 4 fails on the image check,
your backup strategy has a hole — fix it before an incident finds it.

---

## 5. Secrets

Backups contain credential material (password hashes, reset tokens, OAuth
identifiers). Treat every archive as a secret:

- Encrypt dumps at rest (`gpg --symmetric`, or your storage provider's SSE).
- Never commit an archive, an inventory JSON, or a `.env` to the repository.
- Restrict read access to the backup bucket separately from the app's own
  database credentials — a compromised app role should not imply access to
  every historical backup.
