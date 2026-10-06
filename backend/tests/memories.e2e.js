/**
 * Phase H E2E — Event Memories (posts attached to an event)
 * Run: node tests/memories.e2e.js   (expects 12/12)
 */
process.env.NODE_ENV = "test";
process.env.PORT = 5060;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x"; process.env.GOOGLE_CLIENT_SECRET = "y"; process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";

const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const Post = require("../models/post.model");

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

  const [alice, bob] = await User.create([
    { firstName: "Alice", lastName: "Author", email: "alice@m.io", passwordHash: "x", emailVerified: true },
    { firstName: "Bob", lastName: "Builder", email: "bob@m.io", passwordHash: "x", emailVerified: true },
  ]);
  const a = tok(alice), b = tok(bob);

  const j = async (path, { method = "GET", token, body } = {}) => {
    const r = await fetch(`${B}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    try { return { status: r.status, data: await r.json() }; } catch { return { status: r.status, data: {} }; }
  };

  const [event, otherEvent, privateEvent] = await Event.create([
    { title: "Memory Fest", slug: "memory-fest", description: "d", category: "Cultural", eventType: "offline", venue: "Hall",
      startDate: new Date(Date.now() - 7200e3), endDate: new Date(Date.now() - 3600e3), visibility: "public", createdBy: alice._id },
    { title: "Other Fest", slug: "other-fest", description: "d", category: "Cultural", eventType: "offline", venue: "Hall 2",
      startDate: new Date(Date.now() - 7200e3), endDate: new Date(Date.now() - 3600e3), visibility: "public", createdBy: alice._id },
    { title: "Private Fest", slug: "private-fest", description: "d", category: "Cultural", eventType: "offline", venue: "Hall 3",
      startDate: new Date(Date.now() - 7200e3), endDate: new Date(Date.now() - 3600e3), visibility: "private", createdBy: alice._id },
  ]);

  /* ═══ create memories ═══ */
  let r = await j("/posts", { method: "POST", token: a, body: { content: "What a night! 🎉", images: ["https://res.cloudinary.com/demo/img1.jpg", "https://res.cloudinary.com/demo/img2.jpg"], eventId: event._id } });
  check("photo memory created", r.status === 201 && r.data.post.images.length === 2);
  await j("/posts", { method: "POST", token: b, body: { content: "Loved the closing set 🎶", eventId: event._id } });
  r = await j("/posts", { method: "POST", token: b, body: { content: "", eventId: event._id } });
  check("empty memory rejected", r.status === 400);
  await j("/posts", { method: "POST", token: a, body: { content: "Unrelated post" } }); // no event
  r = await j("/posts", { method: "POST", token: a, body: { content: "sneaky", eventId: privateEvent._id } });
  check("memory for non-public event rejected", r.status === 400);

  /* ═══ event posts endpoint ═══ */
  r = await j(`/posts/event/${event._id}`);
  check("event posts listed (no auth needed)", r.status === 200 && r.data.posts.length === 2 && r.data.hasMore === false);
  check("photo memory first (newest)", r.data.posts[0].content.includes("night"));
  check("event populated on posts", r.data.posts[0].event?.title === "Memory Fest");
  check("author populated", r.data.posts[0].author?.firstName === "Alice");
  check("counts attached", r.data.posts[0].likeCount === 0 && r.data.posts[0].commentCount === 0);
  check("viewer flags present", r.data.posts[0].likedByMe === false && r.data.posts[0].savedByMe === false);
  r = await j(`/posts/event/${otherEvent._id}`);
  check("other event has no memories", r.data.posts.length === 0);

  /* ═══ pagination ═══ */
  for (let i = 0; i < 3; i++) await j("/posts", { method: "POST", token: b, body: { content: `memory #${i}`, eventId: event._id } });
  r = await j(`/posts/event/${event._id}`, { params: undefined });
  check("all 5 memories", r.data.posts.length === 5);
  r = await j(`/posts/event/${event._id}?limit=2&page=2`);
  check("pagination works", r.status === 200 && r.data.posts.length === 2 && r.data.hasMore === true);

  /* ═══ likes/comments reflect on memories ═══ */
  const firstId = (await j(`/posts/event/${event._id}`)).data.posts[0]._id;
  await j(`/posts/${firstId}/like`, { method: "POST", token: b });
  await j(`/posts/${firstId}/comments`, { method: "POST", token: b, body: { content: "🔥" } });
  r = await j(`/posts/event/${event._id}`);
  check("likes/comments visible in memories", r.data.posts[0].likeCount === 1 && r.data.posts[0].commentCount === 1);

  /* ═══ auth guard on compose (server side) ═══ */
  r = await j("/posts", { method: "POST", body: { content: "anon", eventId: event._id } });
  check("posting a memory requires auth", r.status === 401);

  console.log(failed === 0 ? `\n✅ ALL PASS (${passed})` : `\n❌ ${failed} FAILED (${passed} passed)`);
  await User.deleteMany({});
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
