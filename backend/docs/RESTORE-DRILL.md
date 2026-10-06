# RESTORE DRILL

Part 7 §18 · §19 · §32.

**A backup you have never restored is not a backup. It is a hypothesis.**

This document is the drill to run, with real commands. It cannot be executed in
a development sandbox — it needs a real MongoDB deployment and an isolated
Supabase project — so it is written to be followed, not to be trusted blindly.

Run it **quarterly**, and after any change to the schema or the retention
sweeper.

---

## 0. Before you start

| Requirement | Why |
|---|---|
| An **isolated** target (different cluster/project, different connection string) | A restore that targets production is how you lose production |
| The backup you intend to restore | Confirm it exists and note its size and timestamp |
| A stopwatch | Restore time is the number you actually need |
| A second person, or a written checklist | Restores are done under pressure, by someone tired |

**Rule: never restore into an environment you have not verified is the right
one.** Twice-check the connection string. Restoring is the one operation where
a typo is unrecoverable.

---

## 1. MongoDB — dump

```bash
# Full dump (gzip-compressed)
mongodump --uri="$MONGO_URI" --gzip --archive="mongo-$(date +%F-%H%M).archive.gz"

# Single collection, when only one is suspect
mongodump --uri="$MONGO_URI" --gzip --archive=events.archive.gz \
          --db=eventhub --collection=events
```

## 2. MongoDB — restore into an isolated target

```bash
# Restore
mongorestore --uri="$ISOLATED_MONGO_URI" --gzip --archive="mongo-….archive.gz" --drop

# Point the app at the isolated instance, then verify
MONGO_URI="$ISOLATED_MONGO_URI" node scripts/preflight-production.js
```

`--drop` makes the restore authoritative: the target matches the backup exactly
rather than being merged with whatever was there. **Only ever do this on the
isolated target.**

## 3. MongoDB — verify the restore

Automated:

```bash
MONGO_URI="$ISOLATED_MONGO_URI" node scripts/verify-supabase.js
```

Manual spot-checks — counts must match the source:

```js
db.events.countDocuments({})
db.users.countDocuments({})
db.registrations.countDocuments({})
db.outboxes.countDocuments({ status: "pending" })

// Spot-check one document end to end, not just the count
db.events.findOne({ slug: "<a known slug>" })
```

A count that matches while the contents differ is the failure this step exists
to catch. Always open at least one document.

## 4. Supabase — logical dump

```bash
pg_dump "$SUPABASE_DB_URL" --format=custom --file="supabase-$(date +%F-%H%M).dump"
```

## 5. Supabase — restore into an isolated project

```bash
pg_restore --clean --if-exists --no-owner --dbname="$ISOLATED_DB_URL" "supabase-….dump"
```

## 6. Supabase — verify triggers restored too

Trigger-maintained counters are easy to lose in a restore and invisible until
much later. Check explicitly:

```sql
-- The trigger must exist
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;

-- And it must actually fire
UPDATE posts SET likes_count = 0 WHERE id = '<test id>';
INSERT INTO post_likes (post_id, user_id) VALUES ('<test id>', '<user id>');
SELECT likes_count FROM posts WHERE id = '<test id>';  -- expect 1
```

## 7. Cross-database consistency after restore

Restore both stores from **the same point in time**. Restoring Mongo from
Thursday and Supabase from Tuesday produces a system that looks healthy and is
inconsistently wrong.

```bash
node scripts/reconcile-supabase.js            # dry-run — read it first
node scripts/reconcile-supabase.js --apply    # only once you agree with the report
```

## 8. Record the result

| Field | Value |
|---|---|
| Date | |
| Who ran it | |
| Backup timestamp restored | |
| Target (isolated?) | |
| Time to restore Mongo | |
| Time to restore Supabase | |
| Time to full verification | |
| Row/document counts matched? | |
| Triggers verified firing? | |
| Drift after restore | |
| **Would this have met our RTO?** | |

---

## §19 — Backup encryption and secret separation

| Rule | Reason |
|---|---|
| Backups are encrypted at rest and in transit | A backup is a complete copy of everything |
| **`.env` is never included in a backup** | A backup is copied to more places than the app is; secrets should not travel with it |
| Backups and credentials are stored in **different** locations with **different** access | Possession of a backup should not imply possession of the keys |
| Secret scanning runs over backup manifests | A stray key in a dump is invisible until it is exfiltrated |
| Restore credentials are distinct from application credentials | Restoring is more powerful than running; it should not be possible with the app's key |

**Verify no secrets are in the backup:**

```bash
# .env must not be present anywhere in the archive
tar -tzf backup.tar.gz | grep -E '(^|/)\.env' && echo "FAIL" || echo "OK"

# Scan for credential shapes
grep -rIlE 'SUPABASE_SERVICE_ROLE_KEY=|UPSTASH_REDIS_REST_TOKEN=|JWT_SECRET=' ./staging-restore/ || echo "no plaintext secrets"
```

---

## The honest caveat

Steps 1–8 have **not** been executed against a real deployment from this
sandbox — there is no `mongodump`, `pg_dump` or `psql` binary here. The
commands are the correct ones for this architecture, but the drill is not
complete until someone has run it end to end and filled in the table in §8.
Until then, the restore is unproven.
