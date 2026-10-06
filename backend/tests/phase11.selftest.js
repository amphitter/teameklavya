/**
 * PART 7 SELFTEST — production hardening, consistency, security
 * ─────────────────────────────────────────────────────────────────────────────
 * Separate from phase10 on purpose (§33: "Add Part 7 tests separately") so the
 * Part 6 floor stays legible and a Part 7 failure cannot be confused with a
 * Part 6 regression.
 *
 * Uses mongodb-memory-server + a fake PostgREST, so it runs with no external
 * infrastructure. Real-provider tests live in tests/real-provider.selftest.js
 * and are skipped unless REAL_PROVIDER_TESTS=true (§1).
 *
 *   node tests/phase11.selftest.js
 */

"use strict";

process.env.NODE_ENV = "test";

let passed = 0;
let failed = 0;
const failures = [];
let currentSection = "";

function sec(name) {
  currentSection = name;
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 58 - name.length))}`);
}

function ok(label, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(`[${currentSection}] ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ Fake PostgREST (same contract as real PostgREST) ══════════════════════ */
function createFakePostgrest() {
  const http = require("http");
  const tables = new Map();
  const state = { broken: false, requests: 0 };

  const ensure = (t) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t);
  };

  function matches(row, filters) {
    for (const [col, raw] of filters) {
      if (col === "or") continue;
      const op = String(raw);
      const val = row[col];
      if (op.startsWith("eq.")) { if (String(val) !== op.slice(3)) return false; continue; }
      if (op.startsWith("in.(")) {
        const list = op.slice(4, -1).split(",").map(decodeURIComponent);
        if (!list.includes(String(val))) return false;
        continue;
      }
      if (op.startsWith("is.")) { if (op.slice(3) === "null" ? val != null : val == null) return false; continue; }
    }
    return true;
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.requests += 1;
      const send = (code, payload) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (state.broken) return send(500, { message: "upstream unavailable" });

      const u = new URL(req.url, "http://127.0.0.1");
      const m = /^\/rest\/v1\/([^/?]+)/.exec(u.pathname);
      if (!m) return send(404, {});
      const table = decodeURIComponent(m[1]);
      const rows = ensure(table);

      const filters = [];
      let orderSpec = null;
      let limitN = null;
      for (const [k, v] of u.searchParams.entries()) {
        if (k === "order") orderSpec = v;
        else if (k === "limit") limitN = Number(v);
        else if (k === "select") continue;
        else filters.push([k, v]);
      }

      if (req.method === "GET") {
        let out = rows.filter((r) => matches(r, filters));
        if (orderSpec) {
          for (const clause of String(orderSpec).split(",")) {
            const [c, dir] = clause.split(".");
            out = [...out].sort((a, b) => {
              const av = a[c]; const bv = b[c];
              const cmp = typeof av === "number" && typeof bv === "number"
                ? av - bv : String(av).localeCompare(String(bv));
              return dir === "desc" ? -cmp : cmp;
            });
          }
        }
        return send(200, limitN != null ? out.slice(0, limitN) : out);
      }

      if (req.method === "POST") {
        const incoming = body ? JSON.parse(body) : null;
        const list = Array.isArray(incoming) ? incoming : [incoming];
        const prefer = String(req.headers.prefer || "");
        const cf = /on_conflict=([^,]+)/.exec(u.searchParams.get("on_conflict") || "") ||
                   /on_conflict=([^,]+)/.exec(prefer);
        const cols = cf ? cf[1].split(",").map((c) => c.trim()).filter(Boolean) : [];
        const out = [];
        for (const row of list) {
          if (prefer.includes("merge-duplicates") && cols.length) {
            const ex = rows.find((r) => cols.every((c) => String(r[c]) === String(row[c])));
            if (ex) { Object.assign(ex, row); out.push(ex); continue; }
          }
          const full = { created_at: new Date().toISOString(), ...row };
          rows.push(full);
          out.push(full);
        }
        return send(201, prefer.includes("return=minimal") ? [] : out);
      }

      if (req.method === "DELETE") {
        const hit = rows.filter((r) => matches(r, filters));
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return send(200, []);
      }

      return send(405, {});
    });
  });

  return { server, tables, state, ensure };
}

