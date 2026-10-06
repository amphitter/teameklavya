#!/usr/bin/env node
/**
 * EventHub — Part 5, Phase 8 selftest (docs & retention)
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers spec §53/§54 (retention classification + TTL safety) and §69/§73/§74
 * (documentation deliverables).
 *
 * The most important assertions here are the NEGATIVE ones: this suite fails if
 * anyone ever adds a TTL index to `users` or `mediaassets`, because both would
 * destroy data (see docs/DATA-RETENTION.md §4). Those are cheap mistakes to
 * make and expensive to discover.
 *
 * Run: npm run test:phase8
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.join(__dirname, "..", "..");
const BACKEND = path.join(REPO, "backend");

/* ── harness ─────────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures = [];
let section = "";

function sec(name) {
  section = name;
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 58 - name.length))}`);
}

function ok(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(`[${section}] ${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(label, actual, expected) {
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 2 });

  const User = require("../models/user.model");
  const LiveMessage = require("../models/liveMessage.model");
  const QAQuestion = require("../models/qaQuestion.model");
  const Activity = require("../models/activity.model");
  const Event = require("../models/event.model");

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. TTL safety (§53) — the negative assertions that matter most
   * ══════════════════════════════════════════════════════════════════════ */

  sec("1. TTL index safety (§53)");

  const modelsDir = path.join(BACKEND, "models");
  const modelFiles = fs.readdirSync(modelsDir).filter((f) => f.endsWith(".model.js"));
  ok("models are discoverable", modelFiles.length >= 30, `${modelFiles.length} files`);

  const ttlHits = [];
  for (const f of modelFiles) {
    const src = fs.readFileSync(path.join(modelsDir, f), "utf8");
    src.split("\n").forEach((line, i) => {
      if (/expireAfterSeconds/.test(line)) ttlHits.push(`${f}:${i + 1}`);
    });
  }
  ok("no TTL index exists on any model", ttlHits.length === 0, ttlHits.join(", "));

  // The two specific traps, asserted separately so a failure says WHICH one.
  const userSrc = fs.readFileSync(path.join(modelsDir, "user.model.js"), "utf8");
  ok("NO TTL on users (it would delete accounts when an OTP expires)",
    !/expireAfterSeconds/.test(userSrc));

  // Guard the fields themselves exist, so the check above stays meaningful.
  ok("users still carries the expiring token fields", /resetOtpExpires/.test(userSrc) && /emailVerifyExpires/.test(userSrc));

  const mediaSrc = fs.readFileSync(path.join(modelsDir, "mediaAsset.model.js"), "utf8");
  ok("NO TTL on mediaassets (it would orphan the remote file)",
    !/expireAfterSeconds/.test(mediaSrc));
  ok("mediaassets is reclaimed by the sweeper instead", /cleanupAfter/.test(mediaSrc));

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. Retention sweeper — auth token fields
   * ══════════════════════════════════════════════════════════════════════ */

  sec("2. Retention sweeper — token fields (§53)");

  const past = new Date(Date.now() - 3600e3);
  const future = new Date(Date.now() + 3600e3);

  const stale = await User.create({
    firstName: "Stale", lastName: "Codes", email: "stale@x.io", passwordHash: "x",
    emailVerifyToken: "dead-verify", emailVerifyExpires: past,
    resetOtp: "123456", resetOtpExpires: past,
    passwordResetToken: "dead-reset", passwordResetTokenExpires: past,
  });
  const live = await User.create({
    firstName: "Live", lastName: "Codes", email: "live@x.io", passwordHash: "x",
    resetOtp: "654321", resetOtpExpires: future,
  });
  const clean = await User.create({ firstName: "Clean", lastName: "User", email: "clean@x.io", passwordHash: "x" });

  const run = (args) =>
    execFileSync("node", ["scripts/retention-sweeper.js", ...args], {
      cwd: BACKEND, encoding: "utf8", env: { ...process.env },
    });

  // ── dry run must change nothing ──
  const dry = run(["--section=tokens"]);
  ok("dry run reports the user with expired codes", /users with an expired code\s*:\s*1/.test(dry), dry);
  ok("dry run says it is a dry run", /dry run/i.test(dry));

  let staleAfter = await User.findById(stale._id).lean();
  ok("dry run did NOT clear the fields", staleAfter.resetOtp === "123456");

  // ── apply ──
  const applied = run(["--section=tokens", "--apply"]);
  ok("apply reports it committed", /committed/.test(applied), applied);

  staleAfter = await User.findById(stale._id).lean();
  ok("THE USER STILL EXISTS (no account was deleted)", Boolean(staleAfter));
  ok("expired verify token cleared", staleAfter.emailVerifyToken === undefined);
  ok("expired reset OTP cleared", staleAfter.resetOtp === undefined);
  ok("expired password reset token cleared", staleAfter.passwordResetToken === undefined);
  ok("expiry fields cleared alongside their tokens",
    staleAfter.emailVerifyExpires === undefined && staleAfter.resetOtpExpires === undefined);

  // ── a live code must survive ──
  const liveAfter = await User.findById(live._id).lean();
  ok("a LIVE reset OTP is preserved", liveAfter.resetOtp === "654321");
  ok("its expiry is preserved too", liveAfter.resetOtpExpires !== undefined);

  // ── an untouched user stays untouched ──
  const cleanAfter = await User.findById(clean._id).lean();
  ok("a user with no codes is untouched", Boolean(cleanAfter) && cleanAfter.resetOtp === undefined);

  eq("no user was deleted", await User.countDocuments(), 3);

  // ── idempotent ──
  const again = run(["--section=tokens", "--apply"]);
  ok("a second run finds nothing to do", /users with an expired code\s*:\s*0/.test(again), again);
  eq("still three users", await User.countDocuments(), 3);

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. Live archival is opt-in (§54)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("3. Live chat / Q&A archival is opt-in (§54)");

  const ev = await Event.create({
    title: "Retention Event", slug: `retention-${Date.now()}`, description: "d",
    category: "Workshop", eventType: "offline", venue: "Hall",
    startDate: new Date(Date.now() - 7200e3), endDate: new Date(Date.now() - 3600e3),
    visibility: "public", createdBy: clean._id,
  });
  const act = await Activity.create({ event: ev._id, type: "QA", title: "Ask", order: 0, state: "LIVE" });

  const old = new Date(Date.now() - 400 * 24 * 3600e3);
  // NB — LiveMessage uses `sender`; QAQuestion uses `author`. Neither is `user`.
  await LiveMessage.create([
    { event: ev._id, sender: clean._id, text: "ancient chat", createdAt: old },
    { event: ev._id, sender: clean._id, text: "recent chat" },
  ]);
  await QAQuestion.create([
    { event: ev._id, activity: act._id, author: clean._id, text: "ancient question", createdAt: old },
    { event: ev._id, activity: act._id, author: clean._id, text: "recent question" },
  ]);

  // Default: disabled.
  delete process.env.RETENTION_LIVE_ARCHIVE_DAYS;
  const offRun = run(["--section=live"]);
  ok("archival is skipped when the window is unset", /skipped/.test(offRun), offRun);
  ok("the reason is spelled out", /RETENTION_LIVE_ARCHIVE_DAYS/.test(offRun));
  eq("no live message was removed", await LiveMessage.countDocuments(), 2);
  eq("no Q&A question was removed", await QAQuestion.countDocuments(), 2);

  // Enabled: only the old rows go.
  process.env.RETENTION_LIVE_ARCHIVE_DAYS = "180";
  const onDry = run(["--section=live"]);
  ok("with a window set, old rows are counted", /messages: 1/.test(onDry) && /questions: 1/.test(onDry), onDry);
  eq("dry run still removed nothing", await LiveMessage.countDocuments(), 2);

  const onApply = run(["--section=live", "--apply"]);
  ok("apply reports the archive", /committed/.test(onApply), onApply);
  eq("only the ancient message was removed", await LiveMessage.countDocuments(), 1);
  eq("only the ancient question was removed", await QAQuestion.countDocuments(), 1);
  const kept = await LiveMessage.findOne().lean();
  eq("the recent message survives", kept.text, "recent chat");

  delete process.env.RETENTION_LIVE_ARCHIVE_DAYS;

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. Script ergonomics
   * ══════════════════════════════════════════════════════════════════════ */

  sec("4. Script ergonomics");

  const jsonRun = run(["--section=tokens", "--json"]);
  let parsed = null;
  try { parsed = JSON.parse(jsonRun.trim().split("\n").pop()); } catch { /* fall through */ }
  ok("--json emits parseable JSON", parsed !== null);
  ok("JSON carries the operation name", parsed?.op === "retention.sweep");
  ok("JSON carries the mode", parsed?.mode === "dry-run");
  ok("JSON carries a duration", typeof parsed?.durationMs === "number");

  const mediaRun = run(["--section=media"]);
  ok("media section reports without deleting", /pending/.test(mediaRun), mediaRun);
  ok("media section points at the right tool", /media:sweep/.test(mediaRun));

  const invRun = run(["--section=inventory"]);
  ok("inventory lists collections", /users/.test(invRun) && /events/.test(invRun), invRun);

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. Documentation deliverables (§69, §73, §74)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("5. Documentation (§69/§73/§74)");

  const docs = {
    "DATA-RETENTION.md": [
      /TEMPORARY/i, /PERMANENT/i, /TTL/, /never auto-deleted/i,
    ],
    "BACKUP-STRATEGY.md": [
      /mongodump/, /mongorestore/, /Cloudinary/i, /R2/,
      /restore drill/i, /RTO|RPO/,
    ],
    "PERFORMANCE-ARCHITECTURE.md": [
      /cach/i, /rate limit/i, /pool/i, /pagination/i, /batch/i,
      /monitor/i, /failure/i, /realtime/i, /image/i,
    ],
  };

  for (const [file, patterns] of Object.entries(docs)) {
    const p = path.join(REPO, "docs", file);
    ok(`docs/${file} exists`, fs.existsSync(p));
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    for (const re of patterns) {
      ok(`docs/${file} covers ${re}`, re.test(src));
    }
  }

  // §74 requires a diagram.
  const arch = fs.readFileSync(path.join(REPO, "docs", "PERFORMANCE-ARCHITECTURE.md"), "utf8");
  ok("§74 — the architecture doc contains a diagram",
    /┌|└|─{4,}/.test(arch) || /```/.test(arch));
  ok("the diagram names the frontend", /Next\.js/i.test(arch));
  ok("the diagram names MongoDB", /MongoDB/i.test(arch));
  ok("the diagram names Cloudinary", /Cloudinary/i.test(arch));
  ok("the diagram states the no-direct-access rule (§3)",
    /never/i.test(arch) && /Cloudinary/i.test(arch) && /R2/.test(arch));

  // The retention doc must actually classify, not just describe.
  const retention = fs.readFileSync(path.join(REPO, "docs", "DATA-RETENTION.md"), "utf8");
  for (const name of ["users", "events", "posts", "certificates", "eventresults"]) {
    ok(`retention doc classifies ${name}`, new RegExp(`\\b${name}\\b`).test(retention));
  }
  ok("retention doc explains the user-TTL trap", /delete accounts|delete the user|DELETE THE USER/i.test(retention));
  ok("retention doc explains the media-TTL orphan trap", /orphan/i.test(retention));

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. Configuration surface
   * ══════════════════════════════════════════════════════════════════════ */

  sec("6. Configuration surface");

  const envExample = fs.readFileSync(path.join(BACKEND, ".env.example"), "utf8");
  ok(".env.example documents the live archive window", /RETENTION_LIVE_ARCHIVE_DAYS/.test(envExample));
  ok(".env.example states that unset means keep forever", /KEEP FOREVER/i.test(envExample));
  ok(".env.example documents the Phase 6 caps", /REALTIME_CAP_SOCKETS_PER_USER/.test(envExample));
  ok(".env.example documents the Phase 7 budgets", /INFRA_BUDGET_MONGO_MB/.test(envExample));
  ok("every documented retention var is optional", /#\s*RETENTION_LIVE_ARCHIVE_DAYS/.test(envExample));

  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, "package.json"), "utf8"));
  ok("npm run retention:sweep exists", typeof pkg.scripts["retention:sweep"] === "string");
  ok("npm run retention:sweep:apply exists", typeof pkg.scripts["retention:sweep:apply"] === "string");
  ok("the default retention script is a dry run", !pkg.scripts["retention:sweep"].includes("--apply"));
  ok("npm run media:sweep still exists", typeof pkg.scripts["media:sweep"] === "string");
  ok("test:all includes phase8", /phase8/.test(pkg.scripts["test:all"]));

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  Phase 8 selftest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log(`   • ${f}`));
  }
  console.log(`${"═".repeat(64)}\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("\n💥 selftest crashed:", e);
  process.exit(1);
});
