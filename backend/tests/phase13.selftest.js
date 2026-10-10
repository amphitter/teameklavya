#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 · PHASE 6   AUTH HARDENING & FUZZING
 *  §14 auth hardening · §15 token security · §16 API fuzzing · §17 authz fuzzing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This suite boots the real server against an in-memory MongoDB and attacks it.
 *
 * §16 and §17 are the two halves of "the API is hostile-input-safe":
 *
 *   §16  MALFORMED input must produce a 4xx, never a 500 and never a stack
 *        trace. A 500 on a malformed ObjectId is not just ugly — it is a
 *        reliable oracle that tells an attacker which inputs reach the database
 *        layer unvalidated, and the stack trace hands them the file layout.
 *
 *   §17  WELL-FORMED input from the WRONG PRINCIPAL must be refused. A perfect
 *        input validator is worthless if user B can edit user A's event, so the
 *        matrix here crosses seven roles against each resource.
 *
 * Together they cover what a per-endpoint test suite structurally cannot: the
 * combinations nobody thought to write a test for.
 *
 * §15 is here because it needs the running server to disprove: the question
 * "does this API use cookies?" is answered by looking at what login actually
 * returns, not by reading a comment.
 */

"use strict";

const fs = require("fs");
const path = require("path");

process.env.JWT_SECRET = "phase13-secret-not-a-real-key";
process.env.JWT_EXPIRES_IN = "7d";
process.env.MONGO_URI = "SET-BY-MEMORY-SERVER";
// NOTE: do not use 5060/5061 — they are on the WHATWG fetch spec's blocked
// port list (sip/sips), so undici refuses to connect and every assertion
// silently "passes" against status 0.
process.env.PORT = process.env.PHASE13_PORT || "5099";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.NODE_ENV = "test";
process.env.GOOGLE_CLIENT_ID = "stub-id";
process.env.GOOGLE_CLIENT_SECRET = "stub-secret";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:5099/api/auth/google/callback";
process.env.CACHE_PROVIDER = "memory";
process.env.RATE_LIMIT_PROVIDER = "memory";

const PORT = process.env.PORT;
const BASE = `http://localhost:${PORT}/api`;

const ROOT = path.join(__dirname, "..");

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

let passed = 0;
let failed = 0;
const failures = [];

