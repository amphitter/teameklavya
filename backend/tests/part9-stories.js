/**
 * PART 9 — the story creator's server contract (§14–§25).
 *
 *   node tests/part9-stories.js
 *
 * The editor is only as good as what the server keeps. These assertions cover
 * the four things that decide whether a composed story survives the round trip:
 *
 *  1. LAYERS persist exactly — geometry, style and the sticker's real payload —
 *     because every client re-renders the story from that metadata.
 *  2. The validator REJECTS what could abuse the field: unknown types, an
 *     oversized payload, coordinates outside the canvas, a javascript: colour.
 *  3. A story is visible to followers and NOT to strangers or before a pending
 *     follow is accepted (the audience rules the rail depends on).
 *  4. `expiresAt` is 24h, and an expired story leaves the active rail and lands
 *     in the author's archive with its layers intact.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5118";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "part9-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.RATE_LIMIT_DISABLED = "1";

const http = require("http");
const fs = require("fs");
const path = require("path");

process.env.UPLOADS_DIR = path.join("/var/tmp", `part9-${Date.now()}`);

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
          resolve({ s: res.statusCode, d: String(d).slice(0, 160) });
        }
      });
    });
    req.on("error", (e) => resolve({ s: 0, d: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64"
);

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dir = path.join("/var/tmp", `mongo-part9-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");
  for (let i = 0; i < 60; i++) {
    if ((await call("GET", "/api/health")).s === 200) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  const User = require("../models/user.model");
  const Story = require("../models/story.model");

  const stamp = Date.now();
  for (const [tag, first] of [["ann", "Ann"], ["bob", "Bob"], ["cat", "Cat"]]) {
    await call("POST", "/api/auth/signup", {
      email: `${tag}${stamp}@x.com`,
      password: "Test1234!",
      firstName: first,
      lastName: "Tester",
      username: `${tag}${stamp}`.slice(0, 20),
      confirmPassword: "Test1234!",
      acceptTerms: true,
    });
  }
  await User.updateMany({}, { $set: { emailVerified: true } });
  const login = async (tag) => {
    const r = await call("POST", "/api/auth/login", { email: `${tag}${stamp}@x.com`, password: "Test1234!" });
    return { token: r.d?.token, id: r.d?.user?._id, username: r.d?.user?.username };
  };
  const ann = await login("ann");
  const bob = await login("bob");
  const cat = await login("cat");
  ok(Boolean(ann.token && bob.token && cat.token), "three accounts");

  const uploads = path.join(process.env.UPLOADS_DIR, "stories");
  fs.mkdirSync(uploads, { recursive: true });
  fs.writeFileSync(path.join(uploads, "s.png"), PNG_1PX);
  const mediaUrl = `http://127.0.0.1:${process.env.PORT}/uploads/stories/s.png`;

  /* ── 1 · layers round-trip ─────────────────────────────────────────── */
  const layers = [
    { type: "text", x: 0.3, y: 0.2, scale: 1.4, rotation: -12, text: "Hack night", color: "#ff3b5c", size: 0.09, weight: 800, align: "left", background: "rgba(0,0,0,0.55)" },
    { type: "emoji", x: 0.8, y: 0.75, scale: 2, rotation: 20, emoji: "🔥", size: 0.2 },
    { type: "sticker", x: 0.5, y: 0.6, scale: 1, rotation: 0, kind: "mention", label: `@${bob.username}`, payload: { username: bob.username, userId: bob.id } },
    { type: "sticker", x: 0.4, y: 0.85, scale: 1, rotation: 5, kind: "hashtag", label: "#hackathon", payload: { topic: "hackathon" } },
    { type: "sticker", x: 0.6, y: 0.1, scale: 1, rotation: 0, kind: "location", label: "Bengaluru", payload: {} },
    { type: "draw", x: 0, y: 0, scale: 1, rotation: 0, strokes: [
      { mode: "pen", color: "#ffffff", width: 0.012, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.25 }, { x: 0.35, y: 0.3 }] },
      { mode: "highlighter", color: "#ffb300", width: 0.03, points: [{ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.55 }] },
    ] },
  ];

  const created = await call("POST", "/api/stories", {
    media: { url: mediaUrl, type: "image", width: 1080, height: 1920 },
    caption: "composed in the editor",
    category: "hackathon",
    layers,
    mentions: [bob.id],
  }, ann.token);
  ok(created.s === 201 || created.s === 200, "a story with layers is created", `status ${created.s}`);
  const storyId = created.d?.story?._id;
  ok(Boolean(storyId), "the story id comes back");

  const raw = await Story.findById(storyId).lean();
  ok(raw.layers.length === 6, "all six layers are stored", `stored=${raw.layers.length}`);
  ok(raw.layers[0].text === "Hack night", "text content survives");
  ok(Math.abs(raw.layers[0].rotation - -12) < 0.001, "rotation survives");
  ok(Math.abs(raw.layers[1].emoji === "🔥" ? 0 : 1) === 0, "emoji survives");
  ok(raw.layers[2].kind === "mention" && raw.layers[2].payload.username === bob.username, "the mention sticker keeps its REAL user payload");
  ok(raw.layers[2].payload.userId === String(bob.id), "…including the id, so the profile link is real");
  ok(raw.layers[5].strokes.length === 2 && raw.layers[5].strokes[1].mode === "highlighter", "strokes keep their tool (highlighter ≠ pen)");
  ok(raw.layers[5].strokes[0].points.length === 3, "stroke points survive");
  ok(String(raw.mentions[0]) === String(bob.id), "the mention is stored as a structured tag too");
  ok(Math.round((new Date(raw.expiresAt) - new Date(raw.createdAt)) / 3600000) === 24, "the story expires in exactly 24 hours");
  ok(raw.archivedAt === null, "an active story is not archived");

  const fetched = await call("GET", `/api/stories/${storyId}`, null, ann.token);
  ok(Array.isArray(fetched.d?.story?.layers) && fetched.d.story.layers.length === 6, "layers are returned by the API");
  ok(fetched.d.story.categoryIcon === "code", "the category carries a real icon (never initials)", fetched.d?.story?.categoryIcon);

  /* ── 2 · the validator refuses abuse ───────────────────────────────── */
  const nasty = await call("POST", "/api/stories", {
    media: { url: mediaUrl, type: "image" },
    layers: [
      { type: "script", x: 0.5, y: 0.5 },
      { type: "text", x: 999, y: -999, text: "clamped", color: "javascript:alert(1)", size: 99, weight: 1 },
      { type: "text", text: "   " },
      { type: "draw", strokes: [{ points: [{ x: 0.1, y: 0.1 }] }] },
      { type: "sticker", kind: "not-a-kind" },
    ],
  }, ann.token);
  ok(nasty.s === 201, "a payload full of junk still returns 201 (junk is dropped, not fatal)");
  const cleaned = await Story.findById(nasty.d?.story?._id).lean();
  ok(cleaned.layers.length === 1, "only the one salvageable layer is kept", `kept=${cleaned.layers.length}`);
  ok(cleaned.layers[0].x === 1.5 && cleaned.layers[0].y === -0.5, "coordinates are clamped to a sane range", JSON.stringify({ x: cleaned.layers[0].x, y: cleaned.layers[0].y }));
  ok(cleaned.layers[0].color === "#ffffff", "a non-hex colour is replaced", cleaned.layers[0].color);
  ok(cleaned.layers[0].size <= 0.3, "an absurd font size is clamped", String(cleaned.layers[0].size));

  const tooMany = await call("POST", "/api/stories", {
    media: { url: mediaUrl, type: "image" },
    layers: Array.from({ length: 200 }, () => ({ type: "emoji", emoji: "🔥" })),
  }, ann.token);
  const capped = await Story.findById(tooMany.d?.story?._id).lean();
  ok(capped.layers.length === 40, "the layer count is capped at 40", `stored=${capped.layers.length}`);

  const noMedia = await call("POST", "/api/stories", { layers: [{ type: "text", text: "no media" }] }, ann.token);
  ok(noMedia.s === 400, "a story without media is refused (the client renders a background first)", `status ${noMedia.s}`);

  const badUrl = await call("POST", "/api/stories", { media: { url: "javascript:alert(1)" } }, ann.token);
  ok(badUrl.s === 400, "a non-http media URL is refused", `status ${badUrl.s}`);
  const dataUrl = await call("POST", "/api/stories", { media: { url: "data:image/png;base64,AAAA" } }, ann.token);
  ok(dataUrl.s === 400, "a data: media URL is refused", `status ${dataUrl.s}`);
  const protoRelative = await call("POST", "/api/stories", { media: { url: "//evil.example/x.png" } }, ann.token);
  ok(protoRelative.s === 400, "a protocol-relative media URL is refused", `status ${protoRelative.s}`);
  const traversal = await call("POST", "/api/stories", { media: { url: "/uploads/../../etc/passwd" } }, ann.token);
  ok(traversal.s === 400, "a traversing media path is refused", `status ${traversal.s}`);

  /* The local storage provider (no Cloudinary configured) returns
     `/uploads/<folder>/<file>`. Posts store that shape and the frontend proxies
     it to the backend, so a story must accept it too — refusing it meant the
     upload succeeded and publishing failed with "Media must be a valid URL". */
  const relative = await call(
    "POST",
    "/api/stories",
    { media: { url: "/uploads/stories/local-shaped.png", type: "image", width: 1080, height: 1920 } },
    ann.token
  );
  ok(relative.s === 201, "a server-relative upload path is accepted (local storage provider)", `status ${relative.s}`);
  const relativeView = await call("GET", `/api/stories/${relative.d?.story?._id}`, null, ann.token);
  ok(
    relativeView.s === 200 && relativeView.d?.story?.media?.url === "/uploads/stories/local-shaped.png",
    "and it is stored verbatim",
    relativeView.d?.story?.media?.url
  );
  const absolute = await call(
    "POST",
    "/api/stories",
    { media: { url: "https://res.cloudinary.com/demo/image/upload/v1/eventhub/stories/x.png", type: "image" } },
    ann.token
  );
  ok(absolute.s === 201, "an absolute CDN URL still works", `status ${absolute.s}`);

  /* ── 3 · audience ──────────────────────────────────────────────────── */
  const bobFeed = await call("GET", "/api/stories", null, bob.token);
  const seesIt = (bobFeed.d?.groups || []).some((g) => (g.stories || []).some((s) => String(s._id) === String(storyId)));
  ok(!seesIt, "a stranger does NOT see the story before following");

  await call("POST", `/api/follow/${ann.id}`, {}, bob.token);
  const bobFeed2 = await call("GET", "/api/stories", null, bob.token);
  const seesNow = (bobFeed2.d?.groups || []).some((g) => (g.stories || []).some((s) => String(s._id) === String(storyId)));
  ok(seesNow, "a follower DOES see it");
  const bobView = await call("GET", `/api/stories/${storyId}`, null, bob.token);
  ok(bobView.s === 200 && (bobView.d?.story?.layers || []).length === 6, "and receives the layers to render");

  const catFeed = await call("GET", "/api/stories", null, cat.token);
  ok(!(catFeed.d?.groups || []).some((g) => (g.stories || []).some((s) => String(s._id) === String(storyId))), "a non-follower still does not");

  /* ── 4 · expiry → archive ──────────────────────────────────────────── */
  await Story.updateOne({ _id: storyId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const bobFeed3 = await call("GET", "/api/stories", null, bob.token);
  ok(!(bobFeed3.d?.groups || []).some((g) => (g.stories || []).some((s) => String(s._id) === String(storyId))), "an expired story leaves the active rail");

  const archive = await call("GET", "/api/stories/archive", null, ann.token);
  const archived = (archive.d?.groups || []).flatMap((g) => g.stories).find((s) => String(s._id) === String(storyId));
  ok(Boolean(archived), "it appears in the author's archive");
  ok((archived?.layers || []).length === 6, "with its layers intact", `layers=${archived?.layers?.length}`);
  ok(Boolean(archived?.archived), "and is marked as archived");
  const groupLabel = (archive.d?.groups || [])[0]?.label || "";
  ok(/\d{4}/.test(groupLabel), "the archive groups by month and year", groupLabel);

  const catArchive = await call("GET", "/api/stories/archive", null, cat.token);
  ok((catArchive.d?.groups || []).length === 0, "another user's archive is private");

  /* ── 5 · delete ────────────────────────────────────────────────────── */
  const del = await call("DELETE", `/api/stories/${storyId}`, null, ann.token);
  ok(del.s === 200, "the author can delete a story", `status ${del.s}`);
  const afterDelete = await call("GET", "/api/stories/archive", null, ann.token);
  ok(!(afterDelete.d?.groups || []).flatMap((g) => g.stories).some((s) => String(s._id) === String(storyId)), "a deleted story leaves the archive");

  console.log(`\n${passed} passed, ${failed} failed`);
  await mongod.stop();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});
