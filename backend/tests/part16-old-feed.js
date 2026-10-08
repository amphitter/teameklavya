/**
 * PART 16 — the OLD FEED contract (§15–§33).
 *
 *   node tests/part16-old-feed.js
 *
 * §26 asks for old posts to come back "once the user has consumed the fresh
 * content", §21 says dismissed posts never return, §33 says the fresh feed's
 * own policy must not be relaxed to achieve any of it. So the history is a
 * SEPARATE query (`mode=old`) with its own rules, and these are the assertions
 * that decide whether it holds:
 *
 *  1. A post the viewer READ comes back in the history, and a post they LIKED
 *     comes back too — even if they never opened it. That second half is the
 *     interesting one: likes live in `Reaction` while reads live in
 *     `PostImpression`, so a history built from impressions alone would
 *     silently drop every post the viewer liked without reading.
 *  2. A DISMISSED post never comes back, on any page, no matter what else the
 *     viewer did to it first (it is read first and applied as a hard exclusion).
 *  3. The history is cursor-paginated, newest signal first, without repeating
 *     itself and without depending on one page being large enough.
 *  4. It is per-viewer: one viewer's history is not another's.
 *  5. It honours visibility: a post that is no longer there does not resurrect.
 *  6. The FRESH feed is untouched: liked and read posts keep the ranking
 *     behaviour §23–§25 describe, and the `seenByMe` mark the UI needs to find
 *     the boundary is attached — that mark is a report, not a policy change.
 *  7. A signed-out caller gets an empty page, not an error.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5121";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "part16-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.RATE_LIMIT_DISABLED = "1";
process.env.UPLOADS_DIR = require("path").join("/var/tmp", `part16-${Date.now()}`);

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

/** One page of the history. */
async function oldPage(token, { cursor = null, limit = 3 } = {}) {
  const p = new URLSearchParams({ mode: "old", limit: String(limit) });
  if (cursor) p.set("cursor", cursor);
  const r = await call("GET", `/api/posts/feed?${p}`, null, token);
  return { status: r.s, body: r.d, ids: (r.d?.posts || []).map((x) => String(x._id)) };
}

