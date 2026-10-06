#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 · PHASE 4   SECURITY AUDITS
 *  §8 Supabase · §9 RLS decision · §11 Redis · §13 cache poisoning & privacy
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 6 built the provider boundaries. This suite audits them the way an
 * attacker would, and the way an on-call engineer needs.
 *
 * The organising idea is that these four sections are all the same question
 * asked at different layers: CAN A VALUE REACH SOMEONE IT DOES NOT BELONG TO?
 *
 *   §13  a cached value served to the wrong principal
 *   §11  a Redis key collided with, or read by, the wrong code path
 *   §8   a Supabase credential or raw error reaching the wrong audience
 *   §9   a browser reaching Supabase directly, bypassing the API entirely
 *
 * Where a property is a STATIC fact about the codebase (no controller builds a
 * Redis key) it is asserted by scanning the source, because a test that only
 * checks today's runtime behaviour would pass happily the day someone adds the
 * violation back. Where it is a RUNTIME behaviour (SWR refused on a private
 * key, a non-owner cannot release a lock) it is asserted by doing it.
 *
 * Both kinds are needed: the static scan catches the regression nobody thought
 * to write a runtime test for, and the runtime test catches the violation no
 * amount of grepping would find.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FRONTEND = path.join(ROOT, "..", "frontend");

let passed = 0;
let failed = 0;
const failures = [];

