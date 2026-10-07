/**
 * PART 7 — PHASE 12 (§18, §19)
 * Restore drill, backup integrity, secret separation.
 * ────────────────────────────────────────────────────────────
 * §18  a restored database can be PROVEN correct, not just assumed
 * §19  credentials do not travel with a backup or an artifact
 *
 * Both tools here are verified by running them against deliberately broken
 * input. Asserting that a verifier "looks like it checks things" is how you
 * ship a verifier that has never caught anything.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function sec(t) { console.log(`\n── ${t} ──`); }
function ok(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

const runNode = (args, env = {}) =>
  spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });

/**
 * Reclaim disk from mongodb-memory-server instances left behind by earlier
 * suites in the `test:all` chain.
 *
 * Each in-memory mongod reserves ~200 MB of tmpfs. Six e2e suites ahead of
 * this one leave enough stale directories that the next mongod refuses to
 * start with "available disk space is less than the required minimum" —
 * which reports as a product failure and is purely an artifact of the
 * sandbox.
 *
 * Called only AFTER mongod has already refused to start, so nothing is
 * deleted unless there is a demonstrated need. `force` drops the freshness
 * guard, which is safe on the retry: by then the earlier suites are done.
 */
function reclaimStaleMongoDirs({ force = false } = {}) {
  if (process.platform === "win32") return 0;
  const tmp = os.tmpdir();
  const FRESH_MS = 60000;
  let reclaimed = 0;
  try {
    for (const entry of fs.readdirSync(tmp)) {
      if (!/^mongo-mem-/.test(entry)) continue;
      const full = path.join(tmp, entry);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (!force && Date.now() - st.mtimeMs < FRESH_MS) continue; // possibly live
      try {
        fs.rmSync(full, { recursive: true, force: true });
        reclaimed += 1;
      } catch { /* in use — leave it */ }
    }
  } catch { /* tmp unreadable — nothing to do */ }
  return reclaimed;
}

async function startMongo() {
  try {
    return await MongoMemoryServer.create();
  } catch (err) {
    if (!/disk space/i.test(String(err && err.message))) throw err;
    const n = reclaimStaleMongoDirs({ force: true });
    console.log(`  (disk pressure — reclaimed ${n} stale mongod dir(s), retrying)`);
    return MongoMemoryServer.create();
  }
}

/* ══════════════════════════════════════════════════════════════════════
   §18 — restore verification
   ══════════════════════════════════════════════════════════════════════ */

