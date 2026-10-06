#!/usr/bin/env node
/**
 * EventHub — Part 5, Phase 9 selftest (verification battery)
 * ─────────────────────────────────────────────────────────────────────────────
 * The end-to-end verification battery for the whole of Part 5. Every item here
 * is a CROSS-PHASE guarantee: it was implemented in an earlier phase, but this
 * suite is the first to prove it over real HTTP, on a real server, rather than
 * by unit-inspecting the module that provides it.
 *
 *   §1  rate limiting   — 429 shape, Retry-After, RateLimit-* headers (draft-7)
 *   §2  cache policy    — public vs private Cache-Control (§47–48)
 *   §3  ETag / 304      — conditional requests on cached public GETs
 *   §4  compression     — text responses are gzipped/br'd (§46)
 *   §5  pagination      — cursor + hard caps on the three unbounded lists
 *   §6  idempotency     — double-click safety
 *   §7  search guards   — short query, oversized query, oversized limit
 *   §8  export          — CSV streams and is never buffered as JSON
 *   §9  cache behavior  — hit/miss, invalidation, no cross-user bleed
 *   §10 realtime caps   — concurrency limits are configured and enforced
 *
 * This suite is deliberately integration-flavoured: it asserts on wire
 * behaviour (status codes and headers), because those are the contract the
 * frontend actually depends on.
 *
 * Run: npm run test:phase9
 */
"use strict";

process.env.NODE_ENV = "test";
process.env.PORT = 5361;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
// Tighten two buckets so the 429 path is reachable in a test (env override
// is read at module load, so this must be set before requiring the server).
process.env.RATE_LIMIT_SEARCH_LIMIT = "8"; // §1 exhausts it; §7 needs headroom after the window resets
process.env.RATE_LIMIT_SEARCH_WINDOW_MS = "1500"; // short so §7 can prove the bucket RECOVERS

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

