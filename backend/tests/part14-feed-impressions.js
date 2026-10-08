/**
 * PART 14 — the feed's "do not show me that again" contract (§23–§25).
 *
 *   node tests/part14-feed-impressions.js
 *
 * §23 is explicit that liked / seen / dismissed must not depend on frontend
 * state: it has to survive a refresh, a new session and a different device.
 * That makes it a server contract, and these are the assertions that decide
 * whether it actually holds:
 *
 *  1. A LIKED post never appears in the feed again — for any caller, because
 *     the exclusion is derived from the reaction row, not from a client hint.
 *  2. An explicitly DISMISSED post never appears again, and dismissing again is
 *     idempotent (a retried request must not corrupt anything).
 *  3. A SEEN post is demoted, not deleted: it stays out of the way of unseen
 *     content, but the feed still returns it when there is nothing unseen left
 *     (§23 "unnecessarily", §25 "do not return partially empty pages").
 *  4. A batch of impressions is ONE write: 40 ids in one request, 40 rows, and
 *     repeating it does not double the collection.
 *  5. Impressions are private to the viewer who recorded them.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5119";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "part14-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.RATE_LIMIT_DISABLED = "1";
process.env.UPLOADS_DIR = require("path").join("/var/tmp", `part14-${Date.now()}`);

const http = require("http");
const fs = require("fs");
const path = require("path");

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
    const req = http.request(
      { host: "127.0.0.1", port: process.env.PORT, path: path_, method, headers },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve({ s: res.statusCode, d: JSON.parse(d) });
          } catch {
            resolve({ s: res.statusCode, d: String(d).slice(0, 160) });
          }
        });
      }
    );
    req.on("error", (e) => resolve({ s: 0, d: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Every post id the viewer's feed returns, walking the cursor to the end. */