async function auditRestoreVerifier() {
  sec("§18 — a restored database can be proven correct");

  const script = path.join(ROOT, "scripts", "verify-restore.js");
  ok("the restore verifier exists", fs.existsSync(script));
  const src = fs.readFileSync(script, "utf8");

  /* Usage: it must refuse to guess which database to inspect. Pointing a
     verifier at the wrong connection string is how people restore-test prod. */
  const noArgs = runNode([script]);
  ok("it refuses to run without an explicit --target", noArgs.status === 2, `exit ${noArgs.status}`);

  /* READ-ONLY, and provably so. A verifier that can repair is a verifier that
     can destroy when someone runs it in a hurry against the wrong host. */
  const destructive = /\.(dropDatabase|dropCollection|drop|deleteMany|deleteOne|remove|replaceOne|updateOne|updateMany|bulkWrite|insertOne|insertMany)\s*\(/.test(src);
  ok("the verifier performs no writes, drops or deletes", !destructive,
    destructive ? "found mutating calls" : "read-only by construction");

  /* It must check these things, or a partial restore passes as healthy. */
  const checks = [
    ["missing collections", /REQUIRED_COLLECTIONS/],
    ["orphaned references", /REFERENCES/],
    ["missing required fields", /REQUIRED_FIELDS/],
    ["lost secondary indexes", /indexes\(/],
    ["backup freshness", /ageDays|30/],
    ["completeness against a source", /--source|sourceUri/],
  ];
  for (const [what, re] of checks) {
    ok(`it checks for ${what}`, re.test(src));
  }

  /* ── Behavioural: build a database, break it, and require the tool to say so. */
  const mongoose = require("mongoose");
  const { ObjectId } = mongoose.Types;

  const seed = async (uri, { nReg = 5, orphan = false, dropIndexes = false } = {}) => {
    const c = await mongoose.createConnection(uri).asPromise();
    const db = c.db;
    const uid = new ObjectId();
    const eid = new ObjectId();
    const pid = new ObjectId();
    await db.collection("users").insertOne({ _id: uid, email: "a@b.com", createdAt: new Date() });
    await db.collection("events").insertOne({ _id: eid, title: "E", createdAt: new Date() });
    for (let i = 0; i < nReg; i += 1) {
      await db.collection("registrations").insertOne({ event: eid, user: uid, createdAt: new Date() });
    }
    await db.collection("tickets").insertOne({ event: eid, createdAt: new Date() });
    await db.collection("posts").insertOne({ _id: pid, author: uid, createdAt: new Date() });
    // A healthy comment points at that post. `orphan: true` points at one that
    // was never created — the failure mode of a partial restore.
    await db.collection("comments").insertOne({
      post: orphan ? new ObjectId() : pid,
      createdAt: new Date(),
    });
    // Every collection the verifier requires, or "MISSING: …" is reported.
    for (const n of [
      "organizations", "communities", "notifications", "mediaassets", "outboxes",
      "activities", "questions",
    ]) {
      await db.collection(n).insertOne({ createdAt: new Date() });
    }
    if (!dropIndexes) {
      await db.collection("users").createIndex({ email: 1 });
      await db.collection("events").createIndex({ slug: 1 });
      await db.collection("registrations").createIndex({ event: 1 });
    }
    await c.close();
  };

  /* ONE in-memory server, several databases.
     Each mongod wants ~500 MB of free disk, so two concurrent instances
     exhaust a tmpfs sandbox and the suite dies with OutOfDiskSpace — which
     reads as a product failure and is not one. Different database names on
     one server are also closer to reality: a restore target is usually
     another database on the same cluster, not another cluster. */
  const dbUri = (name) => `${mongod.getUri()}${name}`;

  const withDb = async (name, opts, fn) => {
    const uri = dbUri(name);
    await seed(uri, opts);
    return fn(uri);
  };

  const runBehaviouralChecks = async () => {
    const srcUri = dbUri("source_db");
    await seed(srcUri, { nReg: 10 });

    // A faithful restore: same shape, full counts, indexes intact, no orphans.
    const good = await withDb("good_db", { nReg: 10 }, (uri) =>
      runNode([script, "--target", uri, "--source", srcUri, "--quiet"]));
    ok("a faithful restore is reported PASS", good.status === 0,
      `exit ${good.status} ${(good.stdout || "").split("\n").filter((l) => /·/.test(l)).join(" ")}`);

    // A partial restore: only 3 of 10 registrations came back.
    const partial = await withDb("partial_db", { nReg: 3 }, (uri) =>
      runNode([script, "--target", uri, "--source", srcUri, "--quiet"]));
    ok("a partial restore is reported FAIL", partial.status === 1, `exit ${partial.status}`);
    ok("…and says WHY (names the shortfall)", /30\.0%|only .* of source|registrations/i.test(partial.stdout),
      (partial.stdout || "").split("\n").filter((l) => /·/.test(l)).join(" "));

    // An orphaned reference: what a partial restore does to relations.
    const orph = await withDb("orphan_db", { nReg: 10, orphan: true }, (uri) =>
      runNode([script, "--target", uri, "--source", srcUri, "--quiet"]));
    ok("an orphaned reference is detected", orph.status === 1 && /orphan/i.test(orph.stdout),
      (orph.stdout || "").split("\n").filter((l) => /·/.test(l)).join(" "));

    // Indexes are the quietest thing a restore loses: everything works, slowly.
    const idxRun = await withDb("noidx_db", { nReg: 10, dropIndexes: true }, (uri) =>
      runNode([script, "--target", uri, "--source", srcUri, "--quiet"]));
    ok("lost indexes are detected", idxRun.status === 1 && /index/i.test(idxRun.stdout));

    // Without --source, completeness cannot be verified and the tool must say
    // so rather than implying the restore was fine.
    const noSource = await withDb("nosrc_db", { nReg: 10 }, (uri) =>
      runNode([script, "--target", uri, "--quiet"]));
    ok("without --source it refuses to imply completeness",
      noSource.status === 1 && /source/i.test(noSource.stdout));
  };

  /* Two attempts. When the e2e suites ahead of this one leave stale mongod
     directories behind, the FIRST failure is an environment artifact rather
     than a product defect — so reclaim and try once more before believing
     the result. Counters roll back so a retry does not inflate the totals. */
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const passedBefore = passed;
    const failedBefore = failed;
    const failLenBefore = failures.length;
    try {
      mongod = await startMongo();
      await runBehaviouralChecks();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      passed = passedBefore;
      failed = failedBefore;
      failures.length = failLenBefore;
      if (mongod) { await mongod.stop().catch(() => {}); mongod = null; }
      if (attempt < 2 && /disk space|OutOfDiskSpace/i.test(String(err && err.message))) {
        const n = reclaimStaleMongoDirs({ force: true });
        console.log(`  (disk pressure — reclaimed ${n} stale mongod dir(s), retrying)`);
        continue;
      }
      ok("restore verifier behavioural suite ran", false, err && err.message);
    }
  }
  if (mongod) await mongod.stop().catch(() => {});
}

/* ══════════════════════════════════════════════════════════════════════
   §19 — secret separation
   ══════════════════════════════════════════════════════════════════════ */

function auditSecretSeparation() {
  sec("§19 — credentials do not travel with a backup or an artifact");

  const script = path.join(ROOT, "scripts", "scan-secrets.js");
  ok("the secret scanner exists", fs.existsSync(script));
  const src = fs.readFileSync(script, "utf8");

  /* A scanner that echoes the secret into CI logs has leaked the very thing
     it exists to protect. */
  ok("the scanner redacts values instead of printing them", /REDACTED/.test(src));

  /* ── Behavioural: the repo itself must scan clean. ── */
  const repoScan = runNode([script]);
  ok("the repository scans clean", repoScan.status === 0,
    (repoScan.stdout || "").split("\n").filter((l) => /❌/.test(l)).slice(0, 3).join(" | "));

  /* ── Behavioural: plant real-looking secrets and require detection. ── */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-secrets-"));

  /* The planted secrets are assembled from fragments rather than written as
     literals. The scanner is CORRECT to flag a literal key in this file, and
     exempting this file would be exactly the wrong lesson. No fragment may
     leave a matchable credential contiguous either: `scheme://u:${PW}@host`
     still matches, because the pattern's character class happily consumes
     `${...}` as if it were a password. So the scheme is its own variable. */
  const frag = (...parts) => parts.join("");
  const SCHEME = frag("mongodb", "+srv");
  const RSCHEME = frag("redis", "s");
  const PEM_OPEN = frag("-----BEGIN RSA ", "PRIVATE KEY-----");
  const PEM_CLOSE = frag("-----END RSA ", "PRIVATE KEY-----");

  const CANARY = frag("7Xqk9ZmN4pQrTvWy", "B3cDfGhJkL2sAaBb", "CcDdEeFf012");
  const MONGO_PW = frag("Tr0ub4dor", "Xk9Qw");
  const REDIS_PW = frag("9fK2mQpXzL7", "vBn4R");
  const JWS_HEAD = frag("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", ".", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0.");

  const MONGO_URI = frag(SCHEME, "://admin:", MONGO_PW, "@cluster0.abcdef.mongodb.net/eventhub");
  const REDIS_URL = frag(RSCHEME, "://default:", REDIS_PW, "@apn1-xyz-12345.upstash.io:6379");
  const PEM = frag(PEM_OPEN, "\nMIIEowIBAAKCAQEAx7Q\n", PEM_CLOSE);

  try {
    fs.writeFileSync(path.join(dir, ".env"), [
      `SUPABASE_SERVICE_ROLE_KEY=${JWS_HEAD}${CANARY}`,
      `MONGO_URI=${MONGO_URI}`,
      `REDIS_URL=${REDIS_URL}`,
      "STRIPE=" + frag("sk_live_", "51H8xQ2eZvKYlo2C9RtYwUiOp"),
    ].join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "key.pem"), PEM + "\n");

    const hit = runNode([script, "--path", dir]);
    ok("a planted .env is detected", hit.status === 1, `exit ${hit.status}`);

    const out = hit.stdout || "";
    for (const [label, re] of [
      ["an env file", /ENV_FILE/],
      ["a Supabase service-role key", /SUPABASE_SERVICE_ROLE/],
      ["a Mongo URI with inline credentials", /MONGO_URI_WITH_CREDS/],
      ["a Redis URL with a password", /REDIS_URL_WITH_CREDS/],
      ["a Stripe secret key", /STRIPE_KEY/],
      ["a PEM private key", /PRIVATE_KEY/],
    ]) {
      ok(`it detects ${label}`, re.test(out));
    }

    /* The canary is the point: if it appears in output, the scanner leaked
       the credential it was meant to protect. */
    ok("the scanner never prints the secret itself", !out.includes(CANARY),
      out.includes(CANARY) ? "CANARY LEAKED INTO OUTPUT" : "canary absent from output");
    ok("…nor the Mongo password", !out.includes(MONGO_PW));
    ok("…nor the Redis password", !out.includes(REDIS_PW));

    /* Fixtures in the real codebase (test passwords, example hosts) must NOT
       be reported — a scanner that cries wolf gets disabled. */
    const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), "eh-fixtures-"));
    fs.writeFileSync(path.join(fixtures, "a.js"), [
      'process.env.JWT_SECRET = "test-secret-for-e2e-only";',
      'const password = "ScaleTest123!";',
      // Built from parts so this file does not itself contain a matchable URI.
      'scrub("' + SCHEME + '://u:' + "hunter2" + '@cluster.example.net/db");',
    ].join("\n"));
    const clean = runNode([script, "--path", fixtures]);
    ok("test fixtures are not reported as secrets", clean.status === 0,
      (clean.stdout || "").split("\n").filter((l) => /❌/.test(l)).join(" | "));
    fs.rmSync(fixtures, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ── Static: .env must never be committed. ── */
  const gitignorePath = path.join(ROOT, "..", ".gitignore");
  const gi = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  ok(".env is git-ignored", /^\.env$/m.test(gi));

  const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout || "";
  const trackedEnv = tracked.split("\n").filter((f) => /(^|\/)\.env$/.test(f));
  ok("no .env file is tracked in git", trackedEnv.length === 0, trackedEnv.join(", "));

  /* Backups and artifacts should not be built from a directory containing
     secrets in the first place — say so in the docs. */
  const docsDir = path.join(ROOT, "docs");
  const docs = fs.readdirSync(docsDir).map((f) => fs.readFileSync(path.join(docsDir, f), "utf8")).join("\n");
  ok("the docs state that backups must exclude .env and secrets",
    /\.env/.test(docs) && /secret/i.test(docs));
  ok("the docs cover encryption at rest / secret separation",
    /encrypt/i.test(docs) && /secret/i.test(docs));
  ok("the restore drill names the data-loss question a restore must answer",
    /RPO|RTO|how much data|lose/i.test(docs));

  /* npm reachability — a tool nobody can invoke is a tool nobody runs. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  ok("`npm run scan-secrets` is registered", !!pkg.scripts["scan-secrets"]);
  ok("`npm run verify-restore` is registered", !!pkg.scripts["verify-restore"]);
}

/* ══════════════════════════════════════════════════════════════════════ */

let mongod = null;
const { MongoMemoryServer } = require("mongodb-memory-server");

(async () => {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  PART 7 (phase 12) restore drill & secret separation");
  console.log("══════════════════════════════════════════════════════════════");
  try {
    await auditRestoreVerifier();
    auditSecretSeparation();
  } catch (err) {
    failed += 1;
    failures.push(`suite crashed: ${err && err.message}`);
    console.log(String((err && err.stack) || err));
  }
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  PART 7 (phase 12) selftest: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`    · ${f}`);
  }
  console.log("══════════════════════════════════════════════════════════════\n");
  process.exit(failed === 0 ? 0 : 1);
})();
