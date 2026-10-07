/**
 * GET /api/users/:idOrUsername/achievements — a username must work.
 *
 *   node tests/user-achievements-route.js
 *
 * Found while sweeping the mobile UI: the profile page calls this route with a
 * username, the controller called findById on it, and Mongo threw
 * "Cast to ObjectId failed for value \"ana_roy\"" — a 500 on every profile
 * page, in the browser console and the server log. Every other route in this
 * file already resolves a username or an id; this one did not.
 *
 * Asserted here:
 *   - a username resolves            (the regression that caused the 500)
 *   - an ObjectId still resolves     (the path that already worked)
 *   - an unknown username is a 404, not a 500
 *   - the payload shape the profile page reads is unchanged
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5106";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "achievements-test-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
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

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const fs = require("fs");
  const dataDir = `/var/tmp/mongo-ach-${Date.now()}`;
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
  const A = { email: `ach${stamp}@x.com`, password: "Test1234!" };
  await call("POST", "/api/auth/signup", {
    ...A,
    firstName: "Ana",
    lastName: "Roy",
    confirmPassword: A.password,
    acceptTerms: true,
  });
  // Signup does not hand back a session here, and a fresh account has no
  // username yet — set one, exactly as the edit-profile sheet does.
  await User.updateMany({ email: A.email }, { $set: { emailVerified: true } });
  const login = await call("POST", "/api/auth/login", A);
  const token = login.d?.token;
  ok(Boolean(token), "logged in", `status ${login.s}`);
  const myUsername = `ana_${String(stamp).slice(-6)}`;
  const saved = await call("PUT", "/api/auth/me/profile", { username: myUsername }, token);
  ok(saved.s === 200 && saved.d?.user?.username === myUsername, "username saved (the handle the profile page then requests)");
  const myId = saved.d?.user?._id;
  ok(Boolean(myId), "the save response carries the id the other path uses");

  section("the regression: by username (what the profile page sends)");
  const byName = await call("GET", `/api/users/${myUsername}/achievements`, null, token);
  ok(byName.s === 200, "GET by username → 200, not 500", `status ${byName.s}: ${JSON.stringify(byName.d).slice(0, 140)}`);
  ok(Array.isArray(byName.d?.achievements), "payload still carries an achievements array");
  ok(
    byName.d?.achievements?.length > 0 && byName.d.achievements.every((a) => a.unlocked === false && a.unlockedAt === null),
    "the array is the catalogue, and a fresh account has NOTHING unlocked (no invented badges)"
  );

  section("by id keeps working");
  const byId = await call("GET", `/api/users/${myId}/achievements`, null, token);
  ok(byId.s === 200, "GET by ObjectId → 200", `status ${byId.s}`);
  ok(Array.isArray(byId.d?.achievements), "same payload shape as the username path");

  section("unknown usernames are a 404, not a CastError 500");
  const missing = await call("GET", "/api/users/nobody_at_all_here/achievements", null, token);
  ok(missing.s === 404, "unknown username → 404", `status ${missing.s}`);
  ok(missing.d?.success === false, "404 body keeps the { success:false } shape");

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  await mongoose.disconnect().catch(() => {});
  await mongod.stop().catch(() => {});
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
