/* E2E test of the new social backend against an in-memory MongoDB */
process.env.JWT_SECRET = "test-secret-for-e2e-only";
process.env.JWT_EXPIRES_IN = "7d";
process.env.MONGO_URI = "SET-BY-MEMORY-SERVER";
process.env.PORT = "5055";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.NODE_ENV = "test";
process.env.GOOGLE_CLIENT_ID = "stub-id";
process.env.GOOGLE_CLIENT_SECRET = "stub-secret";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:5055/api/auth/google/callback";

const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Event = require("../models/event.model");

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri("eventhub_e2e");

  // Boot the app without listening (server.js calls app.listen — require it and use the started server)
  const server = require("../server");
  await new Promise((r) => setTimeout(r, 1500)); // let mongoose connect + listen

  const base = "http://localhost:5055/api";
  const j = async (path, opts = {}) => {
    const res = await fetch(base + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const results = [];
  const check = (name, ok, extra = "") => results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);

  // Seed two users directly
  const [alice, bob, carol] = await User.create([
    { firstName: "Alice", lastName: "Dev", email: "alice@test.io", passwordHash: "x", role: "admin", emailVerified: true },
    { firstName: "Bob", lastName: "Builder", email: "bob@test.io", passwordHash: "x", emailVerified: true },
    { firstName: "Carol", lastName: "Coder", email: "carol@test.io", passwordHash: "x", emailVerified: true },
  ]);
  // Alice (admin) creates a public event
  const event = await Event.create({
    title: "HackCraft E2E", slug: "hackcraft-e2e", description: "test event", category: "Hackathon",
    eventType: "offline", venue: "Test Hall", startDate: new Date(Date.now() + 86400000), endDate: new Date(Date.now() + 172800000),
    visibility: "public", createdBy: alice._id,
  });

  // Mint tokens directly (same payload shape as auth controller)
  const jwt = require("jsonwebtoken");
  const tok = (u) => jwt.sign({ id: String(u._id), role: u.role, purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });
  const a = tok(alice), b = tok(bob), c = tok(carol);

  // 1. Empty feed
  let r = await j("/posts/feed");
  check("empty feed", r.status === 200 && r.data.posts.length === 0 && r.data.success === true);

  // 2. Alice creates a text post
  r = await j("/posts", { method: "POST", headers: { Authorization: `Bearer ${a}` }, body: { content: "First post on EventHub! 🎉" } });
  check("create post", r.status === 201 && r.data.post.content === "First post on EventHub! 🎉", `status=${r.status}`);
  const postId = r.data.post?._id;

  // 3. Alice creates an event-native post (admin + public event)
  r = await j("/posts", { method: "POST", headers: { Authorization: `Bearer ${a}` }, body: { content: "Registrations for HackCraft E2E are open!", eventId: String(event._id) } });
  check("event post", r.status === 201 && r.data.post.event?.title === "HackCraft E2E", `status=${r.status}`);
  const eventPostId = r.data.post?._id;

  // 4. Empty post rejected
  r = await j("/posts", { method: "POST", headers: { Authorization: `Bearer ${a}` }, body: { content: "   " } });
  check("empty post rejected", r.status === 400);

  // 5. Bob likes, Carol likes → count 2
  await j(`/posts/${postId}/like`, { method: "POST", headers: { Authorization: `Bearer ${b}` } });
  r = await j(`/posts/${postId}/like`, { method: "POST", headers: { Authorization: `Bearer ${c}` } });
  check("like toggle", r.status === 200 && r.data.liked === true && r.data.likeCount === 2, JSON.stringify(r.data));

  // 6. Bob unlikes → count 1
  r = await j(`/posts/${postId}/like`, { method: "POST", headers: { Authorization: `Bearer ${b}` } });
  check("unlike toggle", r.data.liked === false && r.data.likeCount === 1);

  // 7. Bob comments
  r = await j(`/posts/${postId}/comments`, { method: "POST", headers: { Authorization: `Bearer ${b}` }, body: { content: "See you there!" } });
  check("add comment", r.status === 201 && r.data.comment.content === "See you there!", `status=${r.status}`);

  // 8. Feed shows counts + viewer flags
  r = await j("/posts/feed", { headers: { Authorization: `Bearer ${c}` } });
  const fp = r.data.posts.find((p) => p._id === postId);
  check("feed enrich", fp && fp.likeCount === 1 && fp.commentCount === 1 && fp.likedByMe === true, JSON.stringify({like: fp?.likeCount, c: fp?.commentCount, me: fp?.likedByMe}));
  const ep = r.data.posts.find((p) => p._id === eventPostId);
  check("event populated in feed", ep?.event?.slug === "hackcraft-e2e");

  // 9. Anonymous feed hides viewer flags but shows counts
  r = await j("/posts/feed");
  check("anon feed", r.status === 200 && r.data.posts.length === 2 && r.data.posts[0].likedByMe === false);

  // 10. Bob saves post
  r = await j(`/posts/${postId}/save`, { method: "POST", headers: { Authorization: `Bearer ${b}` } });
  check("save toggle", r.data.saved === true);
  r = await j("/posts/feed", { headers: { Authorization: `Bearer ${b}` } });
  check("savedByMe flag", r.data.posts.find((p) => p._id === postId)?.savedByMe === true);

  // 11. Follow: Bob follows Alice; following tab
  r = await j(`/follow/${String(alice._id)}`, { method: "POST", headers: { Authorization: `Bearer ${b}` } });
  check("follow", r.data.following === true);
  r = await j(`/follow/${String(alice._id)}/status`, { headers: { Authorization: `Bearer ${b}` } });
  check("follow status", r.data.following === true && r.data.followers === 1);
  r = await j("/posts/feed?tab=following", { headers: { Authorization: `Bearer ${b}` } });
  check("following tab", r.data.posts.length === 2 && r.data.posts.every((p) => p.author.email === "alice@test.io"));
  // Carol follows no one
  r = await j("/posts/feed?tab=following", { headers: { Authorization: `Bearer ${c}` } });
  check("following tab empty", r.data.posts.length === 0);
  // Bob unfollows
  r = await j(`/follow/${String(alice._id)}`, { method: "POST", headers: { Authorization: `Bearer ${b}` } });
  check("unfollow", r.data.following === false);

  // 12. Single post
  r = await j(`/posts/${postId}`, { headers: { Authorization: `Bearer ${b}` } });
  check("single post", r.data.post?._id === postId && r.data.post.commentCount === 1);

  // 13. Bob can't delete Alice's post; Alice can
  r = await j(`/posts/${postId}`, { method: "DELETE", headers: { Authorization: `Bearer ${b}` } });
  check("foreign delete blocked", r.status === 403);
  r = await j(`/posts/${postId}`, { method: "DELETE", headers: { Authorization: `Bearer ${a}` } });
  check("own delete", r.status === 200);
  r = await j(`/posts/${postId}`);
  check("deleted post 404", r.status === 404);

  // 14. Unauthenticated post rejected
  r = await j("/posts", { method: "POST", body: { content: "anon" } });
  check("auth required", r.status === 401);

  // 15. Explore filters: live-now + price (public discovery endpoint)
  const now2 = Date.now();
  await Event.create({
    title: "LiveNow Conf", slug: "livenow-conf", description: "live event", category: "Conference",
    eventType: "online", onlineEventLink: "https://meet.example/x",
    startDate: new Date(now2 - 3600e3), endDate: new Date(now2 + 3600e3),
    visibility: "public", createdBy: alice._id, price: 0,
  });
  await Event.create({
    title: "Pro Workshop", slug: "pro-workshop", description: "paid event", category: "Workshop",
    eventType: "online", onlineEventLink: "https://meet.example/y",
    startDate: new Date(now2 + 2 * 86400e3), endDate: new Date(now2 + 3 * 86400e3),
    visibility: "public", createdBy: alice._id, price: 499,
  });
  r = await j("/events?type=ongoing");
  const liveList = r.data.events || [];
  check("live now filter", r.status === 200 && liveList.some((e) => e.slug === "livenow-conf") && !liveList.some((e) => e.slug === "hackcraft-e2e"), `got ${liveList.length}`);
  r = await j("/events?type=upcoming&price=paid");
  const paidList = r.data.events || [];
  check("paid filter", paidList.length > 0 && paidList.every((e) => e.price > 0) && paidList.some((e) => e.slug === "pro-workshop"));
  r = await j("/events?type=upcoming&price=free");
  const freeList = r.data.events || [];
  check("free filter", freeList.every((e) => !(e.price > 0)));
  r = await j("/events?type=upcoming");
  check("soonest sort", (() => {
    const ds = (r.data.events || []).map((e) => new Date(e.startDate).getTime());
    return ds.every((v, i) => i === 0 || ds[i - 1] <= v);
  })());


  // ── Phase D: organizations, public profiles, participants ──
  const Organization = require("../models/organization.model");

  // 16. Org creation permissions
  r = await j("/organizations", { method: "POST", headers: { Authorization: `Bearer ${b}` }, body: { name: "Bob Club" } });
  check("org create requires admin", r.status === 403);
  r = await j("/organizations", { method: "POST", headers: { Authorization: `Bearer ${a}` }, body: { name: "GITM Events", description: "Global Institute of Technology & Management" } });
  check("org create", r.status === 201 && r.data.organization?.slug === "gitm-events", `status=${r.status}`);
  const orgId = r.data.organization?._id;
  r = await j("/organizations", { method: "POST", headers: { Authorization: `Bearer ${a}` }, body: { name: "GITM Events" } });
  check("org slug dedupe", r.status === 201 && r.data.organization?.slug === "gitm-events-1");

  // 17. Org profile by slug + follow
  r = await j("/organizations/gitm-events");
  check("org profile", r.status === 200 && r.data.organization?.followerCount === 0 && r.data.organization?.following === false);
  r = await j(`/organizations/${orgId}/follow`, { method: "POST", headers: { Authorization: `Bearer ${b}` } });
  check("org follow", r.data.following === true);
  r = await j("/organizations/gitm-events", { headers: { Authorization: `Bearer ${b}` } });
  check("org profile viewer-aware", r.data.organization?.followerCount === 1 && r.data.organization?.following === true);
  r = await j("/organizations/mine/followed", { headers: { Authorization: `Bearer ${b}` } });
  check("followed orgs", r.data.organizations?.length === 1 && r.data.organizations[0]?.slug === "gitm-events");
  r = await j("/organizations/mine", { headers: { Authorization: `Bearer ${a}` } });
  check("my orgs (admin)", r.data.organizations?.some((o) => o.slug === "gitm-events"));

  // 18. Org events (attach org to a new public event)
  const orgEvent = await Event.create({
    title: "GITM Annual Fest", slug: "gitm-annual-fest", description: "org event", category: "Cultural",
    eventType: "offline", venue: "GITM Campus",
    startDate: new Date(Date.now() + 5 * 86400e3), endDate: new Date(Date.now() + 6 * 86400e3),
    visibility: "public", createdBy: alice._id, organization: orgId,
  });
  r = await j("/organizations/gitm-events/events");
  check("org events", r.status === 200 && r.data.upcoming?.some((e) => e.slug === "gitm-annual-fest"));

  // 19. Org posts
  r = await j("/posts", { method: "POST", headers: { Authorization: `Bearer ${b}` }, body: { content: "fake org post", organizationId: String(orgId) } });
  check("org post forbidden", r.status === 403);
  r = await j("/posts", { method: "POST", headers: { Authorization: `Bearer ${a}` }, body: { content: "GITM fest registrations open!", organizationId: String(orgId) } });
  check("org post", r.status === 201 && r.data.post?.organization?.slug === "gitm-events", `status=${r.status}`);
  r = await j("/posts/feed");
  const orgPost = (r.data.posts || []).find((p) => p.organization?.slug === "gitm-events");
  check("feed shows org post", Boolean(orgPost));
  // Bob follows the org → following tab includes org posts even though Bob unfollowed Alice earlier
  r = await j("/posts/feed?tab=following", { headers: { Authorization: `Bearer ${b}` } });
  check("following tab includes org posts", (r.data.posts || []).some((p) => p.organization?.slug === "gitm-events"));

  // 21. Event participants (Alice + Bob register for orgEvent) — before profile stats
  const RegistrationResponse = require("../models/registrationResponse.model");
  await RegistrationResponse.create({ eventId: orgEvent._id, userId: alice._id, status: "confirmed" });
  await RegistrationResponse.create({ eventId: orgEvent._id, userId: bob._id, status: "pending" });
  r = await j(`/events/${String(orgEvent._id)}/participants`);
  check("participants (confirmed only)", r.status === 200 && r.data.participants?.length === 1 && r.data.participants[0]?.firstName === "Alice");

  // 20. Public profile + stats (after registrations exist)
  r = await j(`/users/${String(bob._id)}/profile`);
  check("public profile", r.status === 200 && r.data.user?.firstName === "Bob" && r.data.stats?.eventsRegistered === 1, JSON.stringify(r.data.stats || {}));
  r = await j(`/users/${String(alice._id)}/profile`, { headers: { Authorization: `Bearer ${b}` } });
  // Alice at this point: 2 posts (event post + org post), 1 registration, 0 followers (Bob unfollowed earlier)
  check("profile stats real", r.data.stats?.posts === 2 && r.data.stats?.followers === 0 && r.data.stats?.eventsRegistered === 1, JSON.stringify(r.data.stats || {}));
  r = await j(`/users/${String(alice._id)}/posts`);
  check("user posts", r.status === 200 && r.data.posts?.length === 2 && r.data.posts.some((p) => p.organization?.slug === "gitm-events"));

  console.log(results.join("\n"));
  const fails = results.filter((x) => x.startsWith("❌")).length;
  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILURES"}`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(1); });