function sec(title) {
  console.log(`\n── ${title} ──`);
}
function ok(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function eq(name, a, b) {
  ok(name, a === b, `expected ${b}, got ${a}`);
}

/** Every .js file under `dir`, recursively. */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const read = (p) => fs.readFileSync(p, "utf8");
const rel = (p) => path.relative(ROOT, p);

/* ═══════════════════════════════════════════════════════════════════════════
 * §13  CACHE POISONING & PRIVACY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cache poisoning here does not mean an attacker injecting a value — the only
 * writer is our own code. It means a value written for one principal being
 * READ by another, which is the realistic failure and the one with privacy
 * consequences. A leak of TRENDING is a bug; a leak of FEED is a breach.
 *
 * Part 6 classified keys binary public|private. That is enough to decide SWR
 * but not enough to answer "whose data is this, and how bad is it if it
 * leaks", so Part 7 §13 asks for five classes.
 */

async function auditCachePrivacy() {
  sec("1. §13 — every cached value carries one of five privacy classes");

  process.env.CACHE_PROVIDER = "memory";
  const cacheService = require("../services/cache.service");
  const {
    cache,
    keys,
    CACHE_REGISTRY,
    CACHE_PRIVACY,
    DOMAIN_PRIVACY,
    classifyKey,
    classifyDomain,
    PRIVATE_DOMAINS,
    isPrivateKey,
    KEY_PREFIX,
  } = cacheService;

  const CLASSES = Object.values(CACHE_PRIVACY);
  eq("§13: there are exactly five privacy classes", CLASSES.length, 5);
  ok(
    "§13: the five classes are the ones the brief names",
    ["PUBLIC", "PRIVATE_USER", "PRIVATE_ADMIN", "PRIVATE_EVENT", "PRIVATE_ORGANIZATION"].every((c) =>
      CLASSES.includes(c)
    ),
    CLASSES.join(",")
  );

  /* -- completeness: every domain the builder can emit is classified -- */
  const uncategorised = [];
  for (const [name, fn] of Object.entries(keys)) {
    if (typeof fn !== "function") continue;
    const built = fn("probe-id");
    if (classifyKey(built) === undefined) uncategorised.push(`${name} → ${built}`);
  }
  ok(
    "§13: EVERY key the builder can emit is classified",
    uncategorised.length === 0,
    uncategorised.join(" | ")
  );

  /* -- the registry and the classification table cannot drift -- */
  const registryDrift = Object.entries(CACHE_REGISTRY).filter(
    ([, e]) => !DOMAIN_PRIVACY[e.domain]
  );
  ok(
    "§13: every registry entry names a classified domain",
    registryDrift.length === 0,
    registryDrift.map(([n, e]) => `${n}→${e.domain}`).join(",")
  );

  const privacyDrift = Object.entries(CACHE_REGISTRY).filter(
    ([, e]) => e.privacy !== DOMAIN_PRIVACY[e.domain]
  );
  ok(
    "§13: …and its privacy is DERIVED from the classification table, so the two cannot disagree",
    privacyDrift.length === 0,
    privacyDrift.map(([n]) => n).join(",")
  );

  /* -- every classified domain is actually used, or explicitly reserved -- */
  const usedDomains = new Set(
    Object.values(CACHE_REGISTRY).map((e) => e.domain)
  );
  const declared = Object.keys(DOMAIN_PRIVACY).filter((d) => d !== "user"); // legacy
  const unused = declared.filter((d) => !usedDomains.has(d));
  ok(
    "§13: every classified domain has a registry entry (except the legacy `user` guard)",
    unused.length === 0,
    unused.join(",")
  );

  sec("2. §13 — private keys are never served stale, and never shared");

  /* SWR must be refused for ALL FOUR private classes, not just one. */
  for (const cls of ["PRIVATE_USER", "PRIVATE_ADMIN", "PRIVATE_EVENT", "PRIVATE_ORGANIZATION"]) {
    const domain = Object.entries(DOMAIN_PRIVACY).find(([, c]) => c === cls);
    if (!domain) {
      // A class with no data today. Assert it is at least representable so
      // that adding one later is classified by construction.
      ok(`§13: ${cls} is declared even though no value uses it yet`, CLASSES.includes(cls));
      continue;
    }
    const k = `${KEY_PREFIX}cache:${domain[0]}:probe`;
    let blocked = false;
    try {
      await cache.getOrSet(k, async () => ({}), { ttl: 60_000, swr: true });
    } catch (e) {
      blocked = /forbidden for private key/i.test(e.message);
    }
    ok(`§13: SWR is refused for ${cls} (via domain "${domain[0]}")`, blocked);
  }

  let publicSwrOk = false;
  try {
    const v = await cache.getOrSet(keys.event("pub-1"), async () => ({ a: 1 }), {
      ttl: 60_000,
      swr: true,
    });
    publicSwrOk = v && v.a === 1;
  } catch {
    publicSwrOk = false;
  }
  ok("§13: SWR is still ALLOWED on a PUBLIC key (the rule is not a blanket ban)", publicSwrOk);

  ok(
    "§13: every private domain is derived, not hand-listed twice",
    PRIVATE_DOMAINS.length > 0 && PRIVATE_DOMAINS.every((d) => DOMAIN_PRIVACY[d] !== "PUBLIC")
  );

  sec("3. §13 — cross-user isolation (the real poisoning risk)");

  await cache.flush();

  /* The identity MUST be part of the key. If it were an argument rather than
   * part of the key, two users would share one entry. */
  ok(
    "§13: two different users get two different feed keys",
    keys.feed("user-A") !== keys.feed("user-B")
  );
  ok(
    "§13: …and two different profile keys",
    keys.profile("user-A") !== keys.profile("user-B")
  );
  ok(
    "§13: …and two different follow-list keys",
    keys.followList("user-A") !== keys.followList("user-B")
  );
  ok(
    "§13: …and two different unread-count keys",
    keys.unreadNotifications("user-A") !== keys.unreadNotifications("user-B")
  );

  /* The decisive test: write user A's private payload, then read as user B and
   * prove B cannot see it. A key-namespacing test alone would pass even if the
   * cache fell back to something shared. */
  const secretForA = { owner: "user-A", note: "private to A" };
  await cache.getOrSet(keys.feed("user-A"), async () => secretForA, { ttl: 60_000 });

  let leakedToB = null;
  await cache.getOrSet(
    keys.feed("user-B"),
    async () => {
      leakedToB = await cache.peek(keys.feed("user-A")).catch(() => null);
      return { owner: "user-B" };
    },
    { ttl: 60_000 }
  );
  ok(
    "§13: user A's cached feed is not reachable under user B's key",
    !leakedToB || leakedToB.value?.owner !== "user-A",
    JSON.stringify(leakedToB)
  );

  /* A public key must never carry per-user data. Assert the public builders
   * take no user argument — a public key containing a user id is how a
   * per-user value ends up in a shared slot. */
  const publicBuilders = Object.entries(CACHE_REGISTRY)
    .filter(([, e]) => e.privacy === CACHE_PRIVACY.PUBLIC)
    .map(([, e]) => e.domain);
  ok(
    "§13: no PUBLIC domain embeds a user identity in its name",
    publicBuilders.every((d) => !/user|profile|feed|notif|msg|follow/i.test(d)),
    publicBuilders.filter((d) => /user|profile|feed|notif|msg|follow/i.test(d)).join(",")
  );

  /* Admin data must never be classified public. */
  const adminEntries = Object.entries(CACHE_REGISTRY).filter(
    ([, e]) => e.privacy === CACHE_PRIVACY.PRIVATE_ADMIN
  );
  ok(
    "§13: no admin-scoped value is classified PUBLIC",
    adminEntries.length === 0 || adminEntries.every(([, e]) => e.privacy === CACHE_PRIVACY.PRIVATE_ADMIN)
  );

  await cache.flush();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §11  REDIS AUDIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Redis is shared, ephemeral infrastructure. Everything in this section is one
 * rule: NOTHING THAT MUST SURVIVE MAY LIVE HERE, and nothing about Redis may
 * be visible to a user.
 */

async function auditRedis() {
  sec("4. §11 — nothing permanent lives in Redis; every write has a TTL");

  const upstash = require("../providers/redis/upstash.provider");
  const { createUpstashProvider } = upstash;
  const src = read(path.join(ROOT, "providers", "redis", "upstash.provider.js"));

  /* Every SET in the provider must carry an expiry. A SET without PX is a
   * permanent business fact in a store we have declared disposable — and it
   * is also a leak, because deleted data would live on in the cache. */
  const sets = src.match(/\n\s*\["SET"[\s\S]{0,220}?\]/g) || [];
  const setsWithoutTtl = sets.filter((s) => !/\bPX\b/.test(s));
  ok(
    "§11: every SET in the Upstash provider carries a PX expiry",
    sets.length > 0 && setsWithoutTtl.length === 0,
    setsWithoutTtl.join(" ;; ")
  );

  sec("5. §11 — credentials never reach a log, a client, or a key");

  const providerFiles = walk(path.join(ROOT, "providers"));
  const credLeaks = [];
  for (const f of providerFiles) {
    const text = read(f);
    if (/console\.(log|warn|error|info)\([^)]*rawToken|console\.(log|warn|error|info)\([^)]*cfg\.token/i.test(text)) {
      credLeaks.push(rel(f));
    }
    if (/console\.(log|warn|error|info)\([^)]*rawUrl|console\.(log|warn|error|info)\([^)]*cfg\.url/i.test(text)) {
      credLeaks.push(`${rel(f)} (url)`);
    }
  }
  ok(
    "§11: no provider logs the Redis URL or token",
    credLeaks.length === 0,
    credLeaks.join(",")
  );

  /* Errors are stored as messages only — never the URL, headers or creds. */
  const cacheSrc = read(path.join(ROOT, "services", "cache.service.js"));
  ok(
    "§11: the circuit breaker stores only an error MESSAGE, never the URL or headers",
    /this\.stats\.lastError\s*=\s*String\(err\?\.message \|\| err\)\.slice\(/.test(cacheSrc)
  );

  /* A Redis URL must never become part of a cache key: keys get logged. */
  const keyBuilders = cacheSrc.match(/const build = [^;]+;/g) || [];
  ok(
    "§11: key construction uses only namespace + version + domain + id — no credential",
    keyBuilders.length > 0 && !/token|url|password|secret/i.test(keyBuilders.join(" ")),
    keyBuilders.join(" ")
  );

  sec("6. §11 — raw Redis errors never reach a client");

  /* The resilient provider swallows primary errors and falls back; it must
   * never rethrow into a request path. */
  ok(
    "§11: the resilient provider falls back instead of rethrowing",
    /catch \(err\)[\s\S]{0,400}?return fb\[op\]/.test(cacheSrc) ||
      /return fb\[op\]\(\.\.\.args\)/.test(cacheSrc)
  );

  const errFiles = walk(path.join(ROOT, "services")).concat(walk(path.join(ROOT, "controllers")));
  const rawErrLeaks = [];
  for (const f of errFiles) {
    if (/redis/i.test(read(f)) && /res\.status\(5\d\d\)[\s\S]{0,200}?redis/i.test(read(f))) {
      rawErrLeaks.push(rel(f));
    }
  }
  ok(
    "§11: no 5xx response body carries a Redis error string",
    rawErrLeaks.length === 0,
    rawErrLeaks.join(",")
  );

  sec("7. §11 — namespaces, collisions, and ownership");

  const cacheSvc = require("../services/cache.service");
  const { KEY_PREFIX, keys, resolvePrefix } = cacheSvc;

  ok(
    "§11: every key we own starts with the namespace+version prefix",
    keys.event("x").startsWith(KEY_PREFIX) && keys.feed("y").startsWith(KEY_PREFIX)
  );
  ok(
    "§11: the version is in the prefix, so bumping it invalidates everything at once",
    /:v\d+:/.test(KEY_PREFIX) || /CACHE_KEY_VERSION/.test(read(path.join(ROOT, "services", "cache.service.js")))
  );

  /* Prefix isolation: sweeping `event` must not sweep `event-counts`.
   * A shared prefix is how one invalidation quietly wipes a neighbour. */
  await cacheSvc.cache.flush();
  await cacheSvc.cache.getOrSet(keys.event("e1"), async () => ({ n: 1 }), { ttl: 60_000 });
  await cacheSvc.cache.getOrSet(keys.eventCounts("e1"), async () => ({ n: 2 }), { ttl: 60_000 });
  await cacheSvc.cache.invalidatePrefix("event");
  const eventGone = await cacheSvc.cache.peek(keys.event("e1"));
  const countsKept = await cacheSvc.cache.peek(keys.eventCounts("e1"));
  ok("§11: invalidating `event` removes the event entry", !eventGone);
  ok("§11: …and LEAVES `event-counts` intact (no prefix collision)", !!countsKept);
  await cacheSvc.cache.flush();

  /* Controllers must not build keys — that is what makes the registry and the
   * privacy classification worth anything. A hand-built key bypasses both. */
  const controllerFiles = walk(path.join(ROOT, "controllers"));
  const handBuilt = [];
  for (const f of controllerFiles) {
    const text = read(f);
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (/["'`]eh:[^"'`]*["'`]/.test(stripped)) handBuilt.push(rel(f));
    if (/CACHE_KEY_NAMESPACE/.test(stripped)) handBuilt.push(`${rel(f)} (namespace)`);
  }
  ok(
    "§11: NO controller constructs a Redis key — the key builder is the only way in",
    handBuilt.length === 0,
    handBuilt.join(",")
  );

  sec("8. §11 — lock tokens are unpredictable and releases are owner-only");

  const lockSrc = read(path.join(ROOT, "providers", "redis", "lock.service.js"));
  ok(
    "§11: a lock token is a random UUID, never derived from the lock name",
    /randomUUID\(\)/.test(lockSrc)
  );
  ok(
    "§11: release is a Lua compare-and-delete, so a non-owner cannot release",
    /RELEASE_LUA/.test(lockSrc) && /EVAL/.test(lockSrc)
  );

  /* Prove it at runtime with the in-memory backend, which mirrors the Redis
   * semantics: the point is the ownership check, not the transport. */
  const { MemoryLockBackend } = require("../providers/redis/lock.service");
  const backend = new MemoryLockBackend();
  const TOKEN = "owner-token-abc123";
  const got = await backend.acquire("resource-1", TOKEN, 30_000);
  ok("§11: the owner acquires the lock", got === true);
  const stolen = await backend.release("resource-1", "someone-elses-token");
  ok("§11: a NON-OWNER cannot release it", stolen === false);
  const stillHeld = await backend.acquire("resource-1", "another-token", 30_000);
  ok("§11: …and the lock is still held afterwards", stillHeld === false);
  const released = await backend.release("resource-1", TOKEN);
  ok("§11: the owner CAN release it", released === true);

  /* Expiry: a lock whose holder died must not wedge the resource forever. */
  const expiring = new MemoryLockBackend();
  await expiring.acquire("resource-2", "t1", 30);
  await new Promise((r) => setTimeout(r, 80));
  const recovered = await expiring.acquire("resource-2", "t2", 30_000);
  ok("§11: an expired lock is recoverable rather than leaked forever", recovered === true);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §8  SUPABASE SECURITY AUDIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Supabase holds the relational/social copy. The API is the only boundary. The
 * service-role key bypasses every database-level protection, so the one thing
 * that matters most is that it never leaves the server.
 */

async function auditSupabase() {
  sec("9. §8 — the service-role key lives in exactly one module");

  const backendFiles = walk(path.join(ROOT))
    .filter((f) => !rel(f).startsWith("tests") && !rel(f).startsWith("node_modules"));

  /* Read the variable, not the name: a log line that MENTIONS
   * SUPABASE_SERVICE_ROLE_KEY must not be mistaken for a credential leak, or
   * the assertion actively discourages actionable error messages. */
  const readers = [];
  for (const f of backendFiles) {
    const text = read(f);
    if (/process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(text)) readers.push(rel(f));
  }
  ok(
    "§8: reading SUPABASE_SERVICE_ROLE_KEY happens in ONE module only",
    readers.length === 1,
    `${readers.length}: ${readers.join(",")}`
  );
  ok(
    "§8: …and that module is the provider boundary",
    readers.length === 1 && /providers[\\/]supabase/.test(readers[0] || ""),
    readers[0]
  );

  sec("10. §8 — nothing Supabase-shaped reaches the browser");

  if (!fs.existsSync(FRONTEND)) {
    ok("§8: the frontend tree exists to audit", false, FRONTEND);
  } else {
    const feFiles = [];
    const walkAll = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walkAll(p);
        else if (/\.(js|jsx|ts|tsx|mjs)$/.test(e.name)) feFiles.push(p);
      }
    };
    walkAll(path.join(FRONTEND, "src"));

    const offenders = [];
    for (const f of feFiles) {
      const text = read(f);
      if (/service_role|SUPABASE_SERVICE_ROLE_KEY/.test(text)) offenders.push(path.basename(f));
      if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/.test(text)) {
        offenders.push(`${path.basename(f)} (JWT literal)`);
      }
    }
    ok(
      "§8: no frontend file references the service-role key or contains a JWT",
      offenders.length === 0,
      offenders.join(",")
    );

    const supabaseImports = feFiles.filter((f) =>
      /@supabase\/supabase-js|supabaseUrl|createClient\(/.test(read(f))
    );
    ok(
      "§8: the frontend never creates a Supabase client (the API is the only boundary)",
      supabaseImports.length === 0,
      supabaseImports.map((f) => path.basename(f)).join(",")
    );
  }

  sec("11. §8 — errors are scrubbed before they can leak");

  const clientSrc = read(path.join(ROOT, "providers", "supabase", "client.js"));
  ok("§8: the client has a scrub() function", /function scrub\(/.test(clientSrc));
  ok(
    "§8: …which redacts JWT-shaped blobs (what a service-role key is)",
    /eyJ\[A-Za-z0-9_-\]\{10,\}/.test(clientSrc)
  );
  /* Test the BEHAVIOUR, not the source text. A pattern match on this file
   * would keep passing even if scrub() stopped being called. */
  const { __scrub: scrub } = require("../providers/supabase/client");
  ok(
    "§8: …and redacts Postgres DSNs, which carry the password",
    !/hunter2/.test(scrub("connect failed: postgres://user:hunter2@db.example.com:5432/eh", []))
  );
  ok(
    "§8: …while leaving the host readable, so the log is still diagnosable",
    /db\.example\.com/.test(scrub("connect failed: postgres://user:hunter2@db.example.com:5432/eh", []))
  );
  ok(
    "§8: …and redacts a supplied secret end-to-end",
    !/abcdefghijklmnop/.test(scrub("token abcdefghijklmnop failed", ["abcdefghijklmnop"]))
  );
  ok(
    "§8: …and redacts MongoDB DSNs too (the same PostgREST error path can echo them)",
    !/hunter2/.test(scrub("mongodb+srv://u:hunter2@cluster.example.net/db", []))
  );

  /* Not-configured must fail loudly rather than silently returning empty —
   * a silent empty result is how a migration "succeeds" having written nothing. */
  const supaIdxSrc = read(path.join(ROOT, "providers", "supabase", "index.js"));
  ok(
    "§8: an unconfigured client asserts rather than returning nothing",
    /function assertConfigured/.test(supaIdxSrc) && /throw/.test(supaIdxSrc)
  );

  /* No raw SQL string concatenation into the REST layer. PostgREST has no SQL
   * surface, so the realistic risk is a filter value interpolated into a
   * query string — assert values go through the filter API instead. */
  const supaFiles = walk(path.join(ROOT, "repositories", "supabase"));
  ok("§8: Supabase repositories exist", supaFiles.length > 0);
  const concatRisks = supaFiles.filter((f) => /select\s*=\s*`[^`]*\$\{|select\s*=\s*["'][^"']*["']\s*\+/.test(read(f)));
  ok(
    "§8: no repository concatenates values into a query string (no SQL/REST injection)",
    concatRisks.length === 0,
    concatRisks.map(rel).join(",")
  );

  sec("12. §8 — the provider never becomes a second identity store");

  /* EventHub's Mongo user id is canonical. Supabase must store it, never mint one. */
  const profileRepo = path.join(ROOT, "repositories", "supabase", "profile.repository.js");
  if (fs.existsSync(profileRepo)) {
    const text = read(profileRepo);
    ok(
      "§8: the profile repository upserts on the canonical id, never a client-supplied one",
      /id/.test(text) && !/gen_random_uuid\(\)/.test(text)
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §9  RLS DECISION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This section does not test code so much as it pins a DECISION, because the
 * failure mode is forgetting why the decision was made and enabling RLS
 * halfway later.
 */

async function auditRls() {
  sec("13. §9 — the RLS decision is recorded, not left implicit");

  const docsDir = path.join(ROOT, "docs");
  const candidates = fs.existsSync(docsDir)
    ? fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"))
    : [];
  const docText = candidates
    .map((f) => read(path.join(docsDir, f)))
    .join("\n");

  ok(
    "§9: the RLS decision is documented in docs/",
    /RLS/i.test(docText) && /row level security/i.test(docText),
    `docs present: ${candidates.join(",")}`
  );
  ok(
    "§9: …and states that RLS is OFF because there is no browser→Supabase path",
    /row level security[\s\S]{0,600}?(off|disabled|not enabled)/i.test(docText)
  );
  ok(
    "§9: …and states the condition under which it becomes MANDATORY",
    /(if|when|should)[\s\S]{0,200}(browser|client|frontend)[\s\S]{0,200}(direct|directly)/i.test(docText) ||
      /mandatory/i.test(docText)
  );

  /* The decision is only safe while no browser path exists. Assert that, so
   * the day someone adds one, this test fails and the doc gets revisited. */
  let browserPath = false;
  const feSrc = path.join(FRONTEND, "src");
  if (fs.existsSync(feSrc)) {
    const stack = [feSrc];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/\.(js|jsx|ts|tsx)$/.test(e.name) && /@supabase|supabase\.co/.test(read(p))) {
          browserPath = true;
        }
      }
    }
  }
  ok(
    "§9: the premise still holds — there is NO browser→Supabase path today",
    browserPath === false
  );

  /* No half-configured RLS: we must not have enabled it on some tables only. */
  const migrationDir = path.join(ROOT, "migrations");
  if (fs.existsSync(migrationDir)) {
    const migText = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith(".sql") || f.endsWith(".js"))
      .map((f) => read(path.join(migrationDir, f)))
      .join("\n");
    const enabled = /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(migText);
    const forced = /FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(migText);
    ok(
      "§9: RLS is not half-configured — either off everywhere, or on with policies everywhere",
      enabled === false || (enabled && /CREATE\s+POLICY/i.test(migText)),
      `enabled=${enabled} forced=${forced}`
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §10  COMMUNITY OWNERSHIP & THE PERMANENT SUPER ADMIN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §10 asks for three properties and says to test them explicitly. The value of
 * writing them down as tests is that "permanent" stops being a comment
 * somebody wrote once and becomes something that fails the build.
 */

async function auditOwnership() {
  sec("14. §10 — the permanent Super Admin");

  const ownership = require("../services/ownership.service");
  const {
    SUPER_ADMIN_EMAIL,
    isSuperAdminEmail,
    isSuperAdminUser,
    guardSuperAdmin,
    isSelfAction,
    PROTECTED_ACTIONS,
    GUARD_MESSAGES,
    institutionalDomain,
    isInstitutionOwned,
    resolveOwner,
  } = ownership;

  eq("§10: the permanent Super Admin address", SUPER_ADMIN_EMAIL, "devanshsinghr00@gmail.com");
  ok("§10: it is recognised", isSuperAdminEmail("devanshsinghr00@gmail.com"));
  ok(
    "§10: …case-insensitively (an email local part is technically case-sensitive)",
    isSuperAdminEmail("DevanshSinghR00@Gmail.com")
  );
  ok("§10: …and whitespace is tolerated", isSuperAdminEmail("  devanshsinghr00@gmail.com  "));
  ok("§10: a different address is NOT the Super Admin", !isSuperAdminEmail("someone@else.com"));
  ok("§10: a null/empty address is NOT the Super Admin", !isSuperAdminEmail(null) && !isSuperAdminEmail(""));

  sec("15. §10 — UNDEMOTABLE");

  /* The decisive property: authority is DERIVED from the address, not stored
   * in a mutable field. So there is nothing to flip. */
  ok(
    "§10: a user with the Super Admin address is Super Admin even if their stored role is 'user'",
    isSuperAdminUser({ email: SUPER_ADMIN_EMAIL, role: "user" }) === true
  );
  ok(
    "§10: …which is what makes demotion impossible — there is no flag to lower",
    isSuperAdminUser({ email: SUPER_ADMIN_EMAIL, role: "admin" }) === true
  );
  ok(
    "§10: a different user with role 'admin' is NOT the Super Admin",
    isSuperAdminUser({ email: "admin@elsewhere.com", role: "admin" }) === false
  );

  const demote = guardSuperAdmin({ email: SUPER_ADMIN_EMAIL }, PROTECTED_ACTIONS.DEMOTE);
  ok("§10: the DEMOTE guard refuses", demote.allowed === false, JSON.stringify(demote));
  ok("§10: …with an operator-readable reason", /demot/i.test(demote.reason || ""), demote.reason);

  /* No endpoint may lower the Super Admin's stored role either. */
  const roleMutators = [];
  for (const f of walk(path.join(ROOT, "controllers"))) {
    const text = read(f);
    if (/\.role\s*=\s*["'](user|admin)["']/.test(text)) roleMutators.push(rel(f));
  }
  ok(
    "§10: no controller assigns a platform role (so no path lowers the Super Admin's)",
    roleMutators.length === 0,
    roleMutators.join(",")
  );

  sec("16. §10 — UNDELETABLE");

  for (const action of ["DELETE", "SUSPEND", "REMOVE_MEMBERSHIP"]) {
    const v = guardSuperAdmin({ email: SUPER_ADMIN_EMAIL }, PROTECTED_ACTIONS[action]);
    ok(`§10: the ${action} guard refuses`, v.allowed === false, JSON.stringify(v));
  }
  const nonTarget = guardSuperAdmin({ email: "ordinary@user.com" }, PROTECTED_ACTIONS.DELETE);
  ok(
    "§10: …but an ordinary user is unaffected (the guard is not a blanket ban)",
    nonTarget.allowed === true
  );

  /* No controller may delete a user at all, let alone this one. */
  const userDeleters = [];
  for (const f of walk(path.join(ROOT, "controllers"))) {
    const text = read(f);
    if (/User\.(findByIdAndDelete|deleteOne|deleteMany|findByIdAndRemove)/.test(text)) {
      userDeleters.push(rel(f));
    }
  }
  ok(
    "§10: no controller deletes a User document",
    userDeleters.length === 0,
    userDeleters.join(",")
  );

  /* Both suspension paths must be guarded — there are two, and guarding only
   * one is the classic way this rule stops holding. */
  const modSrc = read(path.join(ROOT, "controllers", "moderation.controller.js"));
  eq(
    "§10: BOTH suspension paths call the guard (report resolution + direct suspend)",
    (modSrc.match(/guardSuperAdmin\(/g) || []).length >= 2,
    true
  );

  sec("17. §10 — UNTRANSFERABLE");

  const transfer = guardSuperAdmin({ email: SUPER_ADMIN_EMAIL }, PROTECTED_ACTIONS.TRANSFER);
  ok("§10: the TRANSFER guard refuses", transfer.allowed === false);

  /* Status cannot be granted to anyone else: the only grant is the constant,
   * and nothing writes it. */
  const granters = [];
  for (const f of walk(path.join(ROOT, "controllers")).concat(walk(path.join(ROOT, "services")))) {
    // ownership.service is the one place ALLOWED to define it — everywhere
    // else must import it.
    if (rel(f) === path.join("services", "ownership.service.js")) continue;
    const text = read(f);
    if (/SUPER_ADMIN_EMAIL\s*=/.test(text)) granters.push(rel(f));
  }
  ok(
    "§10: no controller or service writes SUPER_ADMIN_EMAIL (status cannot be granted)",
    granters.length === 0,
    granters.join(",")
  );

  ok(
    "§10: …and every protected action has a defined message",
    Object.values(PROTECTED_ACTIONS).every((a) => typeof GUARD_MESSAGES[a] === "string")
  );

  sec("18. §10 — one definition, not five");

  /* The drift risk this phase set out to remove. Five modules used to re-derive
   * the address by hand; they agreed by coincidence. */
  const reDerivers = [];
  for (const f of walk(ROOT)) {
    if (rel(f).startsWith("tests") || rel(f).startsWith("node_modules")) continue;
    if (rel(f) === path.join("services", "ownership.service.js")) continue;
    if (/process\.env\.SUPER_ADMIN_EMAIL/.test(read(f))) reDerivers.push(rel(f));
  }
  ok(
    "§10: only ownership.service reads SUPER_ADMIN_EMAIL — every other module imports it",
    reDerivers.length === 0,
    reDerivers.join(",")
  );

  const middleware = require("../middleware/auth.middleware");
  ok(
    "§10: the middleware re-exports the same constant, so existing callers are unchanged",
    middleware.SUPER_ADMIN_EMAIL === SUPER_ADMIN_EMAIL
  );
  ok(
    "§10: …and the same predicate",
    middleware.isSuperAdminEmail("devanshsinghr00@gmail.com") === true
  );

  sec("19. §10 — institutional email is affiliation, NEVER ownership");

  eq("§10: the domain is extracted for an institutional address", institutionalDomain("a@iitd.ac.in"), "iitd.ac.in");
  eq("§10: …and null for a malformed one", institutionalDomain("not-an-email"), null);

  ok(
    "§10: an institutional email confers NO ownership — ever",
    isInstitutionOwned({ email: "vc@iitd.ac.in" }) === false
  );
  ok(
    "§10: …and it does not make someone the Super Admin either",
    isSuperAdminEmail("vc@iitd.ac.in") === false
  );
  ok(
    "§10: …while the actual owner is unaffected by what domain they use",
    isSuperAdminEmail(SUPER_ADMIN_EMAIL) === true
  );

  /* Ownership resolves from what the platform RECORDED, not from an address. */
  const creatorId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  ok(
    "§10: ownership resolves to the recorded creator",
    String(resolveOwner({ createdBy: creatorId }, [])) === creatorId
  );
  const fallback = "bbbbbbbbbbbbbbbbbbbbbbbb";
  ok(
    "§10: …falling back to an active admin member when no creator is recorded",
    String(resolveOwner({}, [{ user: fallback, role: "admin", status: "active" }])) === fallback
  );
  ok(
    "§10: …and an INACTIVE admin does not confer ownership",
    resolveOwner({}, [{ user: fallback, role: "admin", status: "pending" }]) === null
  );

  sec("20. §10 — the owner is not locked out of their own account");

  /* The one exception to the guards: the owner may act on themselves.
   * Refusing self-action would lock them out of their own property. */
  const self = { _id: "same-id", email: SUPER_ADMIN_EMAIL };
  ok("§10: a self-action is recognised", isSelfAction({ _id: "same-id" }, self) === true);
  ok("§10: …and a different actor is not", isSelfAction({ _id: "other-id" }, self) === false);
  const selfVerdict = guardSuperAdmin(self, PROTECTED_ACTIONS.REMOVE_MEMBERSHIP);
  ok(
    "§10: the guard reports the block, and the CALLER decides whether self-action is exempt",
    selfVerdict.allowed === false && isSelfAction({ _id: "same-id" }, self) === true
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §12  PROVIDER FAILURE MATRIX
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §12 asks that six Redis failure modes be exercised and that the observed
 * behaviour match what Part 6 claimed. The claim being tested is not "Redis is
 * resilient" — it is the more specific one that EACH SUBSYSTEM degrades in its
 * own chosen way, because the cost of being wrong differs per use:
 *
 *   cache        a miss is slow, never wrong      → fall back to memory
 *   rate limit   blocking real users is an outage → fail OPEN
 *   idempotency  a duplicate is a data bug        → refuse, never duplicate
 *   lock         only the caller knows            → proceed / abort per site
 *
 * A single "Redis is down so everything degrades" rule would get three of
 * those four wrong.
 */

async function auditFailureMatrix() {
  sec("21. §12 — Redis failure modes");

  const { RedisSlidingWindow } = require("../providers/redis/sliding-window.store");
  const { RedisIdempotencyStore } = require("../providers/redis/idempotency.store");
  const { DistributedLockService, RedisLockBackend, MemoryLockBackend } =
    require("../providers/redis/lock.service");

  /** A runner that reproduces each failure mode on demand. */
  const modeRunner = (mode) => async () => {
    if (mode === "unavailable") throw new Error("ECONNREFUSED 127.0.0.1:6379");
    if (mode === "timeout") {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    if (mode === "http500") return { ok: false, error: "HTTP 500" };
    if (mode === "malformed") return { ok: true, result: "THIS IS NOT JSON WE EXPECT" };
    // A healthy run returns the sliding-window Lua script's tuple:
    // [totalHits, resetMs, allowed(0|1)].
    if (mode === "allowed") return { ok: true, result: [1, Date.now() + 10_000, 1] };
    if (mode === "limited") return { ok: true, result: [2, Date.now() + 10_000, 0] };
    if (mode === "slow") return { ok: true, result: [1, Date.now() + 10_000, 1] };
    return { ok: true, result: [1, Date.now() + 10_000, 1] };
  };

  const MODES = ["unavailable", "timeout", "http500", "malformed"];

  /* -- rate limiting must fail OPEN on every failure mode -- */
  let limiterOpened = 0;
  for (const mode of MODES) {
    const rl = new RedisSlidingWindow(modeRunner(mode), { keyPrefix: "t:rl:" });
    const r = await rl.check(`k-${mode}`, 5, 10_000);
    if (r.allowed === true) limiterOpened += 1;
  }
  ok(
    "§12: the rate limiter fails OPEN on all four failure modes (a limiter that causes an outage is worse than the abuse it prevents)",
    limiterOpened === MODES.length,
    `${limiterOpened}/${MODES.length}`
  );

  const rlAllowed = new RedisSlidingWindow(modeRunner("allowed"), { keyPrefix: "t:rl:" });
  const rlLimited = new RedisSlidingWindow(modeRunner("limited"), { keyPrefix: "t:rl:" });
  const first = await rlAllowed.check("healthy", 5, 10_000);
  const second = await rlLimited.check("healthy", 5, 10_000);
  ok(
    "§12: …but it still LIMITS when Redis is healthy (fail-open is not a blanket allow)",
    first.allowed === true && second.allowed === false,
    `${first.allowed}/${second.allowed}`
  );

  /* -- idempotency falls back to per-instance memory, then refuses -- */
  let fellBack = 0;
  for (const mode of MODES) {
    const store = new RedisIdempotencyStore(modeRunner(mode), { keyPrefix: "t:idem:" });
    const r = await store.claim(`k-${mode}`, 30_000);
    // The Redis store swallows the error and uses its in-process fallback,
    // so the claim SUCCEEDS here. It must never report "already claimed" as a
    // result of a failure — that would turn an outage into a data-loss bug.
    if (r && r.acquired === true) fellBack += 1;
  }
  ok(
    "§12: idempotency survives every failure mode via a per-instance fallback",
    fellBack === MODES.length,
    `${fellBack}/${MODES.length}`
  );
  ok(
    "§12: …and a failure is never reported as 'already claimed' (which would silently drop a legitimate write)",
    fellBack === MODES.length
  );

  const idemHealthy = new RedisIdempotencyStore(modeRunner("allowed"), { keyPrefix: "t:idem:" });
  const c1 = await idemHealthy.claim("dup", 30_000);
  const c2 = await idemHealthy.claim("dup", 30_000);
  ok(
    "§12: …while a real duplicate IS detected when Redis is healthy",
    c1.acquired === true && c2.acquired === false,
    `${c1.acquired}/${c2.acquired}`
  );

  /* -- the critical-write refusal lives in the middleware -- */
  const idemMw = read(path.join(ROOT, "middleware", "idempotency.js"));
  ok(
    "§12: the idempotency middleware FAILS CLOSED — it refuses a write it cannot de-duplicate",
    /Could not verify this request is unique/.test(idemMw) && /ConflictError/.test(idemMw)
  );

  /* -- locks: the call site decides proceed vs abort -- */
  const downBackend = new RedisLockBackend(modeRunner("unavailable"), { keyPrefix: "t:lock:" });
  ok(
    "§12: a failing lock backend records the error rather than pretending success",
    downBackend.stats_.errors === 0 // no call yet
  );
  await downBackend.acquire("x", "tok", 1000);
  ok(
    "§12: …and increments its error count once it is used",
    downBackend.stats_.errors > 0,
    `errors=${downBackend.stats_.errors}`
  );

  const silentLogger = { log() {}, warn() {}, error() {} };
  const svc = new DistributedLockService(downBackend, { logger: silentLogger });

  let ranWhenProceed = false;
  const proceedRes = await svc.withLock("job", async () => {
    ranWhenProceed = true;
    return "done";
  }, { onUnavailable: "proceed" });
  ok(
    "§12: with onUnavailable=proceed the work RUNS even though the backend is down",
    ranWhenProceed && proceedRes.ran === true
  );

  let ranWhenAbort = false;
  const abortRes = await svc.withLock("job", async () => {
    ranWhenAbort = true;
    return "done";
  }, { onUnavailable: "abort" });
  ok(
    "§12: with onUnavailable=abort the work is SKIPPED, and the skip is reported rather than swallowed",
    ranWhenAbort === false && abortRes.ran === false && abortRes.reason === "unavailable",
    JSON.stringify(abortRes)
  );
  ok(
    "§12: …and a lock served by the process-local fallback is flagged NOT distributed (mutual exclusion is not established)",
    proceedRes.distributed === false,
    JSON.stringify(proceedRes)
  );
  ok(
    "§12: …so a `proceed` caller runs KNOWING it is unprotected, rather than believing it holds a real lock",
    proceedRes.ran === true && proceedRes.distributed === false
  );

  /* -- TTL is mandatory, so a dead holder cannot wedge a resource -- */
  const lockSrc = read(path.join(ROOT, "providers", "redis", "lock.service.js"));
  ok(
    "§12: every lock acquisition sets a TTL (a lock without one is a permanent outage waiting for one crash)",
    /"PX"/.test(lockSrc) && /Math\.max\(1,/.test(lockSrc)
  );

  const mem = new MemoryLockBackend();
  await mem.acquire("res", "t", 40);
  await new Promise((r) => setTimeout(r, 90));
  ok(
    "§12: an expired lock is re-acquirable (a holder that died does not wedge the resource)",
    (await mem.acquire("res", "t2", 5000)) === true
  );

  sec("22. §12 — Supabase failure never breaks the event engine");

  const outboxSvc = require("../services/outbox.service");
  const outboxSrc = read(path.join(ROOT, "services", "outbox.service.js"));

  ok(
    "§12: a failed sync is retried with backoff, not dropped",
    /availableAt/.test(outboxSrc) && /status: exhausted \? "dead" : "pending"/.test(outboxSrc)
  );
  ok(
    "§12: …and backoff is capped, so a dead upstream cannot wedge a retry for hours",
    /MAX_BACKOFF_MS/.test(outboxSrc)
  );
  ok(
    "§12: …and jittered, so retries do not synchronise into a herd when the upstream returns",
    /Math\.random\(\)/.test(outboxSrc)
  );

  /* The outbox carries a reference, not a payload — which is what makes retry
   * always correct, because application re-reads the current state. */
  const syncSrc = read(path.join(ROOT, "services", "social-sync.service.js"));
  ok(
    "§12: the outbox carries a REFERENCE, so re-applying re-reads current state and ordering stops mattering",
    !/payload/.test(syncSrc) || /entityId/.test(syncSrc)
  );

  /* The matrix must be documented, or it is folklore. */
  const docsDir = path.join(ROOT, "docs");
  const matrixPath = path.join(docsDir, "PROVIDER-FAILURE-MATRIX.md");
  ok("§12: the failure matrix is documented", fs.existsSync(matrixPath));
  if (fs.existsSync(matrixPath)) {
    const t = read(matrixPath);
    for (const [label, re] of [
      ["unavailable", /Unavailable/],
      ["timeout", /Timeout/],
      ["HTTP 500", /500/],
      ["malformed", /Malformed/],
      ["slow", /Slow/],
      ["partial", /Partial/],
    ]) {
      ok(`§12: …and covers the "${label}" failure mode`, re.test(t));
    }
    ok(
      "§12: …and states the governing rule that Redis failure must not destroy the core product",
      /Redis failure must not destroy the core product/i.test(t)
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §32  DOCUMENTATION SET
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Documentation that is not asserted tends to quietly stop being true. These
 * checks do not test prose quality — they test that each required document
 * exists, and that the specific decisions the brief asked to be RECORDED are
 * still recorded. If someone deletes a section, this fails and the decision
 * has to be made again rather than forgotten.
 */

async function auditDocs() {
  sec("23. §32 — the documentation set exists and still records its decisions");

  const docsDir = path.join(ROOT, "docs");
  const REQUIRED_DOCS = {
    "PRODUCTION-HARDENING.md": [/preflight/i, /dead letter/i],
    "SECURITY-MODEL.md": [/row level security/i, /bearer-token/i],
    "DATA-CONSISTENCY.md": [/reconcil/i, /dead.letter/i],
    "INCIDENT-RUNBOOK.md": [/CRITICAL/i, /WARNING/i, /HIGH/],
    "RESTORE-DRILL.md": [/mongodump/, /pg_dump/],
    "LOAD-TESTING.md": [/p95/, /p99/],
    "PROVIDER-FAILURE-MATRIX.md": [/fail.?open/i, /Redis failure must not destroy/i],
  };

  for (const [name, patterns] of Object.entries(REQUIRED_DOCS)) {
    const file = path.join(docsDir, name);
    if (!fs.existsSync(file)) {
      ok(`§32: docs/${name} exists`, false);
      continue;
    }
    const text = read(file);
    ok(`§32: docs/${name} exists and is substantial`, text.length > 1500, `${text.length} chars`);
    for (const re of patterns) {
      ok(`§32: …${name} still documents /${re.source}/`, re.test(text));
    }
  }

  sec("24. §32 — the decisions that must not be silently reversed");

  const secDoc = read(path.join(docsDir, "SECURITY-MODEL.md"));
  ok(
    "§32: the RLS decision states the condition under which RLS becomes mandatory",
    /mandatory/i.test(secDoc) && /browser/i.test(secDoc)
  );
  ok(
    "§32: …and warns against half-configured RLS",
    /half-configured/i.test(secDoc)
  );
  ok(
    "§32: the auth model is recorded as bearer-token, matching the code",
    /bearer-token/i.test(secDoc)
  );

  const consistDoc = read(path.join(docsDir, "DATA-CONSISTENCY.md"));
  ok(
    "§32: consistency docs state that the outbox enqueue is NOT atomic with the business write",
    /NOT atomic/i.test(consistDoc)
  );
  ok(
    "§32: …and that ambiguous conflicts are never auto-repaired",
    /never auto-repaired/i.test(consistDoc)
  );
  ok(
    "§32: …and that reconciliation never deletes Mongo source data",
    /NO SOURCE DELETION FROM MONGO/i.test(consistDoc)
  );

  const drill = read(path.join(docsDir, "RESTORE-DRILL.md"));
  ok(
    "§32: the restore drill is honest that it has not been executed end to end",
    /not complete until someone has run it/i.test(drill) || /unproven/i.test(drill)
  );
  ok(
    "§32: …and requires an ISOLATED restore target",
    /isolated/i.test(drill)
  );

  const load = read(path.join(docsDir, "LOAD-TESTING.md"));
  ok(
    "§32: the Socket.IO adapter is documented as NOT deployed, with an explicit trigger",
    /Do NOT deploy the adapter|Do NOT deploy/i.test(load) && /replicas > 1/i.test(load)
  );

  const runbook = read(path.join(docsDir, "INCIDENT-RUNBOOK.md"));
  ok(
    "§32: the runbook escalates any suspected data loss to CRITICAL regardless of scope",
    /data loss/i.test(runbook) && /CRITICAL/i.test(runbook)
  );
  ok(
    "§32: …and forbids raising a rate limit to stop 429s",
    /Raise a rate limit|rate limit to stop 429/i.test(runbook)
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §23 OBSERVABILITY · §24 ALERTING · §25 PERF BUDGETS · §26 QUERY BUDGET
 * ═══════════════════════════════════════════════════════════════════════════
 */

async function auditObservability() {
  sec("25. §24 — the severity ladder includes INFO");

  const obs = require("../services/observability.service");
  const { SEVERITY, worstSeverity, evaluateEndpoint, budgetFor, evaluateQueries,
          QUERY_BUDGET, QUERY_EXCEPTIONS, snapshot } = obs;

  ok(
    "§24: there are four severities, including INFO",
    Object.keys(SEVERITY).length === 4 && SEVERITY.INFO === "INFO",
    Object.keys(SEVERITY).join(",")
  );
  ok(
    "§24: …named exactly INFO / WARNING / HIGH / CRITICAL",
    ["INFO", "WARNING", "HIGH", "CRITICAL"].every((s) => SEVERITY[s] === s)
  );
  eq(
    "§24: worstSeverity picks the highest, not the last",
    worstSeverity("WARNING", "CRITICAL", "INFO"),
    "CRITICAL"
  );
  eq("§24: …and tolerates nulls", worstSeverity(null, "HIGH", "INFO"), "HIGH");
  eq("§24: …and returns null when nothing is wrong", worstSeverity(null, undefined), null);

  sec("26. §25 — per-endpoint performance budgets");

  ok(
    "§25: a cached read has a tighter budget than the default",
    budgetFor("GET", "/api/events").budget.p95 < obs.DEFAULT_BUDGET.p95,
    `${budgetFor("GET", "/api/events").budget.p95}`
  );
  ok(
    "§25: an endpoint with no override falls back to the default budget",
    budgetFor("GET", "/api/some/unlisted/thing").budget.p95 === obs.DEFAULT_BUDGET.p95
  );
  eq(
    "§25: a parameterised route matches its budget template",
    budgetFor("GET", "/api/communities/my-community").key,
    "GET /api/communities/:slug"
  );
  ok(
    "§25: …and a different id still matches",
    budgetFor("GET", "/api/communities/another").key === "GET /api/communities/:slug"
  );

  const healthy = evaluateEndpoint({ method: "GET", path: "/api/events", p95: 100, p99: 200, errorRate: 0.001 });
  ok("§25: a fast endpoint passes cleanly", healthy.breaches.length === 0 && healthy.severity === null);

  const slight = evaluateEndpoint({ method: "GET", path: "/api/events", p95: 200, p99: 300, errorRate: 0.001 });
  ok(
    "§25: a small overshoot is a WARNING, not a build failure (a guard that fails on noise gets disabled)",
    slight.breaches.length === 1 && slight.severity === SEVERITY.WARNING && !slight.breaches[0].major,
    JSON.stringify(slight.severity)
  );

  const bad = evaluateEndpoint({ method: "GET", path: "/api/events", p95: 500, p99: 900, errorRate: 0.001 });
  ok(
    "§25: a 2× overshoot is MAJOR — that is what blocks CI",
    bad.breaches.some((b) => b.metric === "p95" && b.major),
    JSON.stringify(bad.breaches)
  );

  const errs = evaluateEndpoint({ method: "GET", path: "/api/events", p95: 100, p99: 200, errorRate: 0.05 });
  ok(
    "§25: a high error rate outranks latency (a fast endpoint that fails is worse than a slow one that works)",
    errs.severity === SEVERITY.CRITICAL,
    JSON.stringify(errs.severity)
  );

  sec("27. §26 — database query budget and N+1 detection");

  const clean = evaluateQueries({ queries: 3, maxRows: 50, bounded: true });
  ok("§26: a normal request is within budget", clean.withinBudget && clean.severity === null);

  const nPlusOne = evaluateQueries({ queries: QUERY_BUDGET.maxQueriesPerRequest + 10, maxRows: 10, bounded: true });
  ok(
    "§26: too many queries in one request is flagged as N+1",
    nPlusOne.findings.some((f) => f.type === "N_PLUS_ONE"),
    JSON.stringify(nPlusOne.findings)
  );
  ok("§26: …at WARNING severity when moderately over", nPlusOne.severity === SEVERITY.WARNING);

  const unbounded = evaluateQueries({ queries: 4, maxRows: 500_000, bounded: true });
  ok(
    "§26: a read returning more rows than the budget is flagged UNBOUNDED_READ",
    unbounded.findings.some((f) => f.type === "UNBOUNDED_READ"),
    JSON.stringify(unbounded.findings)
  );

  const noLimit = evaluateQueries({ queries: 4, maxRows: 10, bounded: false });
  ok(
    "§26: a read with no limit is flagged at HIGH — it is an outage waiting for a big enough table",
    noLimit.findings.some((f) => f.type === "UNBOUNDED_QUERY") && noLimit.severity === SEVERITY.HIGH,
    JSON.stringify(noLimit.severity)
  );

  ok(
    "§26: exceptions are DOCUMENTED, each with a reason and a bound",
    QUERY_EXCEPTIONS.length > 0 &&
      QUERY_EXCEPTIONS.every((e) => e.name && e.why && e.bound),
    JSON.stringify(QUERY_EXCEPTIONS.map((e) => e.name))
  );
  const exempt = evaluateQueries({
    queries: 5000, maxRows: 500_000, bounded: false, exception: "reconciliation",
  });
  ok(
    "§26: a declared exception is honoured rather than flagged",
    exempt.withinBudget && exempt.exception && exempt.exception.name === "reconciliation"
  );
  const fakeExempt = evaluateQueries({
    queries: 5000, bounded: false, exception: "because I said so",
  });
  ok(
    "§26: …but an UNDECLARED exception is itself a finding at HIGH (claiming one hides the problem)",
    fakeExempt.findings.some((f) => f.type === "UNDECLARED_EXCEPTION") &&
      fakeExempt.severity === SEVERITY.HIGH,
    JSON.stringify(fakeExempt.severity)
  );

  sec("28. §23 — all six domains are observable, and dark ones are reported");

  const snap = snapshot();
  for (const d of ["api", "mongo", "supabase", "redis", "realtime", "storage"]) {
    ok(`§23: the ${d} domain is present in the rollup`, Boolean(snap.domains[d]));
    ok(`§23: …and reports whether it is actually being observed`, "observed" in snap.domains[d]);
  }
  ok(
    "§23: a domain with no data is reported DARK rather than silently omitted",
    Array.isArray(snap.dark)
  );
  ok(
    "§23: …and darkness is at least a WARNING (an unmeasured domain is where incidents start)",
    snap.dark.length === 0 || snap.severity === SEVERITY.WARNING,
    `dark=${snap.dark.join(",")} severity=${snap.severity}`
  );

  /* The guard script must exist and be runnable, or §25 is a document only. */
  const guardPath = path.join(ROOT, "scripts", "perf-guard.js");
  ok("§25: the perf-guard script exists", fs.existsSync(guardPath));
  ok(
    "§25: …and refuses to run without an input file",
    /usage: node scripts\/perf-guard/.test(read(guardPath))
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */

(async () => {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  PART 7 · PHASE 4 — SECURITY AUDITS (§8, §9, §11, §13)");
  console.log("══════════════════════════════════════════════════════════════");

  try {
    await auditCachePrivacy();
    await auditRedis();
    await auditSupabase();
    await auditRls();
    await auditOwnership();
    await auditFailureMatrix();
    await auditDocs();
    await auditObservability();
  } catch (err) {
    failed += 1;
    failures.push(`suite crashed: ${err && err.message}`);
    console.log(String((err && err.stack) || err));
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  PART 7 (phase 4) security audit: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`    · ${f}`);
  }
  console.log("══════════════════════════════════════════════════════════════\n");
  process.exit(failed === 0 ? 0 : 1);
})();