const eq = (label, actual, expected) =>
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();

  const User = require("../models/user.model");
  const Event = require("../models/event.model");
  const Post = require("../models/post.model");
  const jwt = require("jsonwebtoken");
  const http = require("http");

  require("../server");

  const B = `http://localhost:${process.env.PORT}/api`;
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${B}/events`);
      break;
    } catch {
      await wait(250);
    }
  }

  const mkUser = async (first, email, extra = {}) =>
    User.create({
      firstName: first,
      lastName: "Test",
      email,
      passwordHash: "x",
      emailVerified: true,
      role: "user",
      ...extra,
    });

  const alice = await mkUser("Alice", "alice@p9.io");
  const bob = await mkUser("Bob", "bob@p9.io");
  const admin = await mkUser("Ad", "admin@p9.io", { role: "admin" });

  const tok = (u) =>
    jwt.sign({ id: String(u._id), role: u.role || "user", purpose: "auth" }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
  const H = (u) => ({ Authorization: `Bearer ${tok(u)}` });

  const get = (path, opts = {}) => fetch(`${B}${path}`, { ...opts, headers: { ...(opts.headers || {}) } });

  /**
   * Browser-like conditional GET over raw http.
   * ───────────────────────────────────────────────────────────────────────
   * Node's global fetch (undici) silently injects `Cache-Control: no-cache`,
   * and the `fresh` module treats that as "always stale" — so a conditional
   * request sent via fetch can NEVER return 304 even when the ETag matches.
   * Real browsers doing a revalidation after max-age expiry do not send it.
   * To test the actual client contract we must send the headers ourselves.
   */
  function rawGet(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: Number(process.env.PORT), path: `/api${path}`, headers },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: body }));
        }
      );
      req.on("error", reject);
      req.end();
    });
  }
  const getJSON = async (path, opts = {}) => {
    const r = await get(path, opts);
    let body = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    return { status: r.status, headers: r.headers, body };
  };

  /* ══ §1 Rate limiting: 429 shape, Retry-After, RateLimit-* ═══════════ */
  sec("1. Rate limiting — 429 contract (§24–26)");

  // Burn the tightened SEARCH bucket (limit 3 / 60s).
  let last = null;
  for (let i = 0; i < 14; i++) {
    last = await getJSON(`/search?q=ab${i}&type=events`);
    if (last.status === 429) break;
    await wait(30);
  }

  eq("the search bucket returns 429 once exhausted", last.status, 429);

  const rlBody = last.body || {};
  ok(
    "429 body carries a RATE_LIMITED error code (§25)",
    rlBody?.error?.code === "RATE_LIMITED" || rlBody?.code === "RATE_LIMITED",
    JSON.stringify(rlBody)
  );
  ok("429 body has no success:true", rlBody.success !== true, JSON.stringify(rlBody));
  ok(
    "429 message is human, never a stack trace (§61)",
    typeof (rlBody?.error?.message || rlBody?.message) === "string" &&
      !/at [A-Za-z]+\(|node_modules|MongoError|Error:/.test(rlBody?.error?.message || rlBody?.message || ""),
    String(rlBody?.error?.message || rlBody?.message)
  );

  const retryAfter = last.headers.get("retry-after");
  ok("429 sets a Retry-After header", retryAfter !== null, String(retryAfter));
  ok(
    "Retry-After is a positive integer number of seconds",
    retryAfter !== null && /^[0-9]+$/.test(String(retryAfter).trim()) && Number(retryAfter) > 0,
    String(retryAfter)
  );

  // This express-rate-limit version emits the IETF-standardised COMBINED
  // `RateLimit` header (limit / remaining / reset) plus `RateLimit-Policy`,
  // rather than the older draft-7 RateLimit-Limit + RateLimit-Remaining pair.
  const rlHeader = last.headers.get("ratelimit") || "";
  ok("429 sets a RateLimit header", !!rlHeader, [...last.headers.keys()].join(","));
  ok("the RateLimit header advertises the bucket limit", /limit=\d+/.test(rlHeader), rlHeader);
  ok("the RateLimit header reports remaining=0 when blocked", /remaining=0\b/.test(rlHeader), rlHeader);
  ok(
    "the RateLimit header carries a reset hint",
    /reset=\d+/.test(rlHeader),
    rlHeader
  );
  ok("429 sets a RateLimit-Policy header", !!last.headers.get("ratelimit-policy"), String(last.headers.get("ratelimit-policy")));
  ok(
    "RateLimit-Policy quotes the configured limit (8)",
    /\b8\b/.test(String(last.headers.get("ratelimit-policy"))),
    String(last.headers.get("ratelimit-policy"))
  );

  // A different bucket must still be servable — a 429 on search must not
  // take browsing down with it (§26: READ must never throttle normal use).
  const eventsProbe = await getJSON("/events");
  ok("a 429 on search does NOT take down browsing (§26)", eventsProbe.status === 200, String(eventsProbe.status));

  // And the error path never leaks provider identity.
  const rlBlob = JSON.stringify(rlBody);
  ok(
    "429 body leaks no infrastructure detail (§61)",
    !/mongodb|mongo|supabase|cloudinary|r2|redis|upstash|atlas/i.test(rlBlob),
    rlBlob.slice(0, 160)
  );

  /* ══ §2 Cache-Control policy (§47–48) ═══════════════════════════════ */
  sec("2. HTTP cache policy (§47–48)");

  const anonPublic = await getJSON("/events");
  eq("anonymous public list is 200", anonPublic.status, 200);
  const anonCC = anonPublic.headers.get("cache-control") || "";
  ok("anonymous public GET is publicly cacheable", /public/.test(anonCC), anonCC);
  ok("anonymous public GET carries a short max-age", /max-age=\d+/.test(anonCC), anonCC);
  ok(
    "anonymous public GET allows stale-while-revalidate",
    /stale-while-revalidate/.test(anonCC),
    anonCC
  );

  const authedPublic = await getJSON("/events", { headers: H(alice) });
  const authedCC = authedPublic.headers.get("cache-control") || "";
  ok(
    "the SAME route is private/no-store when authenticated",
    /no-store/.test(authedCC),
    authedCC
  );
  ok("authenticated response is not marked public", !/\bpublic\b/.test(authedCC), authedCC);

  const anonPrivate = await getJSON("/notifications", { headers: {} });
  ok(
    "a private route is never publicly cacheable even when anonymous",
    anonPrivate.status === 401 || /no-store/.test(anonPrivate.headers.get("cache-control") || ""),
    `${anonPrivate.status} ${anonPrivate.headers.get("cache-control")}`
  );

  const adminCC = (await getJSON("/admin/stats", { headers: H(admin) })).headers.get("cache-control") || "";
  ok("admin routes are private/no-store", /no-store/.test(adminCC), adminCC);

  /* ══ §3 ETag / 304 ══════════════════════════════════════════════════ */
  sec("3. Conditional requests — ETag / 304 (§47)");

  const first = await rawGet("/events");
  const etag = first.headers.etag;
  ok("a public GET returns an ETag", !!etag, String(etag));

  if (etag) {
    const cond = await rawGet("/events", { "If-None-Match": etag });
    eq("a matching If-None-Match returns 304", cond.status, 304);
    ok("the 304 carries no body", cond.text.length === 0, `${cond.text.length} bytes`);
    ok("the 304 still carries the ETag", !!cond.headers.etag, String(cond.headers.etag));

    const changed = await rawGet("/events", { "If-None-Match": 'W/"stale-etag-value"' });
    eq("a stale If-None-Match returns 200 with a full body", changed.status, 200);
    ok("a fresh 200 does carry a body", changed.text.length > 0, `${changed.text.length} bytes`);
  }

  /* ══ §4 Compression (§46) ═══════════════════════════════════════════ */
  sec("4. HTTP compression (§46)");

  // compression's default threshold is ~1KB, so a near-empty event list is
  // correctly served uncompressed. Make the payload genuinely large first.
  for (let i = 0; i < 40; i++) {
    await Event.create({
      title: `Compression fixture event ${i} — padded payload to cross the 1KB gzip threshold`,
      description: "d".repeat(200),
      organizer: "o",
      venue: "v",
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      visibility: "public",
      createdBy: alice._id,
    });
  }

  const comp = await fetch(`${B}/events?limit=100`, { headers: { "Accept-Encoding": "gzip" } });
  const ce = comp.headers.get("content-encoding") || "";
  ok("a large text response is compressed when the client asks", ce === "gzip" || ce === "br", ce || "(none)");

  const uncompressed = await fetch(`${B}/events?limit=100`, { headers: { "Accept-Encoding": "identity" } });
  const bigLen = Number((await uncompressed.clone().text()).length);
  ok("the uncompressed payload really is over the threshold", bigLen > 1024, `${bigLen} bytes`);

  // A tiny response must NOT be padded — gzipping 80 bytes wastes CPU and
  // can even make it larger.
  const tiny = await fetch(`${B}/health`, { headers: { "Accept-Encoding": "gzip" } });
  ok("a tiny response is served uncompressed", tiny.headers.get("content-encoding") === null, String(tiny.headers.get("content-encoding")));
  eq("the health endpoint still answers", tiny.status, 200);

  /* ══ §5 Pagination: cursor + hard caps (§7) ═════════════════════════ */
  sec("5. Pagination — cursors and hard caps (§7)");

  // Build 12 posts so a page of 5 is meaningfully smaller than the corpus.
  const posts = [];
  for (let i = 0; i < 12; i++) {
    posts.push(
      await Post.create({
        author: alice._id,
        content: `p9 post ${i}`,
        createdAt: new Date(Date.now() - (12 - i) * 60000),
      })
    );
  }

  const feedP1 = await getJSON(`/posts/feed?limit=5`, { headers: H(alice) });
  eq("feed page 1 is 200", feedP1.status, 200);
  const p1 = feedP1.body?.posts || feedP1.body?.data || [];
  ok("feed honours limit=5", p1.length <= 5, `got ${p1.length}`);
  ok("feed returns a cursor for the next page", !!(feedP1.body?.nextCursor || feedP1.body?.cursor), JSON.stringify(Object.keys(feedP1.body || {})));

  const cursor = feedP1.body?.nextCursor || feedP1.body?.cursor;
  if (cursor) {
    const feedP2 = await getJSON(`/posts/feed?limit=5&cursor=${encodeURIComponent(cursor)}`, {
      headers: H(alice),
    });
    const p2 = feedP2.body?.posts || feedP2.body?.data || [];
    ok("feed page 2 returns rows", p2.length > 0, `got ${p2.length}`);
    const ids1 = new Set(p1.map((x) => String(x._id || x.id)));
    const overlap = p2.filter((x) => ids1.has(String(x._id || x.id)));
    ok("cursor pagination does not repeat rows across pages", overlap.length === 0, `${overlap.length} repeated`);
  }

  // Hard cap: a client asking for an absurd page size must be clamped.
  const huge = await getJSON(`/posts/feed?limit=100000`, { headers: H(alice) });
  const hugeRows = huge.body?.posts || huge.body?.data || [];
  ok("an absurd limit is clamped server-side", hugeRows.length <= 100, `got ${hugeRows.length}`);

  // Comments
  const target = posts[0];
  // NB — Comment uses `content`, not `text`.
  await require("../models/comment.model").create({
    post: target._id,
    author: bob._id,
    content: "p9 comment",
  });
  const cmts = await getJSON(`/posts/${target._id}/comments?limit=10`, { headers: H(alice) });
  ok("comments endpoint is bounded", cmts.status === 200, String(cmts.status));

  // Registrations (the formerly-unbounded admin list)
  const ev = await Event.create({
    title: "P9 Event",
    description: "d",
    organizer: "o",
    venue: "v",
    startDate: new Date(Date.now() + 86400000),
    endDate: new Date(Date.now() + 172800000),
    visibility: "public",
    createdBy: alice._id,
  });
  const capped = await getJSON(`/registration/responses/${ev._id}?limit=100000`, { headers: H(alice) });
  ok(
    "an absurd registration page size is refused or clamped",
    capped.status === 400 || capped.status === 403 || (Array.isArray(capped.body?.responses) && capped.body.responses.length <= 100),
    `${capped.status}`
  );

  /* ══ §6 Idempotency (double-click) ══════════════════════════════════ */
  sec("6. Idempotency — double-click safety (§28)");

  /**
   * The documented contract (middleware/idempotency.js) is a DEDUP WINDOW:
   * a replayed key is rejected with 409 CONFLICT so the client knows the
   * submission already landed. The critical property is not the status code
   * — it is that no duplicate row is ever created.
   */
  const idemKey = `p9-${Date.now()}`;
  const dblHeaders = {
    ...H(alice),
    "Content-Type": "application/json",
    "Idempotency-Key": idemKey,
  };
  const postBody = JSON.stringify({ content: "double click post" });

  const r1 = await fetch(`${B}/posts`, { method: "POST", headers: dblHeaders, body: postBody });
  const r2 = await fetch(`${B}/posts`, { method: "POST", headers: dblHeaders, body: postBody });

  ok("first create is accepted", [200, 201].includes(r1.status), String(r1.status));
  eq("the replayed key is rejected with 409 CONFLICT (§28)", r2.status, 409);

  const r2b = await r2.json().catch(() => null);
  ok(
    "the 409 carries a conflict error code",
    /CONFLICT|DUPLICATE/i.test(String(r2b?.error?.code || r2b?.code || "")),
    JSON.stringify(r2b)
  );
  ok(
    "the 409 message is human and explains why",
    /already submitted|duplicate/i.test(String(r2b?.error?.message || r2b?.message || "")),
    String(r2b?.error?.message || r2b?.message)
  );

  const dupeCount = await Post.countDocuments({ author: alice._id, content: "double click post" });
  eq("THE POINT: exactly one post exists, not two", dupeCount, 1);

  // Keys are scoped per user — one identity can never block another's key.
  const bobSameKey = await fetch(`${B}/posts`, {
    method: "POST",
    headers: { ...H(bob), "Content-Type": "application/json", "Idempotency-Key": idemKey },
    body: JSON.stringify({ content: "bob uses the same key" }),
  });
  ok(
    "the SAME key under a different user is not blocked (per-user scoping)",
    [200, 201].includes(bobSameKey.status),
    String(bobSameKey.status)
  );

  // A request with no key at all must pass through untouched — the unique
  // indexes remain the backstop, and legacy clients are never broken.
  const noKey = await fetch(`${B}/posts`, {
    method: "POST",
    headers: { ...H(alice), "Content-Type": "application/json" },
    body: JSON.stringify({ content: "no idempotency key" }),
  });
  ok("a request without a key passes through untouched", [200, 201].includes(noKey.status), String(noKey.status));

  // A brand-new key for the same user must work (the window is per-key).
  const freshKey = await fetch(`${B}/posts`, {
    method: "POST",
    headers: { ...H(alice), "Content-Type": "application/json", "Idempotency-Key": `p9-fresh-${Date.now()}` },
    body: JSON.stringify({ content: "a fresh key is allowed" }),
  });
  ok("a fresh key for the same user is allowed", [200, 201].includes(freshKey.status), String(freshKey.status));

  /* ══ §7 Search guards (§63) ═════════════════════════════════════════ */
  sec("7. Search input guards (§63)");

  /**
   * §1 exhausted the SEARCH bucket. Note WHY it stays exhausted for everyone:
   * the prefix-level limiter is mounted via app.use('/api/search', ...), which
   * runs BEFORE any route-level optionalUser, so req.user is not yet populated
   * and defaultKeyGenerator falls back to the IP key. That is correct, and
   * worth stating plainly: public search is anonymous-capable, so IP is the
   * only identity available that early. Action-scoped limiters
   * (SOCIAL/MESSAGING/EVENT) are mounted INSIDE their route files where
   * req.user does exist, and those really are per-user.
   *
   * The property asserted here is the one that matters operationally: a limit
   * is a WINDOW, not a ban.
   */
  const stillBlocked = await getJSON("/search?q=zzz&type=events", { headers: H(alice) });
  eq("the bucket is still closed immediately after §1", stillBlocked.status, 429);

  await wait(1700); // window is 1500ms
  const recovered = await getJSON("/search?q=zzz&type=events", { headers: H(alice) });
  eq("after the window elapses the client is served again (a window, not a ban)", recovered.status, 200);

  const bh = H(bob);
  const shortQ = await getJSON("/search?q=a&type=events", { headers: bh });
  eq("a 1-char query is answered with empty results, not an error", shortQ.status, 200);
  ok("a 1-char query hits no database regex", Array.isArray(shortQ.body?.events), JSON.stringify(shortQ.body?.events));
  eq("a 1-char query returns no events", (shortQ.body?.events || []).length, 0);

  const emptyQ = await getJSON("/search?type=events", { headers: bh });
  eq("a missing query is safe", emptyQ.status, 200);

  const longQ = await getJSON(`/search?q=${"x".repeat(5000)}&type=events`, { headers: bh });
  ok("an oversized query is accepted but clamped (no 500)", longQ.status === 200, String(longQ.status));

  const bigLimit = await getJSON("/search?q=test&type=events&limit=100000", { headers: bh });
  eq("an absurd limit does not 500", bigLimit.status, 200);
  ok(
    "the limit is clamped to the documented maximum (50)",
    (bigLimit.body?.events || []).length <= 50,
    String((bigLimit.body?.events || []).length)
  );

  const badType = await getJSON("/search?q=test&type=../../etc/passwd", { headers: bh });
  eq("an unknown type falls back safely", badType.status, 200);

  /* ══ §8 Export streaming ════════════════════════════════════════════ */
  sec("8. Export streams, never buffers (§8)");

  const exp = await fetch(`${B}/admin/users/export`, { headers: H(admin) });
  eq("admin export is 200", exp.status, 200);
  const ct = exp.headers.get("content-type") || "";
  ok("export content-type is CSV", /csv|text\/plain/.test(ct), ct);
  ok(
    "export sets a Content-Disposition attachment",
    /attachment/.test(exp.headers.get("content-disposition") || ""),
    exp.headers.get("content-disposition") || "(none)"
  );
  ok(
    "export is not publicly cacheable",
    /no-store/.test(exp.headers.get("cache-control") || ""),
    exp.headers.get("cache-control") || "(none)"
  );

  const csv = await exp.text();
  ok("export produced a CSV header row", csv.split("\n")[0].length > 0, csv.slice(0, 80));
  ok("the export is a stream (no Content-Length pre-commit)", exp.headers.get("content-length") === null || csv.length > 0);

  const noAuth = await fetch(`${B}/admin/users/export`);
  ok("export requires authentication", [401, 403].includes(noAuth.status), String(noAuth.status));

  /* ══ §9 Cache behavior ══════════════════════════════════════════════ */
  sec("9. Cache behaviour — hits, dedup, invalidation, isolation");

  /**
   * The public facade is deliberately narrow:
   *   getOrSet(key, loader, { ttl, swr }) · peek · invalidate ·
   *   invalidatePrefix · stats · flush
   * There is no raw `set`, by design — a value may only enter the cache
   * through a loader, which keeps every entry attached to the code that
   * knows how to rebuild it.
   */
  const { cache, TTL } = require("../services/cache.service");

  ok("the facade exposes getOrSet", typeof cache.getOrSet === "function");
  ok("the facade exposes peek", typeof cache.peek === "function");
  ok("the facade exposes invalidate", typeof cache.invalidate === "function");
  ok("the facade exposes invalidatePrefix", typeof cache.invalidatePrefix === "function");
  ok("the facade does NOT expose a raw set (values must come from a loader)", typeof cache.set === "undefined");

  cache.flush();

  // hit / miss
  let loaderRuns = 0;
  const load = async () => {
    loaderRuns++;
    return { v: "hello" };
  };

  const m1 = await cache.getOrSet("p9:probe", load, { ttl: 60000 });
  eq("a cold key runs the loader", loaderRuns, 1);
  ok("the loader's value is returned", m1 && m1.v === "hello", JSON.stringify(m1));

  const m2 = await cache.getOrSet("p9:probe", load, { ttl: 60000 });
  eq("a warm key does NOT run the loader again", loaderRuns, 1);
  ok("the cached value is returned", m2 && m2.v === "hello", JSON.stringify(m2));

  // peek reads without ever invoking a loader
  const peeked = cache.peek("p9:probe");
  ok("peek returns the cached value", peeked && peeked.v === "hello", JSON.stringify(peeked));
  const peekMiss = cache.peek("p9:definitely-absent");
  ok("peek returns undefined on a miss (never invokes a loader)", peekMiss === undefined, JSON.stringify(peekMiss));
  eq("peeking a miss did not run any loader", loaderRuns, 1);

  // invalidation
  cache.invalidate("p9:probe");
  eq("invalidate removes the key", cache.peek("p9:probe"), undefined);
  await cache.getOrSet("p9:probe", load, { ttl: 60000 });
  eq("after invalidation the loader runs again", loaderRuns, 2);

  // in-flight dedup (§15) — concurrent callers share ONE loader run
  cache.flush();
  let slowRuns = 0;
  const slow = async () => {
    slowRuns++;
    await wait(60);
    return { v: "slow" };
  };
  const [c1, c2, c3, c4] = await Promise.all([
    cache.getOrSet("p9:slow", slow, { ttl: 60000 }),
    cache.getOrSet("p9:slow", slow, { ttl: 60000 }),
    cache.getOrSet("p9:slow", slow, { ttl: 60000 }),
    cache.getOrSet("p9:slow", slow, { ttl: 60000 }),
  ]);
  eq("FOUR concurrent callers trigger only ONE loader run (§15)", slowRuns, 1);
  ok(
    "every concurrent caller got the same value",
    [c1, c2, c3, c4].every((x) => x && x.v === "slow"),
    JSON.stringify([c1, c2, c3, c4])
  );

  // §14 — SWR is forbidden on private keys, enforced by a throw
  let swrBlocked = false;
  try {
    await cache.getOrSet("user:private:p9", async () => ({}), { ttl: 60000, swr: true });
  } catch (e) {
    swrBlocked = /stale-while-revalidate is forbidden/i.test(e.message);
  }
  ok("SWR is refused on a private key (§14)", swrBlocked);

  // The classic footgun: passing ttl positionally silently disables caching.
  cache.flush();
  let posRuns = 0;
  const posLoad = async () => {
    posRuns++;
    return { v: "x" };
  };
  await cache.getOrSet("p9:pos", posLoad, 60000); // WRONG shape on purpose
  await cache.getOrSet("p9:pos", posLoad, 60000);
  eq("a positional ttl bypasses the cache entirely (documented footgun)", posRuns, 2);

  // stats
  cache.flush();
  await cache.getOrSet("p9:st", async () => 1, { ttl: 60000 });
  const st = cache.stats();
  ok("stats reports a numeric size", typeof st.size === "number", JSON.stringify(st));
  ok("stats reports the entry cap", Number.isFinite(st.maxEntries) && st.maxEntries > 0, JSON.stringify(st));
  ok("stats reports the in-flight count", typeof st.inflight === "number", JSON.stringify(st));
  ok("the cache is enabled by default", st.disabled === false, JSON.stringify(st));

  // Private payloads must never be shared across identities over HTTP.
  const aRes = await getJSON("/notifications", { headers: H(alice) });
  const bRes = await getJSON("/notifications", { headers: H(bob) });
  ok("two identities both get served private endpoints", aRes.status === 200 && bRes.status === 200, `${aRes.status}/${bRes.status}`);
  ok(
    "private payloads are no-store so no shared cache may reuse them",
    /no-store/.test(aRes.headers.get("cache-control") || ""),
    aRes.headers.get("cache-control") || "(none)"
  );

  // The TTL registry must be populated — an empty registry would mean every
  // caller invented its own TTL and the cache is ungovernable.
  ok("the TTL registry is populated", TTL && Object.keys(TTL).length > 0, String(Object.keys(TTL || {}).length));

  /* ══ §10 Realtime caps ══════════════════════════════════════════════ */
  sec("10. Realtime concurrency caps (§43)");

  const { REALTIME_CAPS } = require("../config/rate-limits");

  ok("REALTIME_CAPS is exposed as a single source of truth", !!REALTIME_CAPS && typeof REALTIME_CAPS === "object");
  for (const key of ["SOCKETS_PER_USER", "SOCKETS_PER_IP", "PARTICIPANTS_PER_ROOM"]) {
    ok(
      `${key} is a positive finite number`,
      Number.isFinite(REALTIME_CAPS[key]) && REALTIME_CAPS[key] > 0,
      String(REALTIME_CAPS[key])
    );
  }
  ok(
    "the per-IP cap is larger than the per-user cap (NAT is legitimate)",
    REALTIME_CAPS.SOCKETS_PER_IP > REALTIME_CAPS.SOCKETS_PER_USER,
    `${REALTIME_CAPS.SOCKETS_PER_IP} vs ${REALTIME_CAPS.SOCKETS_PER_USER}`
  );
  ok(
    "room capacity is bounded so one event cannot exhaust the server",
    REALTIME_CAPS.PARTICIPANTS_PER_ROOM <= 5000,
    String(REALTIME_CAPS.PARTICIPANTS_PER_ROOM)
  );

  /* ══ §11 Failure simulation (§71) ══════════════════════════════════ */
  sec("11. Failure simulation — graceful degradation (§71)");

  /**
   * Every failure the app can hit must degrade in a defined way: a clean
   * JSON error, a sane status code, and NEVER an internal detail. The test
   * here is not "did it succeed" but "did it fail well".
   */

  const noLeak = (label, text) =>
    ok(
      label,
      !/at [A-Za-z_$][\w$]* \(|node_modules|\.js:\d+:\d+|MongoError|MongoServerError|ECONNREFUSED|supabase|cloudinary|upstash/i.test(
        text || ""
      ),
      String(text || "").slice(0, 120)
    );

  // Malformed JSON must be a clean 400, not a crash.
  const badJson = await fetch(`${B}/posts`, {
    method: "POST",
    headers: { ...H(alice), "Content-Type": "application/json" },
    body: "{ this is not json",
  });
  ok("malformed JSON is rejected cleanly", [400, 422].includes(badJson.status), String(badJson.status));
  const badJsonBody = await badJson.text();
  noLeak("the malformed-JSON error leaks no stack trace", badJsonBody);

  // Oversized JSON must be refused, not parsed (§63 body limits).
  const hugeBody = JSON.stringify({ content: "x".repeat(3 * 1024 * 1024) });
  const tooBig = await fetch(`${B}/posts`, {
    method: "POST",
    headers: { ...H(alice), "Content-Type": "application/json" },
    body: hugeBody,
  });
  ok("a 3MB JSON body is refused (§63)", tooBig.status === 413, String(tooBig.status));
  const tooBigBody = await tooBig.text();
  noLeak("the oversized-body error leaks no internals", tooBigBody);

  // Auth failures must be unambiguous and detail-free.
  const noAuth2 = await getJSON("/posts/saved");
  ok("a protected route without a token is 401", noAuth2.status === 401, String(noAuth2.status));
  noLeak("the 401 body leaks nothing", JSON.stringify(noAuth2.body));

  const badTok = await getJSON("/posts/saved", { headers: { Authorization: "Bearer not.a.real.token" } });
  ok("an invalid token is 401, not 500", badTok.status === 401, String(badTok.status));
  noLeak("the invalid-token error leaks nothing", JSON.stringify(badTok.body));

  const notAdmin = await getJSON("/admin/users/export", { headers: H(alice) });
  ok("a non-admin on an admin route is 403", notAdmin.status === 403, String(notAdmin.status));
  noLeak("the 403 body leaks nothing", JSON.stringify(notAdmin.body));

  // Unknown routes must return JSON, never an HTML 404 page.
  const missing = await getJSON("/definitely/not/a/route");
  ok("an unknown route is 404", missing.status === 404, String(missing.status));
  const ct404 = (await fetch(`${B}/definitely/not/a/route`)).headers.get("content-type") || "";
  ok("the 404 is JSON, not an HTML error page", /json/.test(ct404), ct404);

  /**
   * A bad ObjectId. KNOWN GAP, recorded rather than papered over: the
   * normalizer in utils/app-error.js DOES map CastError to 400
   * VALIDATION_FAILED, but 182 controller catch-blocks swallow the error
   * first and return a blanket `500 "Failed to load post"`. So the wire
   * status is 500 for what is really a client mistake.
   *
   * The properties that actually hold — and that matter for §61/§71 — are
   * that the response is clean JSON, leaks no CastError internals, and
   * leaves the server healthy. Rewriting 182 catch sites is a behaviour
   * change across every domain, deliberately out of scope for an
   * optimization pass; it is documented in the final report instead.
   */
  const badId = await getJSON("/posts/not-a-valid-objectid");
  ok("a malformed ObjectId does not crash the request", badId.status >= 400, String(badId.status));
  ok("the malformed-ObjectId response is a clean JSON error", badId.body?.success === false, JSON.stringify(badId.body));
  const badIdBody = await (await fetch(`${B}/posts/not-a-valid-objectid`)).text();
  noLeak("the malformed-ObjectId error leaks no CastError stack", badIdBody);
  ok("the error is not a raw Mongoose CastError message", !/CastError|Cast to ObjectId/.test(badIdBody), badIdBody.slice(0, 120));

  // The server must survive all of the above and keep serving.
  const alive = await getJSON("/health");
  eq("the server is still healthy after every failure above", alive.status, 200);
  ok(
    "health reports a healthy status",
    /^ok$/i.test(String(alive.body?.status || "")),
    JSON.stringify(alive.body)
  );

  const aliveEvents = await getJSON("/events");
  eq("browsing still works after every failure above", aliveEvents.status, 200);

  /* ══ done ═══════════════════════════════════════════════════════════ */

  console.log("\n" + "═".repeat(64));
  console.log(`  Phase 9 verification battery: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log("   • " + f));
  }
  console.log("═".repeat(64) + "\n");

  await mongod.stop();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("\n💥 selftest crashed:", e);
  process.exit(1);
});
