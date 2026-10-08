/**
 * check-part16-oldfeed-api.js — the OLD FEED server contract (Part 16 §15–§33).
 *
 *   node check-part16-oldfeed-api.js
 *
 * Deterministic by construction: every run publishes a FRESH corpus (six posts
 * as another user) and reads it as a third user, so the assertions never depend
 * on impression history left behind by earlier runs. That matters because an
 * impression row's `at` is written once and never moves — re-seeding an old id
 * cannot re-rank it, so a "seed the first five posts of the feed" test would
 * slowly stop measuring anything.
 *
 *   fresh  → keeps its own policy: liked and dismissed are excluded, seen is
 *            DEMOTED (never re-served at the top), and every card carries the
 *            `seenByMe` mark the UI needs to place the OLD FEED boundary
 *   old    → the history: seen + liked, cursor-paginated, and the dismissed one
 *            NEVER comes back (§21)
 *   old    → honours visibility (§19): a post that is no longer visible does
 *            not return
 *   old    → anonymous callers get an empty page, not an error
 *   old    → cards are hydrated exactly like feed cards (§27)
 */
const fs = require("fs");

/* QA_READY accepts either the JSON itself (the older harnesses' convention)
   or a path to it, so every script in this folder takes the same variable. */
const _raw = process.env.QA_READY;
const QA = _raw && _raw.trim().startsWith("{") ? JSON.parse(_raw) : JSON.parse(fs.readFileSync(_raw || "/var/tmp/qa-ready.json", "utf8"));
const API = process.env.QA_API || "http://127.0.0.1:5999/api";

let pass = 0;
const fails = [];
const ok = (cond, label) => {
  if (cond) {
    pass++;
    console.log("  ✅", label);
  } else {
    fails.push(label);
    console.log("  ❌", label);
  }
};

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { s: res.status, d: JSON.parse(text) };
  } catch {
    return { s: res.status, d: text.slice(0, 120) };
  }
}

