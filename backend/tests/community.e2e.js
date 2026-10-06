/**
 * Phase F E2E — Notifications, Messages & Community wiring
 * Run: node tests/community.e2e.js
 */
process.env.NODE_ENV = "test";
process.env.PORT = 5058;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x"; process.env.GOOGLE_CLIENT_SECRET = "y"; process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";

const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Post = require("../models/post.model");
const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const Notification = require("../models/notification.model");

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name} ${extra}`); }
};

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  require("../server");
  const B = `http://localhost:${process.env.PORT}/api`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) { try { await fetch(`${B}/events`); break; } catch { await wait(300); } }

  const jwt = require("jsonwebtoken");
  const tok = (u) => jwt.sign({ id: String(u._id), role: u.role || "user", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });

  // Users: Alice (author/organizer), Bob (actor), Carol (outsider)
  const [alice, bob, carol] = await User.create([
    { firstName: "Alice", lastName: "Author", email: "alice@f.io", passwordHash: "x", emailVerified: true },
    { firstName: "Bob", lastName: "Builder", email: "bob@f.io", passwordHash: "x", emailVerified: true },
    { firstName: "Carol", lastName: "Coder", email: "carol@f.io", passwordHash: "x", emailVerified: true },
  ]);
  const a = tok(alice), b = tok(bob), c = tok(carol);
  const j = async (path, { method = "GET", token, body } = {}) => {
    const r = await fetch(`${B}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    try { return { status: r.status, data: await r.json() }; } catch { return { status: r.status, data: {} }; }
  };

  /* ═══ NOTIFICATIONS — triggers ═══ */
  // 1. Follow → notification for Alice
  let r = await j("/follow/" + alice._id, { method: "POST", token: b });
  check("follow bob→alice", r.status === 200 && r.data.following === true);
  // Bob likes Alice's post
  const post = await Post.create({ author: alice._id, content: "Alice's Phase F post" });
  r = await j(`/posts/${post._id}/like`, { method: "POST", token: b });
  check("bob likes alice post", r.status === 200 && r.data.liked === true);
  // Like again (unlike) → NO second notification
  await j(`/posts/${post._id}/like`, { method: "POST", token: b });
  // Bob comments
  r = await j(`/posts/${post._id}/comments`, { method: "POST", token: b, body: { content: "Nice one!" } });
  check("bob comments", r.status === 201);
  // Org follow → notify org creator (Alice)
  const org = await Organization.create({ name: "Phase F Org", slug: "phase-f-org", createdBy: alice._id });
  r = await j(`/organizations/${org._id}/follow`, { method: "POST", token: b });
  check("bob follows org", r.status === 200 && r.data.following === true);
  // Bob registers for Alice's event → notify Alice
  const event = await Event.create({
    title: "Phase F Event", slug: "phase-f-event", description: "d", category: "Workshop",
    eventType: "online", onlineEventLink: "https://x.y/z", organizer: "Alice",
    startDate: new Date(Date.now() + 86400e3), endDate: new Date(Date.now() + 90000e3),
    visibility: "public", createdBy: alice._id,
  });
  r = await j("/registration/responses", { method: "POST", token: b, body: { eventId: event._id, answers: [] } });
  check("bob registers for event", r.status === 201);

  // Alice's notifications: follow, like, comment, org_follow, event_registration (no dup from unlike)
  r = await j("/notifications", { token: a });
  const notifs = r.data.notifications || [];
  const types = notifs.map((n) => n.type);
  check("alice notification list", r.status === 200 && notifs.length === 5, `got=${types.join(",")}`);
  check("notification types", ["event_registration", "org_follow", "comment", "like", "follow"].every((t) => types.includes(t)));
  check("unread count", r.data.unreadCount === 5, `got=${r.data.unreadCount}`);
  check("actor populated", notifs.every((n) => n.actor?.firstName === "Bob"));
  check("event ref populated", notifs.find((n) => n.type === "event_registration")?.event?.title === "Phase F Event");

  // Bob should have NO notifications (self-notify skipped; he's the actor)
  r = await j("/notifications", { token: b });
  check("actor gets no self notifications", (r.data.notifications || []).length === 0);

  // Mark one read
  r = await j(`/notifications/${notifs[0]._id}/read`, { method: "POST", token: a });
  r = await j("/notifications/unread-count", { token: a });
  check("mark one read", r.data.unreadCount === 4, `got=${r.data.unreadCount}`);
  // Mark all read
  r = await j("/notifications/read-all", { method: "POST", token: a });
  r = await j("/notifications/unread-count", { token: a });
  check("mark all read", r.data.unreadCount === 0);
  // Can't read someone else's notification (Carol)
  r = await j(`/notifications/${notifs[0]._id}/read`, { method: "POST", token: c });
  check("foreign notification 404", r.status === 404);

  /* ═══ NOTIFICATIONS — announcement (notify-all) ═══ */
  // Carol becomes admin & announces
  carol.role = "admin"; await carol.save();
  r = await j(`/events/${event._id}/notify-all`, { method: "POST", token: tok(carol) });
  check("notify-all", r.status === 200 && r.data.sentCount >= 3);
  r = await j("/notifications", { token: a });
  const ann = (r.data.notifications || []).find((n) => n.type === "announcement");
  check("announcement notification for alice", Boolean(ann) && ann.actor.firstName === "Carol" && ann.event.title === "Phase F Event");
  r = await j("/notifications", { token: tok(carol) });
  check("announcer not self-notified", !(r.data.notifications || []).some((n) => n.type === "announcement"));

  /* ═══ MESSAGES ═══ */
  // Bob starts a conversation with Alice
  r = await j("/messages/conversations", { method: "POST", token: b, body: { userId: alice._id } });
  check("start conversation", r.status === 200 && r.data.conversationId && r.data.other.firstName === "Alice");
  const convoId = r.data.conversationId;
  // Idempotent — same conversation back
  r2 = await j("/messages/conversations", { method: "POST", token: a, body: { userId: bob._id } });
  check("get-or-create idempotent", r2.data.conversationId === convoId);
  // Bob sends 2 messages
  r = await j(`/messages/conversations/${convoId}`, { method: "POST", token: b, body: { content: "Hey Alice! 👋" } });
  check("send message", r.status === 201 && r.data.message.content === "Hey Alice! 👋");
  await j(`/messages/conversations/${convoId}`, { method: "POST", token: b, body: { content: "See you at the event?" } });
  // Alice's conversation list shows unread 2
  r = await j("/messages/conversations", { token: a });
  check("conversation list", r.status === 200 && r.data.conversations.length === 1);
  const conv = r.data.conversations[0];
  check("conversation fields", conv.other.firstName === "Bob" && conv.unreadCount === 2 && conv.lastMessage.text === "See you at the event?" && conv.lastMessage.mine === false);
  // Alice unread count
  r = await j("/messages/unread-count", { token: a });
  check("messages unread count", r.data.unreadCount === 2);
  // Alice opens the thread → marks read, sees messages
  r = await j(`/messages/conversations/${convoId}`, { token: a });
  check("get messages", r.status === 200 && r.data.messages.length === 2 && r.data.other.firstName === "Bob");
  r = await j("/messages/unread-count", { token: a });
  check("read marks unread 0", r.data.unreadCount === 0);
  // Alice replies
  r = await j(`/messages/conversations/${convoId}`, { method: "POST", token: a, body: { content: "Definitely!" } });
  check("reply", r.status === 201);
  // Carol (outsider) cannot access
  r = await j(`/messages/conversations/${convoId}`, { token: c });
  check("outsider blocked from thread", r.status === 404);
  r = await j(`/messages/conversations/${convoId}`, { method: "POST", token: c, body: { content: "hi" } });
  check("outsider cannot send", r.status === 404);
  // Empty message rejected
  r = await j(`/messages/conversations/${convoId}`, { method: "POST", token: b, body: { content: "   " } });
  check("empty message rejected", r.status === 400);
  // Self-conversation rejected
  r = await j("/messages/conversations", { method: "POST", token: b, body: { userId: bob._id } });
  check("self conversation rejected", r.status === 400);
  // Auth required
  r = await j("/messages/conversations");
  check("messages require auth", r.status === 401);
  r = await j("/notifications");
  check("notifications require auth", r.status === 401);

  /* ═══ COMMUNITY WIRING ═══ */
  // Feed: authorFollowing for Alice viewing Bob's post? Bob follows Alice; Alice views feed → her own post: authorFollowing false (self)
  // Bob views feed → Alice's post has authorFollowing true
  const bobPost = await Post.create({ author: bob._id, content: "Bob's post" });
  r = await j("/posts/feed", { token: b });
  const feedPosts = r.data.posts || [];
  const alicePostInFeed = feedPosts.find((p) => p._id === String(post._id));
  check("feed authorFollowing=true for followed author", alicePostInFeed?.authorFollowing === true);
  const bobPostInFeed = feedPosts.find((p) => p._id === String(bobPost._id));
  check("feed authorFollowing=false for own post", bobPostInFeed?.authorFollowing === false);
  // Single post enrichment
  r = await j(`/posts/${post._id}`, { token: b });
  check("single post authorFollowing", r.data.post?.authorFollowing === true);

  // Comment delete: Bob's comment on Alice's post
  r = await j(`/posts/${post._id}/comments`, { method: "POST", token: c, body: { content: "Carol's take" } });
  const carolComment = r.data.comment;
  // Carol cannot delete Bob's comment
  const bobComment = (await j(`/posts/${post._id}/comments`, { token: a })).data.comments.find((x) => x.author.firstName === "Bob");
  r = await j(`/posts/${post._id}/comments/${bobComment._id}`, { method: "DELETE", token: c });
  check("cannot delete others' comment", r.status === 403);
  // Carol deletes her own
  r = await j(`/posts/${post._id}/comments/${carolComment._id}`, { method: "DELETE", token: c });
  check("delete own comment", r.status === 200);
  r = await j(`/posts/${post._id}/comments`, { token: a });
  check("comment removed", !(r.data.comments || []).some((x) => x._id === carolComment._id));

  console.log(failed === 0 ? `\n✅ ALL PASS (${passed})` : `\n❌ ${failed} FAILED (${passed} passed)`);
  await User.deleteMany({});
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
