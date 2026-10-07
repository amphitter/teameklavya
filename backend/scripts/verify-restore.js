#!/usr/bin/env node
/**
 * EventHub Restore Verifier (Part 7, §18)
 * ───────────────────────────────────────
 * Answers one question the restore drill otherwise leaves to guesswork:
 * **is the data that came back actually correct?**
 *
 * `mongorestore` exits 0 when it has finished writing. It does not know
 * whether the data is complete, whether references still resolve, or whether
 * half a collection is missing. A restore that "worked" and a restore that
 * worked are different things, and the difference only shows up later, under
 * load, when a user opens a registration that points at an event that isn't
 * there.
 *
 * Run this after every drill, and after every real restore.
 *
 * USAGE
 *   node scripts/verify-restore.js --target mongodb://host/restored
 *   node scripts/verify-restore.js --target mongodb://host/restored \
 *                                  --source mongodb://host/live
 *   node scripts/verify-restore.js --target ... --json report.json
 *
 * --source is optional but strongly recommended: without it the verifier can
 * only check internal consistency, not completeness. A restore that dropped
 * 40% of registrations is internally consistent and still a disaster.
 *
 * READ-ONLY. It never writes, never drops, never "repairs". If something is
 * wrong the operator decides what to do — an automated fixer here would be a
 * dangerous thing to point at production.
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = bad usage.
 */
"use strict";

const mongoose = require("mongoose");

/* ── CLI ─────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { target: null, source: null, json: null, sampleSize: 200, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--target": case "-t": out.target = next(); break;
      case "--source": case "-s": out.source = next(); break;
      case "--json": out.json = next(); break;
      case "--sample-size": out.sampleSize = Number(next()); break;
      case "--quiet": out.quiet = true; break;
      case "--help": case "-h": out.help = true; break;
      default: break;
    }
  }
  return out;
}

/* ── What a healthy EventHub database contains ───────────────────────── */

/**
 * Collections that MUST exist after a restore. A missing collection is not
 * "empty because nobody used it" — it means the dump did not include it.
 */
const REQUIRED_COLLECTIONS = [
  "users", "events", "registrations", "organizations", "communities",
  "posts", "comments", "tickets", "activities", "questions",
  "notifications", "mediaassets", "outboxes",
];

/**
 * Referential integrity rules: [child, field, parent, parentField].
 *
 * These are the relationships that break visibly in the product when a
 * partial restore happens — a registration whose event is gone, a comment
 * whose post is gone. Checked by sampled join, not by scanning everything,
 * because the point is to finish before the operator loses patience.
 */
const REFERENCES = [
  ["registrations", "event", "events", "_id"],
  ["registrations", "user", "users", "_id"],
  ["tickets", "event", "events", "_id"],
  ["posts", "author", "users", "_id"],
  ["comments", "post", "posts", "_id"],
  ["activities", "event", "events", "_id"],
  ["questions", "event", "events", "_id"],
];

/**
 * Fields that must be present on every document of a collection. A restore
 * that lands documents with missing required fields is worse than one that
 * lands nothing, because the app will serve half-built objects.
 */
const REQUIRED_FIELDS = {
  users: ["email"],
  events: ["title"],
  registrations: ["event", "user"],
  tickets: ["event"],
  posts: ["author"],
};

/* ── Checks ──────────────────────────────────────────────────────────── */

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  if (!quiet) {
    console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  }
  return pass;
}
let quiet = false;

async function listCollections(db) {
  const cols = await db.listCollections({}, { nameOnly: true }).toArray();
  return cols.map((c) => c.name);
}

