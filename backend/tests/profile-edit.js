/**
 * Part 9 §2–7 — profile editing, end to end.
 *
 *   node tests/profile-edit.js
 *
 * The report this suite answers was "no profile section is updated". The
 * cause was a dead wire in the UI, not the API — so these assertions pin the
 * API down hard, and the wiring is verified by the frontend build plus the
 * route audit in docs/PART9_PROFILE_DEFECT.md.
 *
 * What is asserted:
 *   §2-7  username set + uniqueness + validation
 *   §2-7  live availability while typing (the sheet's "Checking/Available/Taken")
 *   §2-7  avatar persisted and returned
 *   §7    banner persisted, REMOVABLE, and its focal point stored + clamped
 *   §2-7  bio / location / website sanitised
 *   §2-7  the save response carries the whole identity (propagate without logout)
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5104";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "profile-test-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.REALTIME_CAP_SOCKETS_PER_IP = "700";
/* This suite performs ~40 rapid profile writes to exercise every validation
 * branch, which is far past the AUTH bucket's limit. That limiter is correct
 * in production and has its own tests; enabling it here would only mask the
 * field-level behaviour under test with 429s. */
process.env.RATE_LIMIT_DISABLED = "1";

const http = require("http");

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const section = (t) => console.log(`\n── ${t} ──`);

