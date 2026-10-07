/**
 * Who can see whose story.
 *
 *   node tests/stories-audience.js
 *
 * Regression cover for a bug found while building the Phase 4 feed: the story
 * rail's audience query read `select("following")` on a model whose field is
 * `followee`. `r.following` was always undefined, so the `$in` matched nobody
 * and a signed-in viewer saw only their own stories — "nobody posted today",
 * which is exactly what a working empty state looks like.
 *
 * The assertions are deliberately about the PAIR: the follower must see it and
 * the stranger must not, because a fix that simply widened the query would pass
 * a one-sided test while leaking private-account stories.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5114";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "stories-audience-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.RATE_LIMIT_DISABLED = "1";

const http = require("http");
const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join("/var/tmp", `stories-audience-${Date.now()}`);
process.env.UPLOADS_DIR = UPLOADS_DIR;

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

function call(method, path_, body, token) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { accept: "application/json" };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ host: "127.0.0.1", port: process.env.PORT, path: path_, method, headers }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve({ s: res.statusCode, d: JSON.parse(d) });
        } catch {
          resolve({ s: res.statusCode, d: String(d).slice(0, 120) });
        }
      });
    });
    req.on("error", (e) => resolve({ s: 0, d: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const authorsOf = (res) => (res.d?.groups || []).map((g) => String(g.author?._id));

/** A real 1x1 PNG, written into the QA uploads dir the server actually serves. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64"
);

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dir = path.join("/var/tmp", `mongo-stories-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");
  for (let i = 0; i < 60; i++) {
    if ((await call("GET", "/api/health")).s === 200) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  const User = require("../models/user.model");
  const stamp = Date.now();
  for (const [tag, first] of [["ann", "Ann"], ["bob", "Bob"], ["cat", "Cat"], ["dan", "Dan"]]) {
    await call("POST", "/api/auth/signup", {
      email: `${tag}${stamp}@x.com`,
      password: "Test1234!",
      firstName: first,
      lastName: "Tester",
      confirmPassword: "Test1234!",
      acceptTerms: true,
    });
  }
  await User.updateMany({}, { $set: { emailVerified: true } });
  const login = async (tag) => {
    const r = await call("POST", "/api/auth/login", { email: `${tag}${stamp}@x.com`, password: "Test1234!" });
    return { token: r.d?.token, id: r.d?.user?._id };
  };
  const ann = await login("ann");
  const bob = await login("bob");
  const cat = await login("cat");
  const dan = await login("dan");
  ok(Boolean(ann.token && bob.token && cat.token && dan.token), "four accounts");

  fs.mkdirSync(path.join(UPLOADS_DIR, "stories"), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, "stories", "t.png"), PNG_1PX);
  const storyUrl = `http://127.0.0.1:${process.env.PORT}/uploads/stories/t.png`;
  const postStory = (who, caption) =>
    call("POST", "/api/stories", { media: { url: storyUrl, type: "image", width: 400, height: 640 }, caption }, who.token);

  const bobStory = await postStory(bob, "bob's build night");
  ok(bobStory.s === 201 || Boolean(bobStory.d?.story?._id), "bob posts a story", `status ${bobStory.s}`);

  console.log("\n── the follower sees the stories of the people they follow ──");
  let bobFeed = await call("GET", "/api/stories", null, bob.token);
  ok(authorsOf(bobFeed).includes(String(bob.id)), "bob sees his own story");

  let annFeed = await call("GET", "/api/stories", null, ann.token);
  ok(!authorsOf(annFeed).includes(String(bob.id)), "ann does NOT see it before following him");

  await call("POST", `/api/follow/${bob.id}`, {}, ann.token);
  annFeed = await call("GET", "/api/stories", null, ann.token);
  ok(
    authorsOf(annFeed).includes(String(bob.id)),
    "…and DOES see it once she follows him (this is what was broken: the query read a field that does not exist)",
    JSON.stringify(authorsOf(annFeed))
  );

  console.log("\n── a follow request is not a relationship ──");
  /* Cat has a private profile, so ann's follow becomes a request. */
  await User.updateOne({ _id: cat.id }, { $set: { "socialSettings.profileVisibility": "private" } });
  await postStory(cat, "cat's private story");
  await call("POST", `/api/follow/${cat.id}`, {}, ann.token);
  const annAfterPending = await call("GET", "/api/stories", null, ann.token);
  ok(
    !authorsOf(annAfterPending).includes(String(cat.id)),
    "a PENDING follow does not reveal a private account's stories",
    JSON.stringify(authorsOf(annAfterPending))
  );

  console.log("\n── a stranger sees nothing ──");
  const danFeed = await call("GET", "/api/stories", null, dan.token);
  ok(!authorsOf(danFeed).includes(String(bob.id)), "dan (follows nobody) sees no one else's story");
  ok(!authorsOf(danFeed).includes(String(cat.id)), "…and not the private one either");

  console.log("\n── other surfaces agree ──");
  const annArchive = await call("GET", "/api/stories/archive", null, ann.token);
  ok(annArchive.s === 200, "the archive endpoint still answers for the viewer");
  const bobOwn = await call("GET", `/api/stories/users/${bob.id}`, null, ann.token);
  ok(bobOwn.s === 200, "a followed author's stories are fetchable by id");

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  const mongoose = require("mongoose");
  await mongoose.disconnect().catch(() => {});
  await mongod.stop().catch(() => {});
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