async function verify(targetUri, sourceUri, sampleSize) {
  const target = await mongoose.createConnection(targetUri, { serverSelectionTimeoutMS: 15000 }).asPromise();
  const tdb = target.db;

  let source = null;
  let sdb = null;
  if (sourceUri) {
    try {
      source = await mongoose.createConnection(sourceUri, { serverSelectionTimeoutMS: 15000 }).asPromise();
      sdb = source.db;
    } catch (err) {
      check("source database is reachable for comparison", false, err.message);
    }
  }

  try {
    console.log("\n── 1. Connectivity & structure ──");
    check("target database is reachable", true, targetUri.replace(/\/\/[^@]*@/, "//***@"));

    const present = await listCollections(tdb);
    const missing = REQUIRED_COLLECTIONS.filter((c) => !present.includes(c));
    check(
      `all ${REQUIRED_COLLECTIONS.length} required collections exist`,
      missing.length === 0,
      missing.length ? `MISSING: ${missing.join(", ")}` : "all present"
    );

    console.log("\n── 2. Document counts ──");
    const counts = {};
    for (const c of REQUIRED_COLLECTIONS) {
      if (!present.includes(c)) { counts[c] = null; continue; }
      counts[c] = await tdb.collection(c).countDocuments({});
      console.log(`     ${c.padEnd(16)} ${counts[c]}`);
    }

    /* A restore of a live system that yields zero users is not an empty
       database — it is a failed one. Flag it rather than reporting zeros. */
    check("users collection is not empty", (counts.users || 0) > 0, `${counts.users || 0} users`);
    check("events collection is not empty", (counts.events || 0) > 0, `${counts.events || 0} events`);

    console.log("\n── 3. Completeness vs source ──");
    if (sdb) {
      const sPresent = await listCollections(sdb);
      let mismatch = 0;
      const detail = [];
      for (const c of REQUIRED_COLLECTIONS) {
        if (!present.includes(c) || !sPresent.includes(c)) continue;
        const sCount = await sdb.collection(c).countDocuments({});
        const tCount = counts[c] || 0;
        // Allow the source to have grown since the backup was taken: a restore
        // that is BEHIND is expected; one that is AHEAD is impossible.
        if (tCount > sCount) { mismatch += 1; detail.push(`${c}: restored ${tCount} > live ${sCount}`); }
        else if (sCount > 0) {
          const pct = (tCount / sCount) * 100;
          if (pct < 99) { mismatch += 1; detail.push(`${c}: only ${pct.toFixed(1)}% of source`); }
        }
      }
      check(
        "restored counts are consistent with the source",
        mismatch === 0,
        mismatch ? detail.join("; ") : "within tolerance (source may have grown since backup)"
      );
    } else {
      console.log("     ⚠ no --source given: completeness NOT verified, only internal consistency");
      check("completeness vs source", false, "skipped — pass --source to verify completeness");
    }

    console.log("\n── 4. Referential integrity (sampled) ──");
    let brokenRefs = 0;
    const refDetail = [];
    for (const [child, field, parent, _pf] of REFERENCES) {
      if (!present.includes(child) || !present.includes(parent)) continue;
      const sample = await tdb.collection(child).find({ [field]: { $exists: true, $ne: null } })
        .limit(sampleSize).toArray();
      if (!sample.length) continue;
      const ids = [...new Set(sample.map((d) => String(d[field])))];
      const parentIds = new Set(
        (await tdb.collection(parent).find({ _id: { $in: ids.map((i) => toObjectId(i)) } }, { projection: { _id: 1 } }).toArray())
          .map((d) => String(d._id))
      );
      const orphans = ids.filter((i) => !parentIds.has(i));
      if (orphans.length) {
        brokenRefs += orphans.length;
        refDetail.push(`${child}.${field} → ${orphans.length} orphan(s) of ${ids.length} checked`);
      }
    }
    check("no orphaned references in the sampled data", brokenRefs === 0,
      brokenRefs ? refDetail.join("; ") : `${REFERENCES.length} relationships sampled clean`);

    console.log("\n── 5. Required fields ──");
    let missingFields = 0;
    const fieldDetail = [];
    for (const [coll, fields] of Object.entries(REQUIRED_FIELDS)) {
      if (!present.includes(coll)) continue;
      for (const f of fields) {
        const n = await tdb.collection(coll).countDocuments({
          $or: [{ [f]: { $exists: false } }, { [f]: null }, { [f]: "" }],
        });
        if (n > 0) { missingFields += n; fieldDetail.push(`${coll}.${f}: ${n} document(s)`); }
      }
    }
    check("no document is missing a required field", missingFields === 0,
      missingFields ? fieldDetail.join("; ") : "all required fields populated");

    console.log("\n── 6. Indexes ──");
    /* Indexes are the most commonly lost thing in a restore and the least
       visible: everything works, then gets slow. */
    const idxIssues = [];
    for (const c of ["users", "events", "registrations"]) {
      if (!present.includes(c)) continue;
      const idx = await tdb.collection(c).indexes();
      if (idx.length <= 1) idxIssues.push(`${c}: only the _id index`);
    }
    check("secondary indexes survived the restore", idxIssues.length === 0,
      idxIssues.length ? idxIssues.join("; ") : "indexes present on users, events, registrations");

    console.log("\n── 7. Freshness ──");
    /* How stale is this restore? A backup from three weeks ago restores
       perfectly and is still useless after an incident today. */
    let newest = null;
    for (const c of ["events", "registrations", "posts"]) {
      if (!present.includes(c)) continue;
      const doc = await tdb.collection(c).find({}, { projection: { createdAt: 1 } })
        .sort({ createdAt: -1 }).limit(1).toArray();
      if (doc[0]?.createdAt) {
        const d = new Date(doc[0].createdAt);
        if (!newest || d > newest) newest = d;
      }
    }
    if (newest) {
      const ageDays = (Date.now() - newest.getTime()) / 86400000;
      console.log(`     newest document: ${newest.toISOString()} (${ageDays.toFixed(1)} days old)`);
      check("backup is less than 30 days old", ageDays < 30,
        `${ageDays.toFixed(1)} days — older backups restore fine but cost more data loss`);
    } else {
      check("a newest-document timestamp could be read", false, "no dated documents found");
    }

    return { counts, present };
  } finally {
    await target.close().catch(() => {});
    if (source) await source.close().catch(() => {});
  }
}

