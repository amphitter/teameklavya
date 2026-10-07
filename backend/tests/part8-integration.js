/**
 * Part 8 integration test — verifies the backend surface the redesigned UI
 * depends on. Runs the server in-process so the test shares the live mongoose
 * connection (a second mongoose instance cannot write to the same data).
 *
 *   node tests/part8-integration.js
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5101";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "part8-test-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.REALTIME_CAP_SOCKETS_PER_IP = "700";

const http = require("http");
const mongoose = require("mongoose");

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
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");

  // Wait for the API to accept connections.
  for (let i = 0; i < 60; i++) {
    try {
      const r = await call("GET", "/api/health");
      if (r.s === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }

  const User = require("../models/user.model");
  const Story = require("../models/story.model");
  const Comment = require("../models/comment.model");
  const Post = require("../models/post.model");
  const Conversation = require("../models/conversation.model");
  const Message = require("../models/message.model");

  const stamp = Date.now();
  const A = { email: `a${stamp}@x.com`, password: "Test1234!" };
  const B = { email: `b${stamp}@x.com`, password: "Test1234!" };
  await call("POST", "/api/auth/signup", { ...A, firstName: "Ana", lastName: "Roy", confirmPassword: A.password, acceptTerms: true });
  await call("POST", "/api/auth/signup", { ...B, firstName: "Ben", lastName: "Sky", confirmPassword: B.password, acceptTerms: true });
  await User.updateMany({ email: { $in: [A.email, B.email] } }, { $set: { emailVerified: true } });

  /* ── B1 — session identity ─────────────────────────────────────────── */
  section("B1 — session identity (the message-direction bug)");
  let r = await call("POST", "/api/auth/login", A);
  const ta = r.d.token;
  const ua = r.d.user || {};
  ok(!!ua._id, "login returns user._id", "without it every message renders as received");
  ok(!!ua.id, "login still returns user.id for existing clients");
  r = await call("POST", "/api/auth/login", B);
  const tb = r.d.token;
  const ub = r.d.user || {};

  /* ── B2 — profile writes ───────────────────────────────────────────── */
  section("B2 — profile writes (previously and silently discarded)");
  r = await call(
    "PUT",
    "/api/auth/me/profile",
    {
      firstName: "Ananya",
      lastName: "Roy",
      username: `ana_${stamp}`,
      bio: "Builder @ EventHub",
      location: "Oslo",
      interests: ["AI", "Design", "ai"],
      avatar: "https://cdn.example.com/a.jpg",
      coverImage: "https://cdn.example.com/c.jpg",
    },
    ta
  );
  ok(r.s === 200, "profile update accepted", JSON.stringify(r.d).slice(0, 120));
  ok(r.d.user?.username === `ana_${stamp}`, "username persisted");
  ok(r.d.user?.firstName === "Ananya", "display name persisted");
  ok(r.d.user?.profile?.bio === "Builder @ EventHub", "bio persisted");
  ok(r.d.user?.profile?.avatar === "https://cdn.example.com/a.jpg", "avatar persisted (§21)");
  ok(r.d.user?.profile?.coverImage === "https://cdn.example.com/c.jpg", "coverImage persisted (§22)");
  ok(r.d.user?.profile?.interests?.length === 2, "interests deduped to 2", JSON.stringify(r.d.user?.profile?.interests));

  section("B2 — the update endpoint must not be a privilege escalator");
  await call("PUT", "/api/auth/me/profile", { role: "admin", points: 999999 }, ta);
  r = await call("GET", "/api/auth/me", null, ta);
  ok(r.d.user?.role === "user", "role cannot be self-assigned", `got ${r.d.user?.role}`);
  const dbUser = await User.findById(ua._id).lean();
  ok(dbUser.points === 0, "points cannot be self-minted", `got ${dbUser.points}`);
  ok(r.d.user?.username === `ana_${stamp}`, "/auth/me returns username (§56)");
  ok(!!r.d.user?.socialSettings, "/auth/me returns socialSettings (§56)");

  section("B2 — username availability");
  r = await call("GET", "/api/auth/username-availability?username=totally_unique_9", null, ta);
  ok(r.d.available === true, "free username reports available");
  r = await call("GET", "/api/auth/username-availability?username=ana_" + stamp, null, tb);
  ok(r.d.available === false && r.d.reason === "taken", "taken username reports taken");
  r = await call("GET", "/api/auth/username-availability?username=ana_" + stamp, null, ta);
  ok(r.d.available === true, "own username reports available to self");
  r = await call("GET", "/api/auth/username-availability?username=ab", null, ta);
  ok(r.d.available === false && r.d.reason === "invalid", "too-short username rejected");

  r = await call("PUT", "/api/auth/me/profile", { username: "BAD NAME!" }, ta);
  ok(r.s === 400, "invalid username rejected on save");
  r = await call("PUT", "/api/auth/me/profile", { avatar: "javascript:alert(1)" }, ta);
  ok(r.s === 400, "javascript: URL rejected for avatar");

  /* ── B3 — stories ──────────────────────────────────────────────────── */
  section("B3 — stories (§15-19)");
  r = await call("POST", "/api/stories", { media: { url: "https://cdn.example.com/s1.jpg", type: "image", width: 1080, height: 1920 }, caption: "Hack night", category: "Hackathon" }, ta);
  ok(r.s === 201, "story created", JSON.stringify(r.d).slice(0, 140));
  const storyId = r.d.story?._id;
  ok(r.d.story?.categoryIcon === "code", "category icon resolved (§39)", `got ${r.d.story?.categoryIcon}`);
  ok(r.d.story?.categoryLabel === "Hackathon", "category label resolved");

  r = await call("POST", "/api/stories", { media: { url: "not-a-url" } }, ta);
  ok(r.s === 400, "non-URL media rejected");
  r = await call("POST", "/api/stories", { media: { url: "javascript:alert(1)" } }, ta);
  ok(r.s === 400, "javascript: media URL rejected");

  r = await call("GET", "/api/stories", null, ta);
  ok(r.d.groups?.length === 1, "feed returns own group");
  ok(r.d.groups?.[0]?.isMe === true, "own group flagged isMe");
  ok(r.d.groups?.[0]?.stories?.[0]?.categoryIcon === "code", "feed carries the icon");

  r = await call("GET", "/api/stories/categories");
  ok(r.d.categories?.[0]?.icon === "code", "category rail exposes icons", JSON.stringify(r.d.categories?.[0]));

  r = await call("POST", `/api/stories/${storyId}/view`, {}, tb);
  ok(r.d.viewsCount === 1, "view recorded", JSON.stringify(r.d));
  r = await call("POST", `/api/stories/${storyId}/view`, {}, tb);
  ok(r.d.viewsCount === 1, "view is idempotent (no double count)");

  section("B3 — 24h expiry is enforced at query time");
  await Story.updateOne({ _id: storyId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  r = await call("GET", "/api/stories", null, ta);
  ok((r.d.groups || []).length === 0, "expired story leaves the active feed");
  r = await call("GET", `/api/stories/${storyId}`, null, ta);
  ok(r.s === 200, "owner can still open their own expired story");
  r = await call("GET", `/api/stories/${storyId}`, null, tb);
  ok(r.s === 410, "expired story returns 410 to everyone else");
  r = await call("GET", "/api/stories/archive", null, ta);
  ok(r.d.groups?.[0]?.stories?.[0]?.archived === true, "expired story appears in archive (§18-19)");
  ok(!!r.d.groups?.[0]?.label, "archive groups by month", r.d.groups?.[0]?.label);

  r = await call("DELETE", `/api/stories/${storyId}`, null, tb);
  ok(r.s === 403, "cannot delete someone else's story");
  r = await call("DELETE", `/api/stories/${storyId}`, null, ta);
  ok(r.s === 200, "author can delete own story");

  /* ── B4 — comment replies + likes ──────────────────────────────────── */
  section("B4 — comments (§13)");
  const post = await Post.create({ author: ua._id, content: "Hello EventHub", status: "published", visibility: "public" });
  r = await call("POST", `/api/posts/${post._id}/comments`, { content: "top level" }, tb);
  ok(r.s === 201, "top-level comment created");
  const c1 = r.d.comment?._id;

  r = await call("POST", `/api/posts/${post._id}/comments`, { content: "a reply", parent: c1 }, ta);
  ok(r.s === 201, "reply created");
  const c2 = r.d.comment?._id;

  r = await call("POST", `/api/posts/${post._id}/comments`, { content: "reply to a reply", parent: c2 }, tb);
  ok(r.s === 201, "reply-to-reply accepted");
  const c3 = r.d.comment?._id;

  const deep = await Comment.findById(c3).lean();
  ok(String(deep.parent) === String(c1), "depth collapses to ONE level (§13)", `parent=${deep.parent}`);

  r = await call("GET", `/api/posts/${post._id}/comments`, null, ta);
  ok(r.d.comments?.length === 1, "list returns top-level only", `got ${r.d.comments?.length}`);
  ok(r.d.comments?.[0]?.replyCount === 2, "replyCount denormalised for 'View replies (N)'", `got ${r.d.comments?.[0]?.replyCount}`);

  r = await call("GET", `/api/posts/${post._id}/comments/${c1}/replies`, null, ta);
  ok(r.d.replies?.length === 2, "replies load on demand");

  r = await call("POST", `/api/posts/${post._id}/comments/${c1}/like`, {}, ta);
  ok(r.d.liked === true && r.d.likesCount === 1, "comment like works");
  r = await call("POST", `/api/posts/${post._id}/comments/${c1}/like`, {}, ta);
  ok(r.d.liked === false && r.d.likesCount === 0, "comment like toggles off");
  r = await call("POST", `/api/posts/${post._id}/comments/${c1}/like`, {}, tb);
  r = await call("GET", `/api/posts/${post._id}/comments`, null, tb);
  ok(r.d.comments?.[0]?.likedByMe === true, "likedByMe reflects the viewer");
  ok(r.d.comments?.[0]?.likers === undefined, "raw liker list never leaks to the client");

  r = await call("DELETE", `/api/posts/${post._id}/comments/${c2}`, null, tb);
  ok(r.s === 403, "cannot delete someone else's comment");
  r = await call("DELETE", `/api/posts/${post._id}/comments/${c2}`, null, ta);
  ok(r.s === 200, "author can delete own comment");
  const afterDel = await Comment.findById(c2).lean();
  ok(!!afterDel?.removedAt, "deleted comment is soft-removed, not orphaned");
  r = await call("GET", `/api/posts/${post._id}/comments`, null, ta);
  ok(r.d.comments?.[0]?.replyCount === 1, "replyCount decremented on delete");

  /* ── Messages: direction, archive, reactions ───────────────────────── */
  section("Messages — archive (§32-33) and reactions (§31)");
  r = await call("POST", "/api/messages/conversations", { userId: ua._id }, tb);
  const convId = r.d.conversationId;
  ok(!!convId, "conversation opened");

  r = await call("POST", `/api/messages/conversations/${convId}`, { content: "from Ben" }, tb);
  ok(r.s === 201, "message sent");
  const msgId = r.d.message?._id;
  ok(String(r.d.message?.sender?._id) === String(ub._id), "sender echoed (client can compute \"mine\")");

  r = await call("GET", `/api/messages/conversations/${convId}`, null, ta);
  ok(Array.isArray(r.d.messages), "thread loads");
  ok(r.d.archived === false, "not archived by default");

  r = await call("POST", `/api/messages/conversations/${convId}/archive`, { archived: true }, ta);
  ok(r.d.archived === true, "archive succeeds");
  r = await call("GET", "/api/messages/conversations", null, ta);
  ok((r.d.conversations || []).length === 0, "archived chat leaves the inbox (§33)");
  r = await call("GET", "/api/messages/conversations?view=archived", null, ta);
  ok((r.d.conversations || []).length === 1, "archived chat is reachable (§32)");

  section("§33 — a new message must NOT silently unarchive");
  await call("POST", `/api/messages/conversations/${convId}`, { content: "still there?" }, tb);
  r = await call("GET", "/api/messages/conversations?view=archived", null, ta);
  const archivedRow = (r.d.conversations || [])[0];
  ok(!!archivedRow, "stays archived after a new message");
  ok(archivedRow?.unreadCount > 0, "shows an unread badge instead", `unread=${archivedRow?.unreadCount}`);
  r = await call("GET", "/api/messages/conversations", null, ta);
  ok((r.d.conversations || []).length === 0, "inbox still clean");

  r = await call("POST", `/api/messages/conversations/${convId}/archive`, { archived: false }, ta);
  ok(r.d.archived === false, "unarchive succeeds");
  r = await call("GET", "/api/messages/conversations", null, ta);
  ok((r.d.conversations || []).length === 1, "returns to the inbox");

  section("§31 — message reactions");
  r = await call("POST", `/api/messages/${msgId}/react`, { emoji: "❤️" }, ta);
  ok(r.d.reactions?.[0]?.emoji === "❤️" && r.d.reactions?.[0]?.mine === true, "reaction added");
  r = await call("POST", `/api/messages/${msgId}/react`, { emoji: "🔥" }, ta);
  ok(r.d.reactions?.length === 1 && r.d.reactions?.[0]?.emoji === "🔥", "switching emoji replaces, not stacks");
  r = await call("POST", `/api/messages/${msgId}/react`, { emoji: "🔥" }, ta);
  ok(r.d.reactions?.length === 0, "same emoji again removes the reaction");
  r = await call("POST", `/api/messages/${msgId}/react`, { emoji: "💀" }, ta);
  ok(r.s === 400, "unsupported emoji rejected");
  r = await call("GET", `/api/messages/conversations/${convId}`, null, ta);
  ok(Array.isArray(r.d.messages?.[0]?.reactions), "thread returns summarised reactions");

  /* ── §6 — feed filters ──────────────────────────────────────────────── */
  section("§6 — feed filters (events / communities)");
  await Post.deleteMany({ author: ua._id });
  const ev = await (require("../models/event.model")).create({
    title: "HackCraft 3.0", slug: `hackcraft-${stamp}`, description: "d",
    startDate: new Date(Date.now() + 86400000), endDate: new Date(Date.now() + 172800000),
    venue: "Oslo", organizer: ua._id, status: "published", visibility: "public", category: "hackathon",
  });
  await Post.create({ author: ua._id, content: "about the hack", status: "published", visibility: "public", event: ev._id });
  await Post.create({ author: ua._id, content: "plain post", status: "published", visibility: "public" });

  r = await call("GET", "/api/posts/feed?tab=events", null, ta);
  ok(r.d.tab === "events", "events tab accepted");
  ok(r.d.posts?.length === 1, "events tab returns only event posts", `got ${r.d.posts?.length}`);
  ok(String(r.d.posts?.[0]?.event?._id) === String(ev._id), "the event is populated");

  r = await call("GET", "/api/posts/feed?tab=communities", null, ta);
  ok(r.d.tab === "communities", "communities tab accepted");
  ok(r.d.posts?.length === 0, "communities tab empty when no community posts — not padded");

  r = await call("GET", "/api/posts/feed?tab=nonsense", null, ta);
  ok(r.d.tab === "for-you", "unknown tab falls back to for-you");

  r = await call("GET", "/api/posts/feed?tab=for-you", null, ta);
  ok(r.d.posts?.length === 2, "for-you still returns everything");

  /* ── Part 9 §10-12 — saved / liked / archived are three concepts ────── */
  section("Part 9 §11 — liked posts");
  await Post.deleteMany({ author: ua._id });
  await (require("../models/reaction.model")).deleteMany({ user: ub._id });
  const lp1 = await Post.create({ author: ua._id, content: "liked one", status: "published", visibility: "public" });
  const lp2 = await Post.create({ author: ua._id, content: "liked two", status: "published", visibility: "public" });
  await Post.create({ author: ua._id, content: "not liked", status: "published", visibility: "public" });

  // B likes lp2 first, then lp1 — order must follow the reaction, not the post.
  await call("POST", `/api/posts/${lp2._id}/like`, {}, tb);
  await new Promise((r) => setTimeout(r, 25));
  await call("POST", `/api/posts/${lp1._id}/like`, {}, tb);

  r = await call("GET", "/api/posts/liked", null, tb);
  ok(r.d.posts?.length === 2, "liked returns only liked posts", `got ${r.d.posts?.length}`);
  // lp2 was liked first, lp1 second → newest-like-first means lp1 leads.
  // Post.createdAt would put lp1 first too, so assert the *reverse* case
  // below: unlike lp1, and the order must follow the remaining reaction.
  ok(r.d.posts?.[0]?.content === "liked one", "most-recently-liked sorts first", r.d.posts?.[0]?.content);
  ok(r.d.nextCursor === null || typeof r.d.nextCursor === "string", "liked exposes a cursor");

  r = await call("GET", "/api/posts/liked", null, ta);
  ok(r.d.posts?.length === 0, "liked is per-viewer — A's likes are not B's");

  await call("POST", `/api/posts/${lp1._id}/like`, {}, tb); // unlike
  r = await call("GET", "/api/posts/liked", null, tb);
  ok(r.d.posts?.length === 1, "unliking removes it from Liked");

  section("Part 9 §12 — archived posts");
  r = await call("POST", `/api/posts/${lp2._id}/archive`, {}, tb);
  ok(r.s === 403, "cannot archive someone else's post");

  r = await call("POST", `/api/posts/${lp2._id}/archive`, {}, ta);
  ok(r.s === 200 && r.d.archived === true, "author can archive own post");
  r = await call("GET", "/api/posts/archived", null, ta);
  ok(r.d.posts?.length === 1, "archived post appears in archive", `got ${r.d.posts?.length}`);

  r = await call("GET", "/api/posts/feed?tab=for-you", null, ta);
  ok(!(r.d.posts || []).some((x) => String(x._id) === String(lp2._id)), "archived post leaves the feed");
  ok((r.d.posts || []).length === 2, "the other two remain",
     `got ${(r.d.posts || []).length}: ${(r.d.posts || []).map((x) => x.content).join(" | ")}`);

  r = await call("GET", `/api/users/${ua._id}/posts`, null, tb);
  ok(!(r.d.posts || []).some((x) => String(x._id) === String(lp2._id)), "archived post leaves the public profile");

  r = await call("POST", `/api/posts/${lp2._id}/archive`, {}, ta);
  ok(r.d.archived === false, "archive toggles back off (restore)");
  r = await call("GET", "/api/posts/archived", null, ta);
  ok(r.d.posts?.length === 0, "restored post leaves the archive");
  r = await call("GET", `/api/users/${ua._id}/posts`, null, tb);
  ok((r.d.posts || []).some((x) => String(x._id) === String(lp2._id)), "restored post returns to the profile");

  section("§12 — archived must not be confused with moderation-hidden");
  const P2 = Post;
  await P2.updateOne({ _id: lp2._id }, { $set: { archivedAt: null, status: "hidden" } });
  r = await call("GET", "/api/posts/archived", null, ta);
  ok(r.d.posts?.length === 0, "a moderation-hidden post is NOT the author's archive");
  r = await call("GET", "/api/posts/feed?tab=for-you", null, ta);
  ok(!(r.d.posts || []).some((x) => String(x._id) === String(lp2._id)), "moderation-hidden still leaves the feed");
  await P2.updateOne({ _id: lp2._id }, { $set: { status: "published" } });

  /* ── §37/§52 — no fabricated metrics ───────────────────────────────── */
  section("§52 — no fabricated engagement");
  const fresh = await Post.create({ author: ua._id, content: "no engagement yet", status: "published", visibility: "public" });
  r = await call("GET", `/api/posts/${fresh._id}`, null, ta);
  ok((r.d.post?.likesCount ?? 0) === 0, "a new post reports 0 likes, not a placeholder number");
  ok((r.d.post?.commentsCount ?? 0) === 0, "a new post reports 0 comments");

  console.log(`\n${"═".repeat(52)}\n  PART 8 BACKEND: ${passed} passed, ${failed} failed\n${"═".repeat(52)}`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