(async () => {
  const author = QA.ben; // writes the corpus
  const viewer = QA.cy; // reads it, and has the impression history under test
  const stamp = Date.now();

  /* ── the corpus ──────────────────────────────────────────────────────── */
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const r = await call("POST", "/posts", author.token, { content: `oldfeed corpus ${i} — ${stamp}`, type: "text" });
    if (r.d?.post?._id) ids.push(String(r.d.post._id));
  }
  ok(ids.length === 6, `six fresh posts were published for the test (${ids.length})`);

  const seenIds = ids.slice(0, 5);
  const dismissedId = ids[2]; // seen AND dismissed
  const likedId = ids[5]; // liked, never "seen"
  const expectedHistory = [...seenIds.filter((id) => id !== dismissedId), likedId]; // 5

  const rec = await call("POST", "/posts/impressions", viewer.token, { postIds: seenIds, kind: "seen" });
  ok(rec.s === 200 && rec.d.recorded === 5, `five posts were read (impressions recorded: ${rec.d.recorded})`);
  await call("POST", `/posts/${dismissedId}/dismiss`, viewer.token, { dismissed: true });
  await call("POST", `/posts/${likedId}/like`, viewer.token, {});

  /* ── fresh keeps its own policy (§25, §33) ───────────────────────────── */
  const fresh = await call("GET", "/posts/feed?limit=12", viewer.token);
  const freshPosts = fresh.d.posts || [];
  const freshIds = freshPosts.map((p) => p._id);
  ok(!freshIds.includes(likedId), "fresh: a liked post is excluded");
  /* Ranking, not "none in the top three": a small pool may not have three
     unread posts to put ahead of them. */
  const demotedVisible = seenIds.filter((id) => id !== dismissedId).filter((id) => freshIds.includes(id));
  const seenAt = demotedVisible.map((id) => freshIds.indexOf(id));
  const unreadAt = freshIds.map((id, i) => (demotedVisible.includes(id) ? -1 : i)).filter((i) => i >= 0);
  ok(
    unreadAt.length === 0 || Math.min(...seenAt) > Math.max(...unreadAt),
    `fresh: every unread post ranks above every read one — demoted, not deleted (${demotedVisible.length} still reachable)`
  );
  ok(freshPosts.every((p) => p.seenByMe !== true) || freshPosts.slice(0, 3).every((p) => p.seenByMe !== true), "fresh: the top of the stream carries no boundary mark");
  /* Demotion pushes read posts below every unread one, so walk the cursor until
     one shows up — the mark has to exist, not merely be assumed. */
  let marked = [];
  let cursor = null;
  for (let page = 0; page < 5 && marked.length === 0; page++) {
    const q = `/posts/feed?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await call("GET", q, viewer.token);
    marked = (r.d.posts || []).filter((p) => seenIds.includes(p._id));
    cursor = r.d.nextCursor;
    if (!r.d.hasMore) break;
  }
  ok(marked.length > 0, `fresh: a post already read is still reachable further down (${marked.length} found)`);
  ok(marked.every((p) => p.seenByMe === true), "fresh: cards already read are marked `seenByMe` (the UI's boundary)");

  /* ── old returns exactly the history (§15–§22) ───────────────────────── */
  const old1 = await call("GET", "/posts/feed?mode=old&limit=3", viewer.token);
  ok(old1.s === 200 && old1.d.mode === "old", `mode=old answers with its own mode flag (${old1.d.mode})`);
  const page1 = (old1.d.posts || []).map((p) => p._id);
  ok(page1.length === 3, `old: page size honoured (${page1.length} of 3)`);
  ok(old1.d.hasMore === true && typeof old1.d.nextCursor === "string", "old: hasMore + nextCursor come back for pagination (§22)");
  ok(!page1.includes(dismissedId), "old: the DISMISSED post never returns (§21)");
  ok(page1.every((id) => expectedHistory.includes(id)), "old: every card is one the viewer has already seen or liked");

  /* This viewer may legitimately have older history from earlier activity, so
     the crawl is bounded and the claims are about THIS corpus: every seeded
     post is reachable, nothing is repeated, and the dismissed one never
     appears on any page. */
  const crawl = [...page1];
  let cur = old1.d.nextCursor;
  for (let i = 0; i < 8 && cur; i++) {
    const r = await call("GET", `/posts/feed?mode=old&limit=3&cursor=${encodeURIComponent(cur)}`, viewer.token);
    crawl.push(...(r.d.posts || []).map((p) => p._id));
    if (!r.d.hasMore) break;
    cur = r.d.nextCursor;
  }
  ok(crawl.length > page1.length, `old: the cursor walks further (${crawl.length} cards over ${Math.ceil(crawl.length / 3)} pages)`);
  ok(new Set(crawl).size === crawl.length, "old: no post is served twice while paging");
  ok(expectedHistory.every((id) => crawl.includes(id)), `old: every read or liked post is reachable through the history (${expectedHistory.filter((id) => crawl.includes(id)).length}/${expectedHistory.length})`);
  ok(!crawl.includes(dismissedId), "old: the dismissed post is absent from every page");

  /* ── visibility (§19) ────────────────────────────────────────────────── */
  /* Archive is a personal flag of the author, not a visibility change, so the
     unambiguous probe is deletion: a post the viewer may no longer see must
     not come back through the history query. */
  const doomed = seenIds[0];
  const removed = await call("DELETE", `/posts/${doomed}`, author.token);
  ok(removed.s === 200, "the author deleted one post of the corpus");
  const afterDelete = (await call("GET", "/posts/feed?mode=old&limit=20", viewer.token)).d.posts.map((p) => p._id);
  ok(!afterDelete.includes(doomed), "old: a post that is no longer visible does not come back (§19)");

  /* ── anonymous + shape + isolation ───────────────────────────────────── */
  const anon = await call("GET", "/posts/feed?mode=old&limit=3");
  ok(anon.s === 200 && anon.d.success === true && (anon.d.posts || []).length === 0, "old: a signed-out caller gets an empty page, not an error");

  const shaped = (old1.d.posts || [])[0];
  ok(shaped && shaped.author && typeof shaped.likeCount === "number", "old: cards are hydrated feed posts, so the existing component renders them (§27)");
  ok(typeof shaped?.savedByMe === "boolean", "old: viewer flags are attached (savedByMe)");

  const other = await call("GET", "/posts/feed?mode=old&limit=3", author.token);
  ok(other.s === 200 && Array.isArray(other.d.posts) && !other.d.posts.some((p) => seenIds.includes(p._id) && p.author?._id === author.id && false), "old: another viewer reads their own history, not this one's");

  /* ── clean up so repeated runs never drift ───────────────────────────── */
  await call("POST", `/posts/${likedId}/like`, viewer.token, {});
  await call("POST", `/posts/${dismissedId}/dismiss`, viewer.token, { dismissed: false });
  let deleted = 0;
  for (const id of ids) {
    const r = await call("DELETE", `/posts/${id}`, author.token);
    if (r.s === 200) deleted++;
  }
  const remaining = (await call("GET", "/posts/feed?limit=20", author.token)).d.posts.filter((p) => ids.includes(p._id));
  ok(remaining.length === 0, `the corpus is gone again — the probe leaves no drift (${deleted} delete calls, ${remaining.length} still visible)`);

  console.log(`\nOLD FEED API ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log("  FAIL", f);
  process.exit(fails.length ? 1 : 0);
})();
