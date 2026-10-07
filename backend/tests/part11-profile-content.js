/**
 * Phase 3 — the owner's own lists, and the four things that must not be
 * conflated.
 *
 *   node tests/part11-profile-content.js
 *
 * The endpoints existed before this phase; what did not exist was a UI for
 * three of them and any test for any of them. This file covers the contract
 * the profile screen now depends on:
 *
 *   saved    — a private bookmark anyone can place on any post
 *   liked    — a reaction
 *   archived — the AUTHOR's own post, set aside: gone from public feeds and
 *              the public profile, not deleted, restorable
 *   posts    — what the profile and the Posts tab show
 *
 * The assertions that matter most are the negative ones: saving a post must
 * not put it in Liked, archiving must not put it in Saved, a stranger must not
 * be able to read anyone's archive, and an archived post must vanish from the
 * profile (and its stat) while still being restorable.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5112";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "profile-content-secret";
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

const PORT = process.env.PORT;

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
        try {
          resolve({ s: res.statusCode, d: JSON.parse(d) });
        } catch {
          resolve({ s: res.statusCode, d: d.slice(0, 200) });
        }
      });
    });
    req.on("error", (e) => resolve({ s: 0, d: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const ids = (res) => (res.d?.posts || []).map((p) => String(p._id));

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const fs = require("fs");
  const dataDir = `/var/tmp/mongo-pcontent-${Date.now()}`;
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

  /* ── three people: ana (the subject), ben (a visitor), cy (a bystander) ── */
  const stamp = Date.now();
  const mk = (tag, first, last) => ({ email: `${tag}${stamp}@x.com`, password: "Test1234!", first, last });
  const signup = async ([tag, first, last]) => {
    await call("POST", "/api/auth/signup", {
      email: `${tag}${stamp}@x.com`,
      password: "Test1234!",
      firstName: first,
      lastName: last,
      confirmPassword: "Test1234!",
      acceptTerms: true,
    });
  };
  await signup([`ana`, "Ana", "Roy"]);
  await signup([`ben`, "Ben", "Sky"]);
  await signup([`cy`, "Cy", "Dee"]);
  await User.updateMany({}, { $set: { emailVerified: true } });

  const login = async (tag) => {
    const r = await call("POST", "/api/auth/login", { email: `${tag}${stamp}@x.com`, password: "Test1234!" });
    return { token: r.d?.token, id: r.d?.user?._id };
  };
  const ana = await login("ana");
  const ben = await login("ben");
  const cy = await login("cy");
  ok(Boolean(ana.token && ben.token && cy.token), "three accounts signed in");

  const anaHandle = `ana_${String(stamp).slice(-6)}`;
  await call("PUT", "/api/auth/me/profile", { username: anaHandle }, ana.token);

  /* ── content: ana has three posts (one image, one text, one to archive) ── */
  const mkPost = async (content, images, token = ana.token) => {
    const r = await call("POST", "/api/posts", { content, type: images?.length ? "image" : "text", images }, token);
    return r.d?.post?._id || r.d?.post?.id || r.d?._id;
  };
  const imgPost = await mkPost("Robotics finals — we took second place.", ["/uploads/posts/fake-a.jpg"]);
  const textPost = await mkPost("Standup notes for the club go here.", []);
  const toArchive = await mkPost("Old announcement, no longer relevant.", []);
  await mkPost("A second photo post for the media grid.", ["/uploads/posts/fake-b.jpg"]);
  await mkPost("Ben's own post, unrelated.", [], ben.token);
  ok(Boolean(imgPost && textPost && toArchive), "ana has posts to work with");

  /* ══════════════ posts: what the profile shows ══════════════ */
  section("the profile's Posts tab sees published, unarchived posts");
  let posts = await call("GET", `/api/users/${anaHandle}/posts?page=1&limit=12`, null, ana.token);
  ok(posts.s === 200, "GET /users/:handle/posts → 200", `status ${posts.s}`);
  ok(posts.d?.posts?.length === 4, "four published posts", String(posts.d?.posts?.length));
  ok(typeof posts.d?.hasMore === "boolean", "page-based pagination reports hasMore");
  ok(ids(posts).includes(String(imgPost)), "…including the image post");
  ok(
    posts.d?.posts?.every((p) => p.likedByMe !== undefined && p.savedByMe !== undefined),
    "each post carries likedByMe / savedByMe, so the feed component renders correct state"
  );

  /* ══════════════ archive ══════════════ */
  section("archiving takes a post out of public view without deleting it");
  const arch = await call("POST", `/api/posts/${toArchive}/archive`, {}, ana.token);
  ok(arch.s === 200 && arch.d?.archived === true, "the author can archive their own post");

  posts = await call("GET", `/api/users/${anaHandle}/posts?page=1&limit=12`, null, ana.token);
  ok(!ids(posts).includes(String(toArchive)), "…and it leaves the profile's Posts list (for the author too)");
  ok(ids(posts).length === 3, "three posts remain", String(ids(posts).length));

  const asVisitor = await call("GET", `/api/users/${anaHandle}/posts?page=1&limit=12`, null, ben.token);
  ok(!ids(asVisitor).includes(String(toArchive)), "…and for a visitor");

  const single = await call("GET", `/api/posts/${toArchive}`, null, ben.token);
  ok(single.s === 404 || single.s === 403, "a visitor cannot open the archived post directly", `status ${single.s}`);

  const ownSingle = await call("GET", `/api/posts/${toArchive}`, null, ana.token);
  ok(ownSingle.s === 200, "the author can still open their own archived post", `status ${ownSingle.s}`);

  const archiveList = await call("GET", "/api/posts/archived", null, ana.token);
  ok(archiveList.s === 200 && ids(archiveList).includes(String(toArchive)), "it appears in the author's Archive");
  ok(ids(archiveList).length === 1, "…and nothing else does", String(ids(archiveList).length));

  const benArchive = await call("GET", "/api/posts/archived", null, ben.token);
  ok(benArchive.s === 200 && ids(benArchive).length === 0, "another user's archive is empty — the list is viewer-scoped");

  const benArchiveAna = await call("POST", `/api/posts/${imgPost}/archive`, {}, ben.token);
  ok(benArchiveAna.s === 403, "a stranger cannot archive someone else's post", `status ${benArchiveAna.s}`);

  /* ══════════════ the stats must agree with the lists ══════════════ */
  section("the Posts stat counts what the Posts tab shows");
  const ownProfile = await call("GET", `/api/users/${anaHandle}/profile`, null, ana.token);
  ok(ownProfile.s === 200, "the profile loads");
  ok(
    ownProfile.d?.stats?.posts === 3,
    "stats.posts excludes the archived post, so header and tab agree",
    `stats.posts=${ownProfile.d?.stats?.posts}, tab shows ${ids(posts).length}`
  );
  ok(ownProfile.d?.stats?.archivedPosts === 1, "the owner is told how many they have archived");
  const seenByBen = await call("GET", `/api/users/${anaHandle}/profile`, null, ben.token);
  ok(seenByBen.d?.stats?.posts === 3, "a visitor sees the same count");
  ok(seenByBen.d?.stats?.archivedPosts === undefined, "…and is not told about anyone's archive");

  /* ══════════════ save ≠ like ≠ archive ══════════════ */
  section("saved, liked and archived are three different things");
  const saveRes = await call("POST", `/api/posts/${imgPost}/save`, {}, ana.token);
  ok(saveRes.s === 200 && saveRes.d?.saved === true, "ana saves a post");

  let saved = await call("GET", "/api/posts/saved", null, ana.token);
  ok(ids(saved).includes(String(imgPost)), "…it appears in Saved");
  ok(!ids(saved).includes(String(toArchive)), "…and the archived post is NOT in Saved", JSON.stringify(ids(saved)));
  const likedAfterSave = await call("GET", "/api/posts/liked", null, ana.token);
  ok(!ids(likedAfterSave).includes(String(imgPost)), "…and saving did NOT like it", JSON.stringify(ids(likedAfterSave)));

  const likeRes = await call("POST", `/api/posts/${textPost}/like`, {}, ana.token);
  ok(likeRes.s === 200 && likeRes.d?.liked === true, "ana likes a different post");
  const liked = await call("GET", "/api/posts/liked", null, ana.token);
  ok(ids(liked).includes(String(textPost)), "…it appears in Liked");
  ok(!ids(liked).includes(String(imgPost)), "…and the saved post is NOT in Liked (a save is not a reaction)");
  saved = await call("GET", "/api/posts/saved", null, ana.token);
  ok(!ids(saved).includes(String(textPost)), "…and the liked post is NOT in Saved");
  ok(!ids(saved).includes(String(toArchive)), "…and the archived post is in neither");

  const benSaved = await call("GET", "/api/posts/saved", null, ben.token);
  ok(benSaved.s === 200 && ids(benSaved).length === 0, "ben's Saved is his own — ana's bookmark is invisible to him");
  const benLiked = await call("GET", "/api/posts/liked", null, ben.token);
  ok(ids(benLiked).length === 0, "…and so is her Liked list");

  section("anon cannot read any of the three");
  for (const [label, path] of [
    ["saved", "/api/posts/saved"],
    ["liked", "/api/posts/liked"],
    ["archived", "/api/posts/archived"],
  ]) {
    const anon = await call("GET", path, null, null);
    ok(anon.s === 401, `${label} requires a session`, `status ${anon.s}`);
  }

  /* ══════════════ restore ══════════════ */
  section("archiving is reversible, and restoring puts it back");
  const unarch = await call("POST", `/api/posts/${toArchive}/archive`, {}, ana.token);
  ok(unarch.s === 200 && unarch.d?.archived === false, "the author can restore it");
  posts = await call("GET", `/api/users/${anaHandle}/posts?page=1&limit=12`, null, ana.token);
  ok(ids(posts).includes(String(toArchive)), "…and it is back on the profile");
  const archiveAfter = await call("GET", "/api/posts/archived", null, ana.token);
  ok(ids(archiveAfter).length === 0, "…and gone from the Archive");
  const profileAfter = await call("GET", `/api/users/${anaHandle}/profile`, null, ana.token);
  ok(profileAfter.d?.stats?.posts === 4, "…and the Posts stat counts it again");
  const feed = await call("GET", "/api/posts/feed?limit=20", null, ben.token);
  ok(
    (feed.d?.posts || []).some((p) => String(p._id) === String(toArchive)),
    "…and it is visible in the feed again"
  );

  /* ══════════════ what archiving does to someone else's copy ══════════════ */
  section("archiving reaches the people who saved it (a bookmark is not a copy)");
  await call("POST", `/api/posts/${imgPost}/save`, {}, ben.token);
  const benSavedBefore = await call("GET", "/api/posts/saved", null, ben.token);
  ok(ids(benSavedBefore).includes(String(imgPost)), "ben saves ana's post and sees it in his Saved");
  await call("POST", `/api/posts/${imgPost}/archive`, {}, ana.token);
  const benSavedDuring = await call("GET", "/api/posts/saved", null, ben.token);
  ok(
    !ids(benSavedDuring).includes(String(imgPost)),
    "…and when ana archives it, it leaves ben's Saved — archiving is not 'hide it from the profile only'"
  );
  const benPermalink = await call("GET", `/api/posts/${imgPost}`, null, ben.token);
  ok(benPermalink.s === 404, "…and the permalink no longer serves it to him", `status ${benPermalink.s}`);
  await call("POST", `/api/posts/${imgPost}/archive`, {}, ana.token);
  const benSavedAfter = await call("GET", "/api/posts/saved", null, ben.token);
  ok(ids(benSavedAfter).includes(String(imgPost)), "…and restoring brings it back to his Saved list too");

  /* ══════════════ media ══════════════ */
  section("the Media tab has a real endpoint");
  const media = await call("GET", `/api/users/${anaHandle}/media?page=1&limit=18`, null, ben.token);
  ok(media.s === 200, "GET /users/:handle/media → 200", `status ${media.s}`);
  ok(media.d?.total === 2, "it reports the real total (two image posts)", String(media.d?.total));
  ok(
    (media.d?.posts || []).every((p) => Array.isArray(p.images) && p.images.length > 0),
    "every returned post actually has an image"
  );
  ok(media.d?.hasMore === false, "…and pagination agrees there is nothing more");

  /* Drafts are not media anyone should browse, and archived images are out too. */
  await call("POST", `/api/posts/${toArchive}/archive`, {}, ana.token);
  const mediaAfterArchive = await call("GET", `/api/users/${anaHandle}/media?page=1&limit=18`, null, ben.token);
  ok(mediaAfterArchive.d?.total === 2, "archiving a text post does not change the media set");
  const archImg = await call("POST", `/api/posts/${imgPost}/archive`, {}, ana.token);
  ok(archImg.d?.archived === true, "archive the image post");
  const mediaMinus = await call("GET", `/api/users/${anaHandle}/media?page=1&limit=18`, null, ben.token);
  ok(mediaMinus.d?.total === 1, "…and its image leaves the grid too", String(mediaMinus.d?.total));
  await call("POST", `/api/posts/${imgPost}/archive`, {}, ana.token);

  /* A private profile hides media exactly like it hides posts. */
  const User2 = require("../models/user.model");
  await User2.updateOne({ _id: ana.id }, { $set: { "socialSettings.profileVisibility": "private" } });
  const privateMedia = await call("GET", `/api/users/${anaHandle}/media?page=1&limit=18`, null, ben.token);
  ok(privateMedia.s === 200 && privateMedia.d?.canView === false, "a private profile returns canView:false for media");
  ok(privateMedia.d?.posts?.length === 0, "…and no images leak through the grid");
  const privatePosts = await call("GET", `/api/users/${anaHandle}/posts`, null, ben.token);
  ok(privatePosts.d?.canView === false && privatePosts.d?.posts?.length === 0, "…and none through the posts list either");
  await User2.updateOne({ _id: ana.id }, { $set: { "socialSettings.profileVisibility": "public" } });

  /* ══════════════ pagination shapes ══════════════ */
  section("both pagination styles are what the UI expects");
  // Put the fixture back where it started before measuring page boundaries.
  await call("POST", `/api/posts/${toArchive}/archive`, {}, ana.token);
  const page1 = await call("GET", `/api/users/${anaHandle}/posts?page=1&limit=2`, null, ana.token);
  ok(page1.d?.posts?.length === 2 && page1.d?.hasMore === true, "page-based: limit respected, hasMore true");
  const page2 = await call("GET", `/api/users/${anaHandle}/posts?page=2&limit=2`, null, ana.token);
  ok(page2.d?.posts?.length === 2, "page 2 returns the next slice");
  ok(
    !ids(page1).some((id) => ids(page2).includes(id)),
    "…with no overlap between pages"
  );
  const cursor1 = await call("GET", "/api/posts/archived?limit=1", null, ana.token);
  ok(cursor1.s === 200, "archived list responds with limit=1");
  const likedCursor = await call("GET", "/api/posts/liked?limit=1", null, ana.token);
  ok("nextCursor" in (likedCursor.d || {}), "cursor-based: the response carries nextCursor (null when done)");

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  await mongoose.disconnect().catch(() => {});
  await mongod.stop().catch(() => {});
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
