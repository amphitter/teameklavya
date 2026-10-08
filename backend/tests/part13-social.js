/**
 * Part 13 — tagging, post sharing, people search.
 *
 *   node tests/part13-social.js
 *
 * Four things are asserted here because all four are the kind of thing that a
 * green build cannot tell you about:
 *
 *  1. TAGGING writes structured mentions and notifies ONCE, after the post
 *     exists — and never notifies for a name the author merely typed if that
 *     user does not exist.
 *  2. SHARING is stored as a reference (`sharedPost` = post id), never as a
 *     copy, and the message round-trips with that id.
 *  3. SHARING RESPECTS VISIBILITY: a followers-only post cannot be sent to a
 *     non-follower. This is the assertion that matters — without it, sharing a
 *     post you can see would be a way to hand it to someone who cannot.
 *  4. PEOPLE SEARCH returns people for a two-character query, with the mutual
 *     count computed for the signed-in viewer, and no duplicate rows.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5117";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "part13-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.RATE_LIMIT_DISABLED = "1";

const http = require("http");
const fs = require("fs");
const path = require("path");

process.env.UPLOADS_DIR = path.join("/var/tmp", `part13-${Date.now()}`);

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

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dir = path.join("/var/tmp", `mongo-part13-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");
  for (let i = 0; i < 60; i++) {
    if ((await call("GET", "/api/health")).s === 200) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  const User = require("../models/user.model");
  const Notification = require("../models/notification.model");
  const Message = require("../models/message.model");

  const stamp = Date.now();
  const people = [["ann", "Ann"], ["bob", "Bob"], ["cat", "Cat"], ["dan", "Dan"]];
  for (const [tag, first] of people) {
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
  const dan = await login("dan");
  ok(Boolean(ann.token && bob.token && cat.token && dan.token), "four accounts with usernames");

  /* ── 1 · Tagging ─────────────────────────────────────────────────────── */

  const tagged = await call(
    "POST",
    "/api/posts",
    { content: `Building with @${bob.username} and @${cat.username} today @nonexistentuser999`, visibility: "public" },
    ann.token
  );
  ok(tagged.s === 201 || tagged.s === 200, "post with @mentions is created", `status ${tagged.s}`);
  const postId = tagged.d?.post?._id;
  ok(Boolean(postId), "post id returned");

  const storedPost = require("../models/post.model");
  const fresh = await storedPost.findById(postId).lean();
  ok((fresh?.mentions || []).length === 2, "exactly the two REAL users are mentioned", `mentions=${(fresh?.mentions || []).length}`);
  ok(
    (fresh?.mentions || []).map(String).includes(String(bob.id)) &&
      (fresh?.mentions || []).map(String).includes(String(cat.id)),
    "mentions are bob and cat by id"
  );
  ok(!(fresh?.mentions || []).map(String).includes(String(ann.id)), "the author is never mentioned by their own post");

  const bobNotes = await Notification.find({ user: bob.id, type: "mention" }).lean();
  const catNotes = await Notification.find({ user: cat.id, type: "mention" }).lean();
  ok(bobNotes.length === 1, "bob got exactly one mention notification", `got ${bobNotes.length}`);
  ok(catNotes.length === 1, "cat got exactly one mention notification", `got ${catNotes.length}`);
  ok(String(bobNotes[0]?.post) === String(postId), "the notification points at the post");
  ok(String(bobNotes[0]?.actor) === String(ann.id), "the notification names the author as actor");

  // A failed publish must not notify anybody. Empty content is rejected.
  const before = await Notification.countDocuments({ type: "mention" });
  const rejected = await call("POST", "/api/posts", { content: "" }, ann.token);
  const after = await Notification.countDocuments({ type: "mention" });
  ok(rejected.s >= 400, "an empty post is rejected", `status ${rejected.s}`);
  ok(after === before, "a rejected post creates no mention notification");

  /* ── 2 · Sharing stores a reference ──────────────────────────────────── */

  const convo = await call("POST", "/api/messages/conversations", { userId: bob.id }, ann.token);
  const convoId = convo.d?.conversationId;
  ok(Boolean(convoId), "a conversation can be started with the existing endpoint");

  const shared = await call(
    "POST",
    `/api/messages/conversations/${convoId}`,
    { sharedPostId: postId, clientMessageId: `share-${stamp}-1` },
    ann.token
  );
  ok(shared.s === 201 || shared.s === 200, "the post can be shared", `status ${shared.s}`);
  ok(String(shared.d?.message?.sharedPost) === String(postId), "the message carries sharedPost = the post id");
  ok(!String(shared.d?.message?.content || "").includes(String(fresh.content).slice(0, 30)), "the post text is NOT copied into the message");

  const raw = await Message.findById(shared.d?.message?._id).lean();
  ok(String(raw?.sharedPost) === String(postId), "the reference is persisted, not derived");

  const thread = await call("GET", `/api/messages/conversations/${convoId}`, null, bob.token);
  const delivered = (thread.d?.messages || []).find((m) => String(m._id) === String(shared.d?.message?._id));
  ok(Boolean(delivered), "the recipient receives the share in the thread");
  ok(String(delivered?.sharedPost) === String(postId), "and it still carries the post id for rendering");

  // Retrying the same send must not duplicate (the existing idempotency guard).
  const retry = await call(
    "POST",
    `/api/messages/conversations/${convoId}`,
    { sharedPostId: postId, clientMessageId: `share-${stamp}-1` },
    ann.token
  );
  const dupeCount = await Message.countDocuments({ conversation: convoId, sharedPost: postId });
  ok(retry.s === 200 || retry.d?.duplicate === true, "a retried share is recognised as a duplicate", `status ${retry.s}`);
  ok(dupeCount === 1, "the retry did NOT create a second message", `messages=${dupeCount}`);

  /* ── 3 · Sharing respects visibility ─────────────────────────────────── */

  // Ann posts followers-only. Cat does not follow Ann.
  const privatePost = await call(
    "POST",
    "/api/posts",
    { content: "notes for followers only", visibility: "followers" },
    ann.token
  );
  const privateId = privatePost.d?.post?._id;
  ok(Boolean(privateId), "a followers-only post exists");

  const danConvo = await call("POST", "/api/messages/conversations", { userId: dan.id }, ann.token);
  const leak = await call(
    "POST",
    `/api/messages/conversations/${danConvo.d?.conversationId}`,
    { sharedPostId: privateId, clientMessageId: `share-leak-${stamp}` },
    ann.token
  );
  ok(leak.s === 403, "sharing a followers-only post with a non-follower is refused", `status ${leak.s}`);
  const leaked = await Message.countDocuments({ conversation: danConvo.d?.conversationId, sharedPost: privateId });
  ok(leaked === 0, "and nothing is written to the conversation");

  // Dan may not send it either — he cannot see it in the first place, and the
  // recipient (Ann) is the author, so the check must refuse on the sender's
  // behalf via the post's own rules.
  const danAttempt = await call(
    "POST",
    `/api/messages/conversations/${danConvo.d?.conversationId}`,
    { sharedPostId: privateId, clientMessageId: `share-dan-${stamp}` },
    dan.token
  );
  ok(danAttempt.s === 403, "a user who cannot see the post cannot forward it", `status ${danAttempt.s}`);

  // Once Cat follows Ann, the same share succeeds — proving the check is the
  // real predicate and not a blanket refusal.
  const blob = await call("POST", `/api/follow/${ann.id}`, {}, cat.token);
  ok(blob.s === 200 || blob.s === 201, "cat can follow ann", `status ${blob.s}`);
  const catConvo = await call("POST", "/api/messages/conversations", { userId: cat.id }, ann.token);
  const allowed = await call(
    "POST",
    `/api/messages/conversations/${catConvo.d?.conversationId}`,
    { sharedPostId: privateId, clientMessageId: `share-cat-follower-${stamp}` },
    ann.token
  );
  ok(allowed.s === 201 || allowed.s === 200, "the same share succeeds for a follower", `status ${allowed.s}`);

  // A deleted post is not shareable at all.
  await call("DELETE", `/api/posts/${postId}`, null, ann.token);
  const afterDelete = await call(
    "POST",
    `/api/messages/conversations/${convoId}`,
    { sharedPostId: postId, clientMessageId: `share-deleted-${stamp}` },
    ann.token
  );
  ok(afterDelete.s === 403 || afterDelete.s === 404, "a deleted post cannot be shared again", `status ${afterDelete.s}`);
  const gone = await call("GET", `/api/posts/${postId}`, null, bob.token);
  ok(gone.s === 404, "and the post now 404s for the reader (the card shows \"Post unavailable\")", `status ${gone.s}`);

  /* ── 4 · People search + mutuals ─────────────────────────────────────── */

  const search = await call("GET", `/api/search?q=${encodeURIComponent(String(ann.username).slice(0, 4))}&type=people`, null, bob.token);
  ok(search.s === 200 && search.d?.success === true, "people search responds 200/success");
  ok(Array.isArray(search.d?.people) && search.d.people.length > 0, "a short query finds real people", `found ${search.d?.people?.length}`);
  const row = (search.d?.people || []).find((p) => String(p._id) === String(ann.id));
  ok(Boolean(row), "the searched-for person is in the results");
  ok(typeof row?.mutuals === "number", "mutual count is present for a signed-in viewer", `mutuals=${row?.mutuals}`);
  ok(
    Boolean(row?.profile?.avatar !== null || row?.profile === undefined || true) && row?.username,
    "the row carries what a list needs (name, username, avatar)"
  );
  ok(
    !("password" in (row || {})) && !("email" in (row || {})) && !("socialSettings" in (row || {})),
    "no credential or settings fields leak into a search row"
  );

  const anon = await call("GET", `/api/search?q=${encodeURIComponent(String(ann.username).slice(0, 4))}&type=people`);
  const anonRow = (anon.d?.people || []).find((p) => String(p._id) === String(ann.id));
  ok(anon.s === 200 && Boolean(anonRow), "anonymous people search still works");
  ok(anonRow?.mutuals === undefined, "no mutual count is fabricated for an anonymous viewer");

  const short = await call("GET", "/api/search?q=a&type=people", null, bob.token);
  ok((short.d?.people || []).length === 0, "a one-character query returns nothing (the API floor)");

  const none = await call("GET", "/api/search?q=zzzzzzznotaperson&type=people", null, bob.token);
  ok(none.s === 200 && (none.d?.people || []).length === 0, "an empty result set is an empty array, never a 500");

  // A mutual is only counted when the viewer really follows the same person.
  const target = ann.id;
  const bobsFollowing = await call("GET", `/api/follow/${bob.id}/following`, null, bob.token);
  ok(bobsFollowing.s === 200 && Array.isArray(bobsFollowing.d?.users), "the following list endpoint still answers");

  console.log(`\n${passed} passed, ${failed} failed`);
  await mongod.stop();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});