async function feedIds(token, { tab = "for-you", limit = 20, maxPages = 8 } = {}) {
  const seen = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const p = new URLSearchParams({ tab, limit: String(limit) });
    if (cursor) p.set("cursor", cursor);
    const r = await call("GET", `/api/posts/feed?${p}`, null, token);
    for (const post of r.d?.posts || []) seen.push(String(post._id));
    if (!r.d?.hasMore || !r.d?.nextCursor) break;
    cursor = r.d.nextCursor;
  }
  return seen;
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dir = path.join("/var/tmp", `mongo-part14-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");
  for (let i = 0; i < 60; i++) {
    if ((await call("GET", "/api/health")).s === 200) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  const User = require("../models/user.model");
  const PostImpression = require("../models/post-impression.model");

  const stamp = Date.now();
  for (const [tag, first] of [["mel", "Mel"], ["nik", "Nik"], ["zoe", "Zoe"]]) {
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
  const mel = await login("mel");
  const nik = await login("nik");
  const zoe = await login("zoe");
  ok(Boolean(mel.token && nik.token && zoe.token), "three accounts");

  /* nik writes the corpus the feed will be measured against. */
  const made = [];
  for (let i = 0; i < 6; i++) {
    const r = await call("POST", "/api/posts", { content: `impression corpus ${i} — ${stamp}`, type: "text" }, nik.token);
    if (r.d?.post?._id) made.push(String(r.d.post._id));
  }
  ok(made.length === 6, "six posts exist in the corpus", `made=${made.length}`);

  const baseline = await feedIds(mel.token);
  ok(made.every((id) => baseline.includes(id)), "a fresh viewer sees all of them");

  /* ── 1 · liked posts never come back ──────────────────────────────── */
  const likedId = made[0];
  await call("POST", `/api/posts/${likedId}/like`, {}, mel.token);
  const afterLike = await feedIds(mel.token);
  ok(!afterLike.includes(likedId), "a LIKED post leaves the feed");
  ok(afterLike.length >= made.length - 1, "…without emptying the page", `returned ${afterLike.length}`);
  /* The exclusion is derived from the reaction row, so un-liking must restore
     it — otherwise a mis-tap would be permanent. */
  await call("POST", `/api/posts/${likedId}/like`, {}, mel.token);
  const afterUnlike = await feedIds(mel.token);
  ok(afterUnlike.includes(likedId), "un-liking puts it back (the exclusion is the reaction, not a copy)");

  /* ── 2 · dismissed posts never come back ──────────────────────────── */
  const dismissedId = made[1];
  const dis = await call("POST", `/api/posts/${dismissedId}/dismiss`, { dismissed: true }, mel.token);
  ok(dis.s === 200 && dis.d?.dismissed === true, "a post can be dismissed", `status ${dis.s}`);
  const dis2 = await call("POST", `/api/posts/${dismissedId}/dismiss`, { dismissed: true }, mel.token);
  ok(dis2.s === 200, "dismissing twice is idempotent");
  const rows = await PostImpression.countDocuments({ user: mel.id, post: dismissedId, kind: "dismissed" });
  ok(rows === 1, "…and there is exactly one row for it", `rows=${rows}`);
  const afterDismiss = await feedIds(mel.token);
  ok(!afterDismiss.includes(dismissedId), "a DISMISSED post leaves the feed");
  ok(!afterDismiss.includes(likedId) === false, "…and the liked one is still there while liked");

  /* ── 3 · seen is a demotion, not a deletion ───────────────────────── */
  /* Mel has 6 posts. Mark five seen; the sixth must come first. */
  const seenBatch = made.filter((id) => id !== made[5]);
  const imp = await call("POST", "/api/posts/impressions", { postIds: seenBatch }, mel.token);
  ok(imp.s === 200 && imp.d?.recorded === 5, "five impressions recorded in ONE request", JSON.stringify(imp.d));
  ok(
    (await PostImpression.countDocuments({ user: mel.id, kind: "seen" })) === 5,
    "…as five rows, not one request each"
  );

  const ordered = await feedIds(mel.token, { limit: 20 });
  const unseenIndex = ordered.indexOf(made[5]);
  const seenIndexes = seenBatch.map((id) => ordered.indexOf(id)).filter((i) => i >= 0);
  ok(unseenIndex >= 0, "the unseen post is still in the feed at all");
  ok(
    unseenIndex < Math.min(...seenIndexes),
    "an UNSEEN post outranks one already seen",
    `unseen@${unseenIndex} vs seen@${Math.min(...seenIndexes)}`
  );
  ok(seenIndexes.length > 0, "…and the seen posts are still returned (never a short page)");

  /* §24 — repeating the same batch must not grow the collection. */
  await call("POST", "/api/posts/impressions", { postIds: seenBatch }, mel.token);
  const seenRows = await PostImpression.countDocuments({ user: mel.id, kind: "seen" });
  ok(seenRows === 5, "a repeated batch does not duplicate rows", `rows=${seenRows}`);
  const bumped = await PostImpression.findOne({ user: mel.id, post: seenBatch[0], kind: "seen" }).lean();
  ok(bumped.count === 2, "…it increments the count instead", `count=${bumped.count}`);

  /* ── 4 · batching, capping, and hostile input ─────────────────────── */
  const many = await call(
    "POST",
    "/api/posts/impressions",
    { postIds: Array.from({ length: 200 }, () => made[5]) },
    mel.token
  );
  ok(many.s === 200 && many.d.recorded <= 60, "a huge batch is capped, not trusted", JSON.stringify(many.d));
  const junk = await call("POST", "/api/posts/impressions", { postIds: ["not-an-id", null, 42, made[2]] }, mel.token);
  ok(junk.s === 200, "malformed ids do not error the batch", `status ${junk.s}`);
  const junkRows = await PostImpression.countDocuments({ user: mel.id, post: made[2], kind: "seen" });
  ok(junkRows === 1, "…and the valid id in the same batch is still recorded");
  const empty = await call("POST", "/api/posts/impressions", { postIds: [] }, mel.token);
  ok(empty.s === 200 && empty.d.recorded === 0, "an empty batch is a no-op, not a 400");
  const anon = await call("POST", "/api/posts/impressions", { postIds: made }, null);
  ok(anon.s === 401 || anon.s === 403, "impressions require a session", `status ${anon.s}`);

  /* ── 5 · private to the viewer who recorded them ──────────────────── */
  const zoeFeed = await feedIds(zoe.token);
  ok(zoeFeed.includes(dismissedId), "another viewer still sees what Mel dismissed");
  ok(zoeFeed.includes(made[2]), "…and what Mel has merely seen");

  /* ── 6 · the trending endpoint (§3/§5) is real content, ranked ────── */
  await call("POST", `/api/posts/${made[3]}/like`, {}, nik.token);
  await call("POST", `/api/posts/${made[3]}/like`, {}, zoe.token);
  await call("POST", `/api/posts/${made[4]}/comments`, { content: "nice" }, nik.token);
  const trending = await call("GET", "/api/posts/trending?limit=10", null, mel.token);
  ok(trending.s === 200, "trending posts endpoint answers", `status ${trending.s}`);
  const tp = trending.d?.posts || [];
  ok(tp.length > 0, "…with real posts", `count=${tp.length}`);
  ok(
    tp.every((p) => p.author && p._id && typeof p.likeCount === "number"),
    "…shaped exactly like a feed post, so the existing post component renders it"
  );
  const top = tp.findIndex((p) => String(p._id) === made[3]);
  const low = tp.findIndex((p) => String(p._id) === made[0]);
  ok(top !== -1 && (low === -1 || top < low), "engagement actually orders it", `liked@${top} vs idle@${low}`);
  const hidden = await call("GET", "/api/posts/trending", null, null);
  ok(hidden.s === 200 && (hidden.d?.posts || []).every((p) => p.visibility === "public" || p.visibility === undefined),
    "a signed-out caller only sees public posts");

  console.log(`\n${passed} passed, ${failed} failed`);
  await mongooseDisconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});

async function mongooseDisconnect() {
  try {
    await require("mongoose").disconnect();
  } catch {}
}