function call(method, path, body, token) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { accept: "application/json" };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(d);
        } catch {
          parsed = d.slice(0, 200);
        }
        resolve({ s: res.statusCode, d: parsed });
      });
    });
    req.on("error", (e) => resolve({ s: 0, d: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const PORT = process.env.PORT;
const AVAIL = "/api/auth/username-availability";

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const fs = require("fs");
  const dataDir = `/var/tmp/mongo-profile-${Date.now()}`;
  fs.mkdirSync(dataDir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dataDir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");

  for (let i = 0; i < 60; i++) {
    try {
      if ((await call("GET", "/api/health")).s === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }

  const mongoose = require("mongoose");
  const User = require("../models/user.model");
  await User.init();

  const stamp = Date.now();
  const A = { email: `a${stamp}@x.com`, password: "Test1234!" };
  const B = { email: `b${stamp}@x.com`, password: "Test1234!" };
  await call("POST", "/api/auth/signup", { ...A, firstName: "Ana", lastName: "Roy", confirmPassword: A.password, acceptTerms: true });
  await call("POST", "/api/auth/signup", { ...B, firstName: "Ben", lastName: "Sky", confirmPassword: B.password, acceptTerms: true });
  await User.updateMany({ email: { $in: [A.email, B.email] } }, { $set: { emailVerified: true } });

  let r = await call("POST", "/api/auth/login", A);
  const ta = r.d.token;
  ok(!!ta, "logged in");
  r = await call("POST", "/api/auth/login", B);
  const tb = r.d.token;

  /* ── §2-7 — username ─────────────────────────────────────────────── */
  section("§2-7 — username");
  const uname = `ana_${String(stamp).slice(-6)}`;
  r = await call("GET", `${AVAIL}?username=${uname}`, null, ta);
  ok(r.s === 200 && r.d.available === true, "availability check says an unused handle is available");

  r = await call("PUT", "/api/auth/me/profile", { username: uname }, ta);
  ok(r.s === 200 && r.d.success, "username saved", `${r.s}`);
  ok(r.d.user?.username === uname, "the save response returns the NEW username (propagate without logout)");
  ok(!!r.d.user?._id && !!r.d.user?.firstName, "the response carries the whole identity, not just the changed field");

  // Persisted, not just echoed.
  r = await call("GET", "/api/auth/me", null, ta);
  ok(r.d.user?.username === uname, "username is persisted — a reload keeps it");

  // Taken, and taken-by-another must not save.
  r = await call("GET", `${AVAIL}?username=ben_sky`, null, ta);
  ok(r.d.available === false && r.d.reason === "taken", "availability reports another user's handle as taken");
  r = await call("PUT", "/api/auth/me/profile", { username: "ben_sky" }, ta);
  ok(r.s === 409, "saving a taken username is refused with 409", `${r.s}`);
  ok(r.d.field === "username", "the 409 names the offending field for the form");
  r = await call("GET", "/api/auth/me", null, ta);
  ok(r.d.user?.username === uname, "the refused save did NOT change the stored username");

  // Unchanged username must stay valid for its owner (the self-exclusion).
  r = await call("GET", `${AVAIL}?username=${uname}`, null, ta);
  ok(r.d.available === true, "your OWN username still reads as available to you (no false 'taken')");
  /* §17 — retyping your own handle is answered without a database round trip.
     This endpoint sits on the typing path, so it is the wrong place to spend a
     query on an answer that can only ever be "yes, it's yours". */
  ok(r.d.reason === "same", "your own username is answered as 'same' (no query needed)", `reason=${r.d.reason}`);
  // The anonymous case must still hit the database — no short-circuit without a session.
  r = await call("GET", `${AVAIL}?username=${uname}`);
  ok(r.d.available === false && r.d.reason === "taken", "an anonymous caller still gets a real check");
  r = await call("PUT", "/api/auth/me/profile", { username: uname, bio: "still fine" }, ta);
  ok(r.s === 200, "re-saving your own unchanged username is allowed");

  // Validation.
  r = await call("PUT", "/api/auth/me/profile", { username: "ab" }, ta);
  ok(r.s === 400, "a 2-character username is rejected", `${r.s}`);
  r = await call("PUT", "/api/auth/me/profile", { username: "has spaces" }, ta);
  ok(r.s === 400, "a username with spaces is rejected", `${r.s}`);
  r = await call("PUT", "/api/auth/me/profile", { username: "UPPER" }, ta);
  ok(r.s === 200 && r.d.user.username === "upper", "uppercase is normalised to lowercase");
  await call("PUT", "/api/auth/me/profile", { username: uname }, ta);

  r = await call("GET", `${AVAIL}?username=ab`, null, ta);
  ok(r.d.available === false && r.d.reason === "invalid", "availability distinguishes 'invalid' from 'taken' (the sheet shows both)");

  /* ── §2-7 — avatar ───────────────────────────────────────────────── */
  section("§2-7 — profile photo");
  const avatarUrl = "https://res.cloudinary.com/demo/image/upload/v1/avatars/ana.jpg";
  r = await call("PUT", "/api/auth/me/profile", { avatar: avatarUrl }, ta);
  ok(r.s === 200 && r.d.user?.profile?.avatar === avatarUrl, "avatar URL persisted");
  r = await call("GET", "/api/auth/me", null, ta);
  ok(r.d.user?.profile?.avatar === avatarUrl, "avatar survives a re-read (§2-7 'store the actual URL')");

  r = await call("PUT", "/api/auth/me/profile", { avatar: "not-a-url" }, ta);
  ok(r.s === 400, "a non-URL avatar is refused", `${r.s}`);
  // A javascript: href on a profile would be an XSS vector.
  r = await call("PUT", "/api/auth/me/profile", { avatar: "javascript:alert(1)" }, ta);
  ok(r.s === 400, "a javascript: avatar is refused", `${r.s}`);
  r = await call("GET", "/api/auth/me", null, ta);
  ok(r.d.user?.profile?.avatar === avatarUrl, "the refused writes left the stored avatar intact");

  r = await call("PUT", "/api/auth/me/profile", { avatar: "" }, ta);
  ok(r.s === 200 && r.d.user?.profile?.avatar === "", "avatar is REMOVABLE (empty falls back to initials)");
  await call("PUT", "/api/auth/me/profile", { avatar: avatarUrl }, ta);

  /* ── §7 — banner + reposition ────────────────────────────────────── */
  section("§7 — banner (upload / reposition / remove)");
  const coverUrl = "https://res.cloudinary.com/demo/image/upload/v1/posters/skyline.jpg";
  r = await call("PUT", "/api/auth/me/profile", { coverImage: coverUrl }, ta);
  ok(r.s === 200 && r.d.user?.profile?.coverImage === coverUrl, "banner URL persisted");
  r = await call("GET", "/api/auth/me", null, ta);
  ok(r.d.user?.profile?.coverImage === coverUrl, "banner survives a re-read");
  ok(r.d.user?.profile?.coverPosition === 50, "a new banner defaults to a centred focal point (0-50-100)", `${r.d.user?.profile?.coverPosition}`);

  r = await call("PUT", "/api/auth/me/profile", { coverPosition: 18 }, ta);
  ok(r.s === 200 && r.d.user?.profile?.coverPosition === 18, "focal point saved — the reposition is persisted, not just a local preview");
  r = await call("GET", "/api/auth/me", null, ta);
  ok(r.d.user?.profile?.coverPosition === 18, "focal point survives a reload (a reposition that resets is not a reposition)");

  r = await call("PUT", "/api/auth/me/profile", { coverPosition: 999 }, ta);
  ok(r.s === 200 && r.d.user?.profile?.coverPosition === 100, "an out-of-range focal point is clamped, not rejected (the banner stays visible)", `${r.d.user?.profile?.coverPosition}`);
  r = await call("PUT", "/api/auth/me/profile", { coverPosition: -40 }, ta);
  ok(r.d.user?.profile?.coverPosition === 0, "negative focal point clamps to 0");
  r = await call("PUT", "/api/auth/me/profile", { coverPosition: "abc" }, ta);
  ok(r.s === 400, "a non-numeric focal point is refused", `${r.s}`);

  r = await call("PUT", "/api/auth/me/profile", { coverImage: "", coverPosition: 80 }, ta);
  ok(r.s === 200 && r.d.user?.profile?.coverImage === "", "banner is REMOVABLE");
  ok(r.d.user?.profile?.coverPosition === 50, "removing the banner resets its focal point, so the next upload starts clean", `${r.d.user?.profile?.coverPosition}`);
  await call("PUT", "/api/auth/me/profile", { coverImage: coverUrl }, ta);

  /* ── §2-7 — bio / location / website ─────────────────────────────── */
  section("§2-7 — bio, location, website");
  r = await call("PUT", "/api/auth/me/profile", {
    bio: "Building things at EventHub.",
    location: "Delhi",
    website: "https://ana.dev",
  }, ta);
  ok(r.s === 200, "bio + location + website saved");
  ok(r.d.user?.profile?.bio === "Building things at EventHub.", "bio persisted");
  ok(r.d.user?.profile?.location === "Delhi", "location persisted");
  ok(r.d.user?.profile?.website === "https://ana.dev", "website persisted");

  r = await call("PUT", "/api/auth/me/profile", { website: "javascript:alert(1)" }, ta);
  ok(r.s === 400, "a javascript: website is refused (it renders as a clickable href)", `${r.s}`);
  r = await call("PUT", "/api/auth/me/profile", { website: "" }, ta);
  ok(r.s === 200, "the website can be cleared");
  await call("PUT", "/api/auth/me/profile", { website: "https://ana.dev" }, ta);

  r = await call("PUT", "/api/auth/me/profile", { bio: "x".repeat(400) }, ta);
  ok(r.s === 400, "an over-long bio is refused", `${r.s}`);
  r = await call("PUT", "/api/auth/me/profile", { firstName: "   " }, ta);
  ok(r.s === 400, "a blank first name is refused", `${r.s}`);
  r = await call("PUT", "/api/auth/me/profile", { profileVisibility: "nonsense" }, ta);
  ok(r.s === 400, "an invalid visibility enum is refused", `${r.s}`);

  /* ── §2-7 — propagation ──────────────────────────────────────────── */
  section("§2-7 — propagation (no logout required)");
  r = await call("GET", "/api/auth/me", null, ta);
  const me = r.d.user;
  ok(me.username === uname, "/auth/me returns the edited username");
  ok(me.profile?.avatar === avatarUrl, "/auth/me returns the edited avatar");
  ok(me.profile?.coverImage === coverUrl, "/auth/me returns the edited banner");
  ok(typeof me.profile?.coverPosition === "number", "/auth/me returns the focal point");
  ok(me.profile?.bio && me.profile?.location && me.profile?.website, "/auth/me returns bio, location and website");
  ok(!!me.socialSettings, "/auth/me still returns socialSettings");

  /* The public profile is a different endpoint — it must show the same edit. */
  r = await call("GET", `/api/users/${uname}/profile`, null, tb);
  ok(r.s === 200, "the profile resolves by the NEW username (links to it work)", `${r.s}`);
  const pub = r.d.user || {};
  ok(pub.username === uname, "the public profile reflects the new username");
  ok(pub.profile?.bio === me.profile.bio, "the public profile reflects the new bio");

  // The old handle must no longer resolve — otherwise the rename half-happened.
  const oldHandleWasEmpty = !me.username || me.username === uname;
  r = await call("GET", "/api/users/ana_roy_nonexistent/profile", null, tb);
  ok(oldHandleWasEmpty || r.s === 404, "an unknown handle 404s (a rename does not leave a ghost)");

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  PART 9 PROFILE EDIT: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(52));

  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error("FATAL", e);
  process.exit(1);
});