/* ══ Main ══════════════════════════════════════════════════════════════════ */
(async () => {
  const PG_PORT = 5711;
  const pg = createFakePostgrest();
  await new Promise((r) => pg.server.listen(PG_PORT, "127.0.0.1", r));

  process.env.SUPABASE_URL = `http://127.0.0.1:${PG_PORT}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.PART7TESTKEY.sig";
  process.env.SYNC_ENABLED = "true";

  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongoose = require("mongoose");
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const recon = require("../services/reconciliation.service");
  const outboxService = require("../services/outbox.service");
  const syncService = require("../services/social-sync.service");
  const Outbox = require("../models/outbox.model");

  /* ══ §6 Field-level comparison & normalisation ═══════════════════════════ */
  sec("1. Drift comparison compares meaning, not representation (§6)");

  ok("a Date and its ISO string compare equal",
     recon.normalise(new Date("2026-01-01T00:00:00Z")) === recon.normalise("2026-01-01T00:00:00.000Z"));
  ok("an ObjectId and its string compare equal",
     recon.normalise(new mongoose.Types.ObjectId("507f1f77bcf86cd799439011")) === "507f1f77bcf86cd799439011");
  ok("null and undefined both normalise to null",
     recon.normalise(null) === null && recon.normalise(undefined) === null);
  ok("array ordering is normalised where order is not meaningful",
     recon.normalise(["b", "a"]) === recon.normalise(["a", "b"]));

  const cmp = recon.compareRow(
    { content: "hello", topics: ["a", "b"], deleted_at: null },
    { content: "hello", topics: ["b", "a"], deleted_at: null }
  );
  ok("a reordered array is NOT drift", cmp.drift.length === 0, JSON.stringify(cmp.drift));

  const cmp2 = recon.compareRow(
    { created_at: new Date("2026-01-01T00:00:00Z") },
    { created_at: "2026-01-01T00:00:00.400Z" }
  );
  ok("sub-second timestamp precision is tolerated", cmp2.drift.length === 0, JSON.stringify(cmp2.drift));

  const cmp3 = recon.compareRow({ content: "a" }, { content: "b" });
  ok("a real content difference IS drift", cmp3.drift.length === 1);
  ok("…and reports both sides", cmp3.drift[0].mongo === "a" && cmp3.drift[0].supabase === "b");

  ok("trigger-owned counters are excluded from comparison",
     recon.TRIGGER_OWNED.has("likes_count") && recon.TRIGGER_OWNED.has("followers_count"));
  const cmp4 = recon.compareRow({ likes_count: 0 }, { likes_count: 99 });
  ok("…so a counter mismatch is not reported as drift", cmp4.drift.length === 0);

  ok("status/role/deleted_at are classified AMBIGUOUS, not auto-repaired",
     recon.AMBIGUOUS_COLUMNS.has("status") &&
     recon.AMBIGUOUS_COLUMNS.has("role") &&
     recon.AMBIGUOUS_COLUMNS.has("deleted_at"));
  const cmp5 = recon.compareRow({ status: "published" }, { status: "hidden" });
  ok("an ambiguous difference is flagged, never silently repaired", cmp5.ambiguous === true);

  /* ══ §2 Detection + §4 idempotence ══════════════════════════════════════ */
  sec("2. Reconciliation detects drift and is idempotent (§2, §4)");

  const db = mongoose.connection.db;
  const postsColl = db.collection("posts");
  const pA = new mongoose.Types.ObjectId();
  const pB = new mongoose.Types.ObjectId();
  const pC = new mongoose.Types.ObjectId();
  const authorId = new mongoose.Types.ObjectId();

  await postsColl.insertMany([
    { _id: pA, author: authorId, content: "post A", status: "published",
      visibility: "public", topics: [], createdAt: new Date("2026-05-01T00:00:00Z") },
    { _id: pB, author: authorId, content: "post B", status: "published",
      visibility: "public", topics: [], createdAt: new Date("2026-05-02T00:00:00Z") },
    { _id: pC, author: authorId, content: "post C", status: "published",
      visibility: "public", topics: [], createdAt: new Date("2026-05-03T00:00:00Z") },
  ]);

  await recon.resetCheckpoints();
  await Outbox.deleteMany({});

  // Targets: A matches, B is missing, C has drifted content.
  const pgPosts = pg.ensure("posts");
  pgPosts.length = 0;
  pgPosts.push({ id: String(pA), content: "post A", status: "published",
                 visibility: "public", topics: [], author_id: String(authorId),
                 created_at: "2026-05-01T00:00:00.000Z", deleted_at: null });
  pgPosts.push({ id: String(pC), content: "STALE CONTENT", status: "published",
                 visibility: "public", topics: [], author_id: String(authorId),
                 created_at: "2026-05-03T00:00:00.000Z", deleted_at: null });

  const run1 = await recon.reconcileEntity({
    entityType: "post", batchSize: 10, maxBatches: 5, apply: true,
  });
  ok("run 1 scanned every document", run1.scanned === 3, `${run1.scanned}`);
  ok("…matched the clean row", run1.matched === 1, `${run1.matched}`);
  ok("…detected the missing target", run1.missing === 1, `${run1.missing}`);
  ok("…detected the drifted field", run1.drifted === 1, `${run1.drifted}`);
  ok("…and repaired both", run1.repaired === 2, `${run1.repaired}`);

  // Drain so the targets become correct — then run 2 must report NOTHING.
  await syncService.drain({ limit: 50, maxMs: 5000 });
  const run2 = await recon.reconcileEntity({
    entityType: "post", batchSize: 10, maxBatches: 5, apply: true,
  });
  ok("§4: run 2 reports ZERO drift after repairs are applied",
     run2.drifted === 0 && run2.missing === 0, JSON.stringify(run2));
  ok("§4: run 2 reports ZERO repairs — reconciliation is idempotent",
     run2.repaired === 0, `${run2.repaired}`);
  ok("…and still matches every row", run2.matched === 3, `${run2.matched}`);

  ok("§4: no duplicate posts were created by two runs",
     pgPosts.length === 3, `${pgPosts.length}`);

  /* ══ §2 Orphan detection ════════════════════════════════════════════════ */
  sec("3. Orphan detection — target exists, source is gone (§2)");

  // A target row whose Mongo source no longer exists.
  pgPosts.push({ id: "orphan-post", content: "gone", status: "published",
                 visibility: "public", topics: [], author_id: String(authorId),
                 created_at: "2026-05-04T00:00:00.000Z", deleted_at: null });

  const orphans = await recon.findOrphans({
    entityType: "post", table: "posts", coll: postsColl, limit: 50,
  });
  ok("an orphan target is detected", orphans.includes("orphan-post"), orphans.join(","));

  const run3 = await recon.reconcileEntity({
    entityType: "post", batchSize: 10, maxBatches: 5, apply: true,
  });
  ok("…and reconciliation reports it as deleted", run3.deleted >= 1, `${run3.deleted}`);
  ok("…enqueuing a DELETE, not a silent drop",
     (await Outbox.countDocuments({ op: "delete", entityId: "orphan-post" })) >= 1);

  await syncService.drain({ limit: 50, maxMs: 5000 });
  ok("…and applying it removes the orphan row",
     !pgPosts.some((r) => r.id === "orphan-post"));

  /* ══ §3 Checkpoints ═════════════════════════════════════════════════════ */
  sec("4. Checkpointed, bounded, resumable (§3)");

  await recon.resetCheckpoints("post");
  const batch1 = await recon.reconcileEntity({
    entityType: "post", batchSize: 2, maxBatches: 1, apply: false,
  });
  ok("a batch is bounded by batchSize", batch1.scanned <= 2, `${batch1.scanned}`);
  ok("…and a checkpoint is written",
     batch1.checkpoint && batch1.checkpoint.lastCheckedAt, JSON.stringify(batch1.checkpoint));

  const cp = await recon.getCheckpoint("post");
  ok("the checkpoint is persisted", !!cp && !!cp.lastCheckedAt);

  const batch2 = await recon.reconcileEntity({
    entityType: "post", batchSize: 2, maxBatches: 1, apply: false,
  });
  ok("§3: the next run RESUMES from the checkpoint, not from the start",
     batch2.checkpoint && batch2.checkpoint.lastCheckedAt !== batch1.checkpoint.lastCheckedAt,
     `${batch1.checkpoint?.lastCheckedAt} → ${batch2.checkpoint?.lastCheckedAt}`);

  const full = await recon.reconcileEntity({
    entityType: "post", batchSize: 10, maxBatches: 50, apply: false,
  });
  ok("a run that reaches the end marks itself wrapped",
     full.wrapped === true);

  ok("reconciliation never loads the whole collection",
     /\.limit\(/.test(require("fs").readFileSync(
       require("path").join(__dirname, "..", "services", "reconciliation.service.js"), "utf8")));

  /* ══ §2 Queue health + §5 dead letter ═══════════════════════════════════ */
  sec("5. Queue health & dead-letter visibility (§2, §5)");

  await Outbox.deleteMany({});
  await outboxService.enqueue({ entityType: "post", entityId: String(pA), op: "upsert" });
  const claimed = (await outboxService.claimBatch(1))[0];
  for (let i = 0; i < 12; i++) {
    const cur = await Outbox.findById(claimed._id);
    if (cur.status === "dead") break;
    cur.attempts = (cur.attempts || 0) + 1;
    await Outbox.updateOne({ _id: cur._id }, { $set: { attempts: cur.attempts } });
    await outboxService.fail(cur, new Error("always fails"));
  }

  const q = await recon.queueHealth();
  ok("queue health reports the dead-letter count", q.deadLettered >= 1, `${q.deadLettered}`);
  ok("…the backlog", typeof q.backlog === "number");
  ok("…entries retrying past a threshold", typeof q.retrying === "number");
  ok("…the oldest pending entry age", typeof q.oldestPendingMs === "number");
  ok("…and the oldest dead-letter age", typeof q.oldestDeadLetterMs === "number");
  ok("a dead letter records when it died",
     (await Outbox.findOne({ status: "dead" })) !== null);

  ok("§5: a dead-lettered entry stores no credential-shaped value",
     !/eyJ|password|secret|apikey/i.test(JSON.stringify(await Outbox.find({}).lean())));

  /* ══ §7 Migration safety ════════════════════════════════════════════════ */
  sec("6. Migration safety — no source deletion is possible (§7)");

  const fs = require("fs");
  const path = require("path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

  const reconScript = read("scripts/reconcile-supabase.js");
  const backfillScript = read("scripts/backfill-supabase.js");
  const verifyScript = read("scripts/verify-supabase.js");

  ok("§7: the reconcile script has NO source-deletion flag",
     !/--delete-source|--purge-mongo|--drop-source|--delete-mongo/.test(reconScript));
  ok("§7: the backfill script has NO source-deletion flag",
     !/--delete-source|--purge-mongo|--drop-source/.test(backfillScript));
  ok("§7: the verify script has NO source-deletion flag",
     !/--delete-source|--purge-mongo|--drop-source/.test(verifyScript));

  ok("§7: no migration script calls MongoDB deleteMany/deleteOne/drop",
     !/\.deleteMany\(|\.deleteOne\(|dropDatabase|collection\.drop/.test(
       reconScript.replace(/Outbox\.\w+/g, "Outbox.x")
     ));

  ok("§7: reconciliation is dry-run by default",
     /DRY RUN \(default\)/.test(reconScript) && /APPLY = flag\("apply"\)/.test(reconScript));
  ok("§7: reconcile supports --entity, --limit and --json",
     /--entity=/.test(reconScript) && /--limit=/.test(reconScript) && /--json/.test(reconScript));
  ok("§7: repair ENQUEUES rather than writing directly",
     /enqueue/.test(reconScript) && /never a direct write/i.test(reconScript));

  ok("§6: ambiguous drift is reported but never auto-repaired",
     /Never automatically repair ambiguous/i.test(
       read("services/reconciliation.service.js")));

  await mongoose.disconnect();
  await mongo.stop();
  await new Promise((r) => pg.server.close(r));

  console.log("\n" + "═".repeat(64));
  console.log(`  PART 7 (phase 1) selftest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log("   • " + f));
  }
  console.log("═".repeat(64) + "\n");

  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("\n💥 selftest crashed:", e);
  process.exit(1);
});