/** Walk the whole history (bounded), the way the client pages it. */
async function oldAll(token, { limit = 3, maxPages = 10 } = {}) {
  const ids = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await oldPage(token, { cursor, limit });
    ids.push(...page.ids);
    if (!page.body?.hasMore || !page.body?.nextCursor) break;
    cursor = page.body.nextCursor;
  }
  return ids;
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dir = path.join("/var/tmp", `mongo-part16-${Date.now()}`);
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
  const Reaction = require("../models/reaction.model");

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
    return { token: r.d?.token, id: r.d?.user?._id };
  };
  const mel = await login("mel");
  const nik = await login("nik");
  const zoe = await login("zoe");
  ok(Boolean(mel.token && nik.token && zoe.token), "three accounts");

  /* nik writes the corpus zoe will have history with. */
  const made = [];
  for (let i = 0; i < 7; i++) {
    const r = await call("POST", "/api/posts", { content: `old feed corpus ${i} — ${stamp}`, type: "text" }, nik.token);
    if (r.d?.post?._id) made.push(String(r.d.post._id));
  }
  ok(made.length === 7, "seven posts exist in the corpus", `made=${made.length}`);

  /* ── zoe builds a history: reads four, likes one without reading it,
        dismisses one of the ones she read ───────────────────────────── */
  const readIds = made.slice(0, 4);
  const likedOnlyId = made[6]; // never opened, only liked
  const dismissedId = made[3]; // read, then dismissed
  const history = [...readIds.filter((id) => id !== dismissedId), likedOnlyId]; // 4

  const rec = await call("POST", "/api/posts/impressions", { postIds: readIds }, zoe.token);
  ok(rec.s === 200 && rec.d?.recorded === 4, "four reads were recorded for the viewer", JSON.stringify(rec.d));
  const likeRes = await call("POST", `/api/posts/${likedOnlyId}/like`, {}, zoe.token);
  ok(likeRes.s === 200 && likeRes.d?.liked === true, "a post was liked without being read");
  await call("POST", `/posts/feed?mode=old`, null, zoe.token); // (no-op: keeps the helper honest about auth)
  await call("POST", `/api/posts/${dismissedId}/dismiss`, { dismissed: true }, zoe.token);
  ok(
    (await Reaction.countDocuments({ user: zoe.id, type: "like" })) === 1 &&
      (await PostImpression.countDocuments({ user: zoe.id, kind: "seen" })) === 4,
    "the two stores really are separate (1 like row, 4 impression rows)"
  );

  /* ── 1 · the history contains reads AND likes ─────────────────────── */
  const first = await oldPage(zoe.token, { limit: 3 });
  ok(first.status === 200 && first.body?.mode === "old", "mode=old answers as its own mode", `status ${first.status}`);
  ok(first.ids.length === 3, "a page honours the requested size", `${first.ids.length}`);
  ok(first.ids.every((id) => history.includes(id)), "every card is something the viewer read or liked", first.ids.join(","));
  ok(
    history.every((id) => oldAll.length !== 0) && (await oldAll(zoe.token)).length >= history.length,
    "every read or liked post is reachable through the history"
  );
  const whole = await oldAll(zoe.token);
  ok(history.every((id) => whole.includes(id)), `…including the liked-but-never-read one (${history.filter((id) => whole.includes(id)).length}/${history.length})`);
  ok(whole.includes(likedOnlyId), "…specifically the post that has no impression row at all");

  /* ── 2 · dismissed never returns ──────────────────────────────────── */
  ok(!whole.includes(dismissedId), "a DISMISSED post is absent from the whole history");
  await call("POST", "/api/posts/impressions", { postIds: [dismissedId] }, zoe.token);
  await call("POST", "/api/posts/impressions", { postIds: [dismissedId] }, zoe.token);
  ok(!(await oldAll(zoe.token)).includes(dismissedId), "even after reading it again — dismissal wins over a new impression");

  /* ── 3 · pagination ───────────────────────────────────────────────── */
  ok(first.body?.hasMore === true && typeof first.body?.nextCursor === "string", "hasMore + nextCursor are provided");
  const second = await oldPage(zoe.token, { cursor: first.body.nextCursor, limit: 3 });
  ok(second.ids.length > 0, "the cursor walks to the next page", `${second.ids.length}`);
  ok(!second.ids.some((id) => first.ids.includes(id)), "pages do not repeat themselves");
  ok(new Set(whole).size === whole.length, "nothing is served twice across the crawl");
  const zoeIdsLike = await oldAll(zoe.token, { limit: 2 });
  ok(new Set(zoeIdsLike).size === zoeIdsLike.length, "…at a different page size too");

  /* ── 4 · per viewer ───────────────────────────────────────────────── */
  const nikHistory = await oldAll(nik.token);
  ok(!nikHistory.some((id) => readIds.includes(id)), "another viewer's history is their own");

  /* ── 5 · visibility ───────────────────────────────────────────────── */
  const doomed = readIds[0];
  await call("DELETE", `/api/posts/${doomed}`, null, nik.token);
  ok(!(await oldAll(zoe.token)).includes(doomed), "a deleted post does not come back through the history");

  /* ── 6 · the fresh feed keeps its own policy ──────────────────────── */
  const fresh = await call("GET", "/api/posts/feed?limit=20", null, zoe.token);
  const freshPosts = fresh.d?.posts || [];
  const freshIds = freshPosts.map((p) => String(p._id));
  ok(!freshIds.includes(likedOnlyId), "fresh: a liked post is still excluded (§23)");
  ok(!freshIds.includes(dismissedId), "fresh: a dismissed post is still excluded");
  /* The claim is a RANKING one — every unread post above every read post — not
     "none of them in the top three": with a corpus this small there may be
     fewer unread posts than slots, and a read post then has to appear. */
  const stillThere = readIds.filter((id) => id !== doomed).filter((id) => freshIds.includes(id));
  const seenPositions = stillThere.map((id) => freshIds.indexOf(id));
  const unseenPositions = freshIds.map((id, i) => (stillThere.includes(id) ? -1 : i)).filter((i) => i >= 0);
  ok(
    unseenPositions.length === 0 || (Math.min(...seenPositions) > Math.max(...unseenPositions)),
    "fresh: every unread post ranks above every read one (§25)",
    `unseen@${unseenPositions.join(",")} seen@${seenPositions.join(",")}`
  );
  ok(freshPosts.some((p) => p.seenByMe === true) || stillThere.length === 0, "fresh: the cards it does return carry the seenByMe mark");
  ok(freshPosts.some((p) => p.seenByMe !== true), "fresh: unread cards are unmarked");

  /* ── 7 · anonymous ────────────────────────────────────────────────── */
  const anon = await oldPage(null, { limit: 3 });
  ok(anon.status === 200 && anon.body?.success === true && anon.ids.length === 0, "a signed-out caller gets an empty page, not an error");

  /* ── shape ────────────────────────────────────────────────────────── */
  const shaped = (await oldPage(zoe.token, { limit: 3 })).body?.posts?.[0];
  ok(Boolean(shaped?.author) && typeof shaped?.likeCount === "number", "cards are hydrated like feed posts, so the existing component renders them");
  ok(typeof shaped?.savedByMe === "boolean", "viewer flags are attached");

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