function toObjectId(str) {
  try { return new mongoose.Types.ObjectId(String(str)); } catch { return String(str); }
}

/* ── Main ────────────────────────────────────────────────────────────── */

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  quiet = opts.quiet;

  if (opts.help || !opts.target) {
    console.log(`
EventHub Restore Verifier (Part 7, §18) — READ-ONLY

  node scripts/verify-restore.js --target <mongo-uri> [--source <mongo-uri>] [--json file]

  --target   the RESTORED database to verify        (required)
  --source   the live database, for completeness     (strongly recommended)
  --json     write a machine-readable report
  --quiet    suppress per-check output

Without --source the verifier can only prove internal consistency. A restore
that dropped 40% of registrations is internally consistent and still a
disaster, so pass --source whenever you can.

Exit: 0 = PASS, 1 = FAIL, 2 = usage error.
`);
    process.exit(opts.help ? 0 : 2);
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  RESTORE VERIFICATION");
  console.log("══════════════════════════════════════════════════════════════");

  let report;
  try {
    report = await verify(opts.target, opts.source, opts.sampleSize);
  } catch (err) {
    console.error(`\n  verification could not run: ${err.message}\n`);
    process.exit(1);
  }

  const failures = results.filter((r) => !r.pass);
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  ${failures.length === 0 ? "PASS" : "FAIL"} — ${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length) {
    for (const f of failures) console.log(`    · ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  }
  console.log("══════════════════════════════════════════════════════════════\n");

  if (opts.json) {
    require("fs").writeFileSync(opts.json, JSON.stringify({ results, counts: report.counts }, null, 2));
    console.log(`  report written to ${opts.json}\n`);
  }

  process.exit(failures.length ? 1 : 0);
})();