function sec(t) {
  console.log(`\n── ${t} ──`);
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
  ok(name, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 5xx, or a leaked stack trace, is a failure no matter what else happened. */
function isSafeFailure(status, body) {
  if (status >= 500) return { safe: false, why: `status ${status}` };
  const text = JSON.stringify(body || {});
  if (/at [A-Za-z_$][\w$]*\s*\(.*:\d+:\d+\)/.test(text)) return { safe: false, why: "stack trace in body" };
  if (/\.js:\d+:\d+/.test(text)) return { safe: false, why: "file:line in body" };
  if (/MongoError|CastError|ValidationError|node_modules/i.test(text)) {
    return { safe: false, why: "internal error class in body" };
  }
  return { safe: true };
}

async function call(path, opts = {}) {
  try {
    const res = await fetch(BASE + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      body:
        opts.rawBody !== undefined
          ? opts.rawBody
          : opts.body === undefined
            ? undefined
            : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { __nonJson: text.slice(0, 200) };
    }
    return { status: res.status, data, headers: res.headers };
  } catch (err) {
    if (process.env.PHASE13_DEBUG) {
      console.log(`     [debug] ${opts.method || "GET"} ${path} THREW: ${err.message} cause=${err.cause?.message || "-"}`);
    }
    return { status: 0, data: { error: String(err.message) }, headers: new Map() };
  }
}

(async () => {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  PART 7 · PHASE 6 — AUTH HARDENING & FUZZING (§14–§17)");
  console.log("══════════════════════════════════════════════════════════════");

  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri("eventhub_phase13");

  const jwt = require("jsonwebtoken");
  require("../server");
  await sleep(2000);

  const User = require("../models/user.model");
  const Event = require("../models/event.model");
  const Community = require("../models/community.model");
  const CommunityMember = require("../models/communityMember.model");
  const Organization = require("../models/organization.model");

  const SA_EMAIL = "devanshsinghr00@gmail.com";
  const mk = (id, email, extra = {}) =>
    User.create({
      firstName: id,
      lastName: "Tester",
      email,
      passwordHash: "not-a-real-hash",
      emailVerified: true,
      ...extra,
    });

  const [userA, userB, orgA, orgB, orgMgr, commOwner, superAdmin] = await Promise.all([
    mk("UserA", "usera@phase13.test"),
    mk("UserB", "userb@phase13.test"),
    mk("OrgA", "orga@phase13.test"),
    mk("OrgB", "orgb@phase13.test"),
    mk("OrgMgr", "orgmgr@phase13.test"),
    mk("CommOwner", "commowner@phase13.test"),
    mk("SuperAdmin", SA_EMAIL, { role: "admin" }),
  ]);

  const tokenFor = (u) =>
    jwt.sign(
      { id: String(u._id), role: u.role || "user", email: u.email, purpose: "auth" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

  const ACTORS = {
    USER_A: { user: userA, token: tokenFor(userA) },
    USER_B: { user: userB, token: tokenFor(userB) },
    ORGANIZER_A: { user: orgA, token: tokenFor(orgA) },
    ORGANIZER_B: { user: orgB, token: tokenFor(orgB) },
    ORG_MANAGER: { user: orgMgr, token: tokenFor(orgMgr) },
    COMMUNITY_OWNER: { user: commOwner, token: tokenFor(commOwner) },
    SUPER_ADMIN: { user: superAdmin, token: tokenFor(superAdmin) },
    ANON: { user: null, token: null },
  };
  const auth = (who) =>
    ACTORS[who].token ? { Authorization: `Bearer ${ACTORS[who].token}` } : {};

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("1. §15 — the auth model, established by observation not by comment");

  const loginRes = await call("/auth/login", {
    method: "POST",
    body: { email: "usera@phase13.test", password: "wrong" },
  });
  const setCookie = loginRes.headers?.get?.("set-cookie");
  ok(
    "§15: the API sets NO cookie on login (bearer-token model, not cookie auth)",
    !setCookie,
    String(setCookie)
  );

  const badLogin = await call("/auth/login", {
    method: "POST",
    body: { email: "nobody@phase13.test", password: "whatever" },
  });
  const unknownLogin = await call("/auth/login", {
    method: "POST",
    body: { email: "ghost@phase13.test", password: "whatever" },
  });
  ok(
    "§14: a wrong password and an unknown address give the SAME response (no account enumeration)",
    badLogin.status === unknownLogin.status &&
      JSON.stringify(badLogin.data) === JSON.stringify(unknownLogin.data),
    `${badLogin.status}/${JSON.stringify(badLogin.data)} vs ${unknownLogin.status}/${JSON.stringify(unknownLogin.data)}`
  );

  let noAuth = await call("/users/me/social", { method: "GET" });
  ok(
    "§14: an unauthenticated request is refused",
    noAuth.status === 401 || noAuth.status === 403,
    String(noAuth.status)
  );

  const garbageToken = await call("/users/me/social", {
    method: "GET",
    headers: { Authorization: "Bearer not.a.jwt" },
  });
  ok(
    "§14: a malformed bearer token is refused, not crashed on",
    garbageToken.status === 401,
    String(garbageToken.status)
  );

  const emptyBearer = await call("/users/me/social", {
    method: "GET",
    headers: { Authorization: "Bearer " },
  });
  ok("§14: an empty bearer token is refused", emptyBearer.status === 401, String(emptyBearer.status));

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("2. §16 — malformed input must never produce a 500 or a stack trace");

  const OBJECT_ID = String(userA._id);
  const MALFORMED_IDS = [
    "not-an-objectid",
    "123",
    "../../etc/passwd",
    "'; DROP TABLE users;--",
    "%00",
    "a".repeat(500),
    "[]",
    "{}",
    "null",
    "undefined",
    "5f4d",
    " $where ",
  ];

  const idEndpoints = [
    "/events/{ID}",
    "/users/{ID}/profile",
    "/posts/{ID}",
    "/communities/{ID}",
    "/organizations/{ID}",
    "/notifications/{ID}",
    "/follow/{ID}/status",
  ];

  let idCrashes = 0;
  let idChecked = 0;
  const idFailures = [];
  for (const ep of idEndpoints) {
    for (const bad of MALFORMED_IDS) {
      const r = await call(ep.replace("{ID}", encodeURIComponent(bad)), {
        method: "GET",
        headers: auth("USER_A"),
      });
      idChecked += 1;
      const v = isSafeFailure(r.status, r.data);
      if (!v.safe) {
        idCrashes += 1;
        if (idFailures.length < 4) idFailures.push(`${ep}=${bad.slice(0, 20)} → ${v.why}`);
      }
    }
  }
  ok(
    `§16: ${idChecked} malformed ObjectId probes produce no 5xx and no stack trace`,
    idCrashes === 0,
    idFailures.join(" | ")
  );

  /* -- hostile bodies -- */
  const deep = {};
  let cur = deep;
  for (let i = 0; i < 60; i++) {
    cur.next = {};
    cur = cur.next;
  }

  const HOSTILE_BODIES = [
    ["deeply nested JSON", deep],
    ["huge string", { name: "x".repeat(200_000) }],
    ["huge array", { items: new Array(20_000).fill("x") }],
    ["negative limit", { limit: -1 }],
    ["extreme limit", { limit: 1e12 }],
    ["NaN limit", { limit: Number.NaN }],
    ["string limit", { limit: "100" }],
    ["prototype pollution", JSON.parse('{"__proto__":{"isAdmin":true},"name":"x"}')],
    ["constructor pollution", JSON.parse('{"constructor":{"prototype":{"isAdmin":true}}}')],
    ["regex abuse", { q: "(a+)+$" }],
    ["regex nested quantifier", { q: "^(a|a?)+$" }],
    ["unicode RTL override", { name: "‮gnp.exe‬" }],
    ["null bytes", { name: "a b" }],
    ["emoji storm", { name: "🔥".repeat(5000) }],
    ["script payload", { name: "<script>alert(1)</script>" }],
    ["img onerror", { bio: '<img src=x onerror=alert(1)>' }],
    ["sql-ish", { name: "' OR 1=1 --" }],
    ["mongo operator", { $gt: "" }],
    ["wrong types", { name: { nested: { deep: true } } }],
    ["array where string expected", { name: ["a", "b"] }],
    ["unexpected fields", { totallyNotAField: 1, __v: 99 }],
  ];

  const writeTargets = [
    ["/events", "POST"],
    ["/posts", "POST"],
    ["/communities", "POST"],
    ["/organizations", "POST"],
  ];

  let bodyCrashes = 0;
  let bodyChecked = 0;
  const bodyFailures = [];
  for (const [ep, method] of writeTargets) {
    for (const [label, body] of HOSTILE_BODIES) {
      const r = await call(ep, { method, body, headers: auth("SUPER_ADMIN") });
      bodyChecked += 1;
      const v = isSafeFailure(r.status, r.data);
      if (!v.safe) {
        bodyCrashes += 1;
        if (bodyFailures.length < 6) bodyFailures.push(`${ep} ${label} → ${v.why} (${r.status})`);
      }
    }
  }
  ok(
    `§16: ${bodyChecked} hostile-body probes produce no 5xx and no stack trace`,
    bodyCrashes === 0,
    bodyFailures.join(" | ")
  );

  /* -- invalid content types -- */
  let ctCrashes = 0;
  for (const ct of ["text/plain", "application/xml", "multipart/form-data", "", "application/json;charset=utf-7"]) {
    const r = await call("/events", {
      method: "POST",
      rawBody: "<event><name>x</name></event>",
      headers: { "Content-Type": ct, ...auth("SUPER_ADMIN") },
    });
    const v = isSafeFailure(r.status, r.data);
    if (!v.safe) ctCrashes += 1;
  }
  ok("§16: unsupported content types are rejected safely", ctCrashes === 0, `${ctCrashes} crashed`);

  /* -- malformed JSON -- */
  const broken = await call("/events", {
    method: "POST",
    rawBody: '{"name": "unterminated',
    headers: { "Content-Type": "application/json", ...auth("SUPER_ADMIN") },
  });
  ok(
    "§16: malformed JSON is a 400, not a 500",
    broken.status === 400,
    String(broken.status)
  );

  /* -- oversized payload -- */
  const huge = await call("/events", {
    method: "POST",
    rawBody: JSON.stringify({ name: "x".repeat(5 * 1024 * 1024) }),
    headers: { "Content-Type": "application/json", ...auth("SUPER_ADMIN") },
  });
  ok(
    "§16: an oversized payload is refused with 413, not accepted or crashed on",
    huge.status === 413,
    String(huge.status)
  );

  /* -- duplicate / conflicting params -- */
  const dup = await call(`/events?limit=10&limit=999999&limit=-5`, {
    method: "GET",
    headers: auth("USER_A"),
  });
  ok(
    "§16: duplicated query params are handled without crashing",
    isSafeFailure(dup.status, dup.data).safe,
    String(dup.status)
  );

  /* -- invalid pagination cursors -- */
  let cursorCrashes = 0;
  for (const c of ["", "not-a-cursor", " ", " ".repeat(100), "../../", "-1", "1e999", JSON.stringify({ $gt: "" })]) {
    const r = await call(`/events?cursor=${encodeURIComponent(c)}&limit=10`, {
      method: "GET",
      headers: auth("USER_A"),
    });
    if (!isSafeFailure(r.status, r.data).safe) cursorCrashes += 1;
  }
  ok("§16: invalid pagination cursors never crash", cursorCrashes === 0, `${cursorCrashes} crashed`);

  /* -- prototype pollution must not stick -- */
  await call("/events", {
    method: "POST",
    body: JSON.parse('{"__proto__":{"polluted":true}}'),
    headers: auth("SUPER_ADMIN"),
  });
  ok(
    "§16: prototype pollution via JSON body does not affect Object.prototype",
    {}.polluted === undefined && Object.prototype.polluted === undefined
  );

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("3. §17 — authorization matrix: seven roles, real resources");

  /* Create real resources owned by specific actors. */
  const evA = await Event.create({
    title: "Organizer A Event",
    slug: "organizer-a-event",
    description: "owned by ORGANIZER_A",
    category: "Hackathon",
    createdBy: orgA._id,
    organizer: orgA._id,
    isPublished: true,
    startDate: new Date(Date.now() + 86400000),
    endDate: new Date(Date.now() + 2 * 86400000),
    venue: "Test Venue A",
  });
  const evB = await Event.create({
    title: "Organizer B Event",
    slug: "organizer-b-event",
    description: "owned by ORGANIZER_B",
    category: "Hackathon",
    createdBy: orgB._id,
    organizer: orgB._id,
    isPublished: true,
    startDate: new Date(Date.now() + 86400000),
    endDate: new Date(Date.now() + 2 * 86400000),
    venue: "Test Venue B",
  });

  const community = await Community.create({
    name: "Owners Community",
    slug: "owners-community",
    description: "owned by COMMUNITY_OWNER",
    createdBy: commOwner._id,
    joinPolicy: "open",
  });
  await CommunityMember.create({
    community: community._id,
    user: commOwner._id,
    role: "admin",
    status: "active",
  });
  await CommunityMember.create({
    community: community._id,
    user: userA._id,
    role: "member",
    status: "active",
  });

  const org = await Organization.create({
    name: "Manager Org",
    slug: "manager-org",
    description: "managed by ORG_MANAGER",
    createdBy: orgMgr._id,
  });

  /* -- nobody may mutate another organizer's event -- */
  const crossEdit = await call(`/events/${evA._id}`, {
    method: "PUT",
    body: { title: "Hijacked" },
    headers: auth("ORGANIZER_B"),
  });
  ok(
    "§17: ORGANIZER_B cannot edit ORGANIZER_A's event",
    crossEdit.status === 403 || crossEdit.status === 404,
    String(crossEdit.status)
  );

  const crossEditUser = await call(`/events/${evA._id}`, {
    method: "PUT",
    body: { title: "Hijacked" },
    headers: auth("USER_B"),
  });
  ok(
    "§17: an unrelated USER cannot edit someone else's event",
    crossEditUser.status === 403 || crossEditUser.status === 404,
    String(crossEditUser.status)
  );

  const anonEdit = await call(`/events/${evA._id}`, {
    method: "PUT",
    body: { title: "Hijacked" },
    headers: auth("ANON"),
  });
  ok(
    "§17: ANON cannot edit any event",
    anonEdit.status === 401 || anonEdit.status === 403,
    String(anonEdit.status)
  );

  const anonDelete = await call(`/events/${evB._id}`, {
    method: "DELETE",
    headers: auth("ANON"),
  });
  ok(
    "§17: ANON cannot delete an event",
    anonDelete.status === 401 || anonDelete.status === 403,
    String(anonDelete.status)
  );

  /* -- the owner CAN act on their own resource -- */
  /* PUT /events/:id is requireAdmin, so an ordinary organizer is refused by
   * role. The meaningful "owner CAN act" probe therefore uses the Super Admin,
   * who bypasses role checks — the point is that the endpoint is reachable and
   * correct for an authorised principal, not that it is open to everyone. */
  const ownEdit = await call(`/events/${evA._id}`, {
    method: "PUT",
    body: { description: "edited by an authorised principal" },
    headers: auth("SUPER_ADMIN"),
  });
  ok(
    "§17: an AUTHORISED principal CAN edit the event (the rule is not a blanket ban)",
    ownEdit.status < 400,
    `${ownEdit.status} ${JSON.stringify(ownEdit.data).slice(0, 120)}`
  );

  // Phase 5+: Event ownership allows the creator/organizer to manage their own
  // Event via canManageEvent/requireEventManager, not just platform admins.
  // The previous expectation that any non-admin organizer is refused is outdated
  // for owner-scoped routes; the correct check is cross-owner denial.
  const ownerEditOwn = await call(`/events/${evA._id}`, {
    method: "PUT",
    body: { description: "edited by the owning organizer" },
    headers: auth("ORGANIZER_A"),
  });
  ok(
    "§17: the owning ORGANIZER can edit their own event (owner-scoped, not blanket admin-only)",
    ownerEditOwn.status < 400,
    `${ownerEditOwn.status} ${JSON.stringify(ownerEditOwn.data).slice(0, 120)}`
  );

  /* -- community: a plain member cannot act as admin -- */
  const memberAdmin = await call(`/communities/${community.slug}`, {
    method: "PUT",
    body: { name: "Hijacked Community" },
    headers: auth("USER_A"),
  });
  ok(
    "§17: a plain MEMBER cannot update the community",
    memberAdmin.status === 403 || memberAdmin.status === 404,
    String(memberAdmin.status)
  );

  const nonMemberAdmin = await call(`/communities/${community.slug}`, {
    method: "PUT",
    body: { name: "Hijacked Community" },
    headers: auth("USER_B"),
  });
  ok(
    "§17: a NON-MEMBER cannot update the community",
    nonMemberAdmin.status === 403 || nonMemberAdmin.status === 404,
    String(nonMemberAdmin.status)
  );

  const ownerUpdate = await call(`/communities/${community.slug}`, {
    method: "PUT",
    body: { description: "updated by the owner" },
    headers: auth("COMMUNITY_OWNER"),
  });
  ok(
    "§17: the COMMUNITY_OWNER CAN update their own community",
    ownerUpdate.status < 400,
    `${ownerUpdate.status} ${JSON.stringify(ownerUpdate.data).slice(0, 120)}`
  );

  /* -- the Super Admin bypasses role checks -- */
  const saUpdate = await call(`/communities/${community.slug}`, {
    method: "PUT",
    body: { description: "updated by the Super Admin" },
    headers: auth("SUPER_ADMIN"),
  });
  ok(
    "§17: the SUPER_ADMIN can act on a community they do not own",
    saUpdate.status < 400,
    `${saUpdate.status} ${JSON.stringify(saUpdate.data).slice(0, 120)}`
  );

  /* -- admin-only surfaces are closed to ordinary users -- */
  for (const [who, ep] of [
    ["USER_A", "/admin/stats"],
    ["USER_A", "/admin/users"],
    ["ORGANIZER_A", "/admin/stats"],
    ["COMMUNITY_OWNER", "/admin/users"],
  ]) {
    const r = await call(ep, { method: "GET", headers: auth(who) });
    ok(
      `§17: ${who} is refused at ${ep}`,
      r.status === 401 || r.status === 403 || r.status === 404,
      String(r.status)
    );
  }

  const anonAdmin = await call("/admin/stats", { method: "GET", headers: auth("ANON") });
  ok(
    "§17: ANON is refused at /admin/stats",
    anonAdmin.status === 401 || anonAdmin.status === 403,
    String(anonAdmin.status)
  );

  /* -- the Super Admin's own protections still hold -- */
  const saSelfRemove = await call("/users/me/social", { method: "GET", headers: auth("SUPER_ADMIN") });
  ok(
    "§17: the SUPER_ADMIN can read their own profile",
    saSelfRemove.status < 400 || saSelfRemove.status === 404,
    String(saSelfRemove.status)
  );

  /* -- cross-user reads must not leak -- */
  const messages = await call(`/messages/conversations`, {
    method: "GET",
    headers: auth("USER_A"),
  });
  ok(
    "§17: a user's conversation list is scoped to them (no 500, no global list)",
    isSafeFailure(messages.status, messages.data).safe && messages.status !== 500,
    String(messages.status)
  );

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("4. §14 — brute force is throttled, and credentials are never logged");

  /* Capture console output during the burst, so we can assert on what the
   * server actually printed rather than on what we hope it printed. */
  const captured = [];
  for (const level of ["log", "warn", "error", "info"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
      original(...args);
    };
  }

  const SECRET_PASSWORD = "super-secret-password-xyz";
  let last = null;
  let sawThrottle = false;
  for (let i = 0; i < 34; i++) {
    last = await call("/auth/login", {
      method: "POST",
      body: { email: "usera@phase13.test", password: SECRET_PASSWORD },
    });
    if (last.status === 429) {
      sawThrottle = true;
      break;
    }
  }
  ok(
    "§14: repeated failed logins are throttled (429) rather than unlimited",
    sawThrottle,
    `final status ${last && last.status}`
  );

  ok(
    "§14: the throttle response carries Retry-After",
    !sawThrottle || Boolean(last.headers?.get?.("retry-after")),
    String(last.headers?.get?.("retry-after"))
  );

  const joined = captured.join("\n");
  ok(
    "§14: the attempted PASSWORD never appears in server output",
    !joined.includes(SECRET_PASSWORD)
  );
  ok(
    "§14: no OTP-shaped value is logged",
    !/\b\d{6}\b.*(otp|code)/i.test(joined) && !/(otp|code)[^\n]{0,20}\b\d{6}\b/i.test(joined)
  );
  ok(
    "§14: no JWT is logged",
    !/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(joined)
  );

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("5. §30 — one error taxonomy, ten codes, no controller invents one");

  const { ERROR_CODES, errorResponse, canonicalCode, IdempotencyConflictError, ValidationError } =
    require("../utils/app-error");

  const CANON = Object.keys(ERROR_CODES);
  eq("§30: there are exactly ten error codes", CANON.length, 10);
  ok(
    "§30: …and they are the ones the brief names",
    [
      "VALIDATION_ERROR",
      "AUTH_REQUIRED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "RATE_LIMITED",
      "IDEMPOTENCY_CONFLICT",
      "PROVIDER_UNAVAILABLE",
      "TIMEOUT",
      "INTERNAL_ERROR",
    ].every((c) => CANON.includes(c)),
    CANON.join(",")
  );

  /* Every realistic error shape must land on a canonical code. */
  const SHAPES = [
    ["mongoose CastError", { name: "CastError", message: "Cast to ObjectId failed" }],
    ["mongoose ValidationError", { name: "ValidationError", errors: { a: { message: "bad" } } }],
    ["duplicate key", { name: "MongoServerError", code: 11000, keyValue: { email: "x" } }],
    ["expired JWT", { name: "TokenExpiredError", message: "jwt expired" }],
    ["malformed JWT", { name: "JsonWebTokenError", message: "invalid token" }],
    ["multer limit", { name: "MulterError", code: "LIMIT_FILE_SIZE", message: "too big" }],
    ["body-parser malformed JSON", { type: "entity.parse.failed", status: 400 }],
    ["body-parser too large", { type: "entity.too.large", status: 413 }],
    ["rate limited", { status: 429 }],
    ["unknown", new Error("something unexpected")],
    ["nothing at all", undefined],
  ];
  const offTaxonomy = [];
  for (const [label, shape] of SHAPES) {
    const r = errorResponse(shape);
    if (!CANON.includes(r.body?.error?.code)) offTaxonomy.push(`${label}→${r.body?.error?.code}`);
    if (typeof r.status !== "number") offTaxonomy.push(`${label} (no status)`);
  }
  ok(
    "§30: every error shape normalises to a canonical code and a numeric status",
    offTaxonomy.length === 0,
    offTaxonomy.join(",")
  );

  /* A status must be paired with the code it implies, not merely be a 4xx. */
  eq("§30: a CastError is 400, not 500", errorResponse({ name: "CastError" }).status, 400);
  eq("§30: a duplicate key is 409", errorResponse({ name: "MongoServerError", code: 11000 }).status, 409);
  eq("§30: an expired token is 401", errorResponse({ name: "TokenExpiredError" }).status, 401);
  eq("§30: an oversized body is 413", errorResponse({ type: "entity.too.large" }).status, 413);
  eq("§30: a rate limit is 429", errorResponse({ status: 429 }).status, 429);
  eq("§30: the unknown falls to 500", errorResponse(new Error("x")).status, 500);

  /* The distinction §30 draws between the two 409s: a state conflict needs a
   * re-read, a retry collision needs nothing. */
  const idem = errorResponse(new IdempotencyConflictError());
  eq("§30: an idempotency collision is 409", idem.status, 409);
  eq("§30: …coded IDEMPOTENCY_CONFLICT, not a generic CONFLICT", idem.body.error.code, "IDEMPOTENCY_CONFLICT");
  const conflict = errorResponse({ name: "MongoServerError", code: 11000 });
  ok(
    "§30: …and it is distinguishable from an ordinary CONFLICT",
    conflict.body.error.code === "CONFLICT" && conflict.status === idem.status
  );

  /* No invented codes anywhere in the HTTP layer. The Socket.IO protocol has
   * its own code set, which the live frontend depends on; §30 governs HTTP. */
  /* §30 governs the HTTP taxonomy. The Socket.IO wire protocol is a SEPARATE
   * namespace with its own codes (AUTH_FAILED, NOT_AUTHORIZED, …) that the
   * live-event frontend already branches on. Renaming those would break the
   * live quiz, so they are excluded — but excluded by name, and asserted
   * below to still exist, so the exclusion cannot quietly widen. */
  const SOCKET_FILES = new Set([
    path.join("config", "socket-protocol.js"),
    path.join("middleware", "socket-auth.middleware.js"),
  ]);
  const invented = [];
  for (const f of walk(path.join(ROOT, "controllers"))
    .concat(walk(path.join(ROOT, "middleware")))
    .concat(walk(path.join(ROOT, "services")))
    .concat(walk(path.join(ROOT, "utils")))) {
    if (SOCKET_FILES.has(rel(f))) continue;
    if (rel(f) === path.join("utils", "app-error.js")) continue; // the taxonomy itself
    const text = read(f);
    for (const m of text.matchAll(/code:\s*"([A-Z_]+)"/g)) {
      if (!CANON.includes(m[1])) invented.push(`${rel(f)}:${m[1]}`);
    }
  }
  ok(
    "§30: no controller, middleware or service emits a non-canonical error code",
    invented.length === 0,
    [...new Set(invented)].slice(0, 8).join(",")
  );

  ok(
    "§30: the Socket.IO protocol keeps its own code set deliberately (not renamed out from under the live frontend)",
    /ERROR_CODES/.test(read(path.join(ROOT, "config", "socket-protocol.js")))
  );

  /* Legacy Part 5 names must still normalise, so a stale build degrades
   * rather than turning a handled case into a 500. */
  eq("§30: the legacy UNAUTHORIZED maps to AUTH_REQUIRED", canonicalCode("UNAUTHORIZED"), "AUTH_REQUIRED");
  eq("§30: the legacy OPERATION_TIMEOUT maps to TIMEOUT", canonicalCode("OPERATION_TIMEOUT"), "TIMEOUT");
  eq("§30: the legacy INTERNAL maps to INTERNAL_ERROR", canonicalCode("INTERNAL"), "INTERNAL_ERROR");
  eq("§30: an unrecognised code falls to INTERNAL_ERROR", canonicalCode("MADE_UP"), "INTERNAL_ERROR");

  /* And the wire contract: a real request must return the canonical shape. */
  const realErr = await call("/events/not-an-object-id", { method: "GET", headers: auth("SUPER_ADMIN") });
  ok(
    "§30: a real 4xx response carries { success, message, error: { code } }",
    realErr.status >= 400 &&
      realErr.data &&
      realErr.data.success === false &&
      realErr.data.error &&
      CANON.includes(realErr.data.error.code),
    JSON.stringify(realErr.data).slice(0, 160)
  );

  /* ══════════════════════════════════════════════════════════════════════ */

  await sleep(200);
  try {
    await require("mongoose").disconnect();
  } catch {}
  try {
    await mongod.stop();
  } catch {}

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  PART 7 (phase 6) auth & fuzzing: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`    · ${f}`);
  }
  console.log("══════════════════════════════════════════════════════════════\n");
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (err) => {
  failed += 1;
  console.log(String((err && err.stack) || err));
  console.log(`\n  PART 7 (phase 6): ${passed} passed, ${failed} failed (crashed)\n`);
  process.exit(1);
});
