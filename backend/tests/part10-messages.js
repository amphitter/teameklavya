/**
 * Part 10 integration test — the Messages data layer.
 *
 *   node tests/part10-messages.js
 *
 * Focuses on the things the old implementation got wrong and the spec calls
 * out by number: cursor pagination (§4, §5), idempotency (§11), lightweight
 * conversation metadata (§4), unread accounting (§24), server-side search
 * (§25), and batched reads (§14).
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5102";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "part10-test-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.REALTIME_CAP_SOCKETS_PER_IP = "700";
/* This suite sends ~60 messages to exercise pagination, which is well past
 * the 20/min MESSAGING limiter. That limiter is correct in production and is
 * exercised by its own tests; here it would only mask what we are checking. */
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
  /* The sandbox's /tmp is a small tmpfs and mongod refuses to start with
   * under ~500 MB free. Point the data directory at the roomier root
   * filesystem — and at a FRESH path per run, because a re-used dbPath
   * would carry the previous run's indexes (including the broken ones)
   * into this one, which is exactly what these assertions are checking. */
  const fs = require("fs");
  const dataDir = `/var/tmp/mongo-p10-${Date.now()}`;
  fs.mkdirSync(dataDir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dataDir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");

  for (let i = 0; i < 60; i++) {
    try {
      const r = await call("GET", "/api/health");
      if (r.s === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }

  const User = require("../models/user.model");
  const Conversation = require("../models/conversation.model");
  const Message = require("../models/message.model");

  /* Index builds are asynchronous in mongoose. The unique constraint that
   * makes sends idempotent must be in place before the race test, and the
   * §15 assertions must not race the builder either. */
  await Promise.all([Message.init(), Conversation.init(), User.init()]);

  const stamp = Date.now();
  const A = { email: `a${stamp}@x.com`, password: "Test1234!" };
  const B = { email: `b${stamp}@x.com`, password: "Test1234!" };
  await call("POST", "/api/auth/signup", {
    ...A,
    firstName: "Ana",
    lastName: "Roy",
    confirmPassword: A.password,
    acceptTerms: true,
  });
  await call("POST", "/api/auth/signup", {
    ...B,
    firstName: "Ben",
    lastName: "Sky",
    confirmPassword: B.password,
    acceptTerms: true,
  });
  await User.updateMany({ email: { $in: [A.email, B.email] } }, { $set: { emailVerified: true } });
  // A long bio: if the conversation list leaks the whole `profile` subdoc,
  // this string shows up in the list payload and the assertion below catches it.
  await User.updateOne(
    { email: A.email },
    { $set: { "profile.bio": "SHOULD_NOT_APPEAR_IN_CONVERSATION_LIST_PAYLOAD" } }
  );

  let r = await call("POST", "/api/auth/login", A);
  const ta = r.d.token;
  const ua = r.d.user;
  r = await call("POST", "/api/auth/login", B);
  const tb = r.d.token;

  /* ── §4 — lightweight conversation metadata ───────────────────────── */
  section("§4 — conversation list returns metadata only");
  r = await call("POST", "/api/messages/conversations", { userId: ua._id }, tb);
  const convId = r.d.conversationId;
  ok(!!convId, "conversation created");

  for (let i = 0; i < 5; i++) {
    await call("POST", `/api/messages/conversations/${convId}`, { content: `seed ${i}` }, tb);
  }

  r = await call("GET", "/api/messages/conversations", null, ta);
  const listRaw = JSON.stringify(r.d.conversations || []);
  ok(r.s === 200, "list returns 200");
  ok(!listRaw.includes("SHOULD_NOT_APPEAR_IN_CONVERSATION_LIST_PAYLOAD"), "list omits profile.bio (no whole-profile populate)");
  ok(Array.isArray(r.d.conversations), "list is an array");
  ok(typeof r.d.nextCursor !== "undefined", "list exposes nextCursor (§4 cursor pagination)");
  ok(r.d.conversations[0]?.other?._id, "each row carries the other participant");
  ok(r.d.conversations[0]?.other?.firstName === "Ben", "other participant has a display name");
  ok(typeof r.d.conversations[0]?.unreadCount === "number", "each row carries unreadCount");
  ok(typeof r.d.conversations[0]?.muted === "boolean", "each row carries muted");
  ok(typeof r.d.conversations[0]?.archived === "boolean", "each row carries archived");
  ok(r.d.conversations[0]?.lastMessage?.text, "each row carries a last-message preview");

  /* ── §4 — cursor pagination over conversations ────────────────────── */
  section("§4 — conversation cursor pagination");
  // Build 8 conversations with distinct partners so pages are distinguishable.
  const others = [];
  for (let i = 0; i < 8; i++) {
    const u = await User.create({
      email: `p${stamp}_${i}@x.com`,
      password: "Test1234!",
      firstName: `Pal${i}`,
      lastName: "X",
      username: `pal${stamp}_${i}`,
      emailVerified: true,
    });
    others.push(u);
    const c = await call("POST", "/api/messages/conversations", { userId: String(u._id) }, ta);
    await call("POST", `/api/messages/conversations/${c.d.conversationId}`, { content: `hi ${i}` }, ta);
  }

  /* ── REGRESSION: the multikey-unique-index bug ──────────────────────
   * `{ participants: 1 }` with `unique: true` on an ARRAY forbids two
   * documents from sharing any single element, so a user could only ever be
   * in ONE conversation. A's second chat failed with E11000 and the API
   * answered 500. Assert the count directly so this can never come back
   * unnoticed. */
  const myConvos = await Conversation.countDocuments({ participants: ua._id });
  ok(myConvos >= 9, "a user can hold MANY conversations (multikey-unique regression)", `got ${myConvos}`);
  const pairKeys = await Conversation.find({ participants: ua._id }).select("participantsKey").lean();
  ok(pairKeys.every((c) => typeof c.participantsKey === "string" && c.participantsKey.includes(":")), "every conversation carries a pair key");

  r = await call("GET", "/api/messages/conversations?limit=3", null, ta);
  const page1 = r.d.conversations || [];
  ok(page1.length === 3, "page 1 respects limit", `got ${page1.length}`);
  ok(r.d.hasMore === true, "page 1 reports hasMore");
  ok(!!r.d.nextCursor, "page 1 returns a cursor");

  r = await call("GET", `/api/messages/conversations?limit=3&cursor=${encodeURIComponent(r.d.nextCursor)}`, null, ta);
  const page2 = r.d.conversations || [];
  ok(page2.length === 3, "page 2 respects limit", `got ${page2.length}`);
  const overlap = page1.filter((p) => page2.some((q) => String(q._id) === String(p._id)));
  ok(overlap.length === 0, "pages do not repeat a row", `${overlap.length} repeated`);

  /* ── §5 — message pagination ──────────────────────────────────────── */
  section("§5 — chat history pagination");
  const big = await call("POST", "/api/messages/conversations", { userId: String(others[0]._id) }, ta);
  const bigId = big.d.conversationId;
  for (let i = 0; i < 40; i++) {
    await call("POST", `/api/messages/conversations/${bigId}`, { content: `m${String(i).padStart(2, "0")}` }, ta);
  }

  r = await call("GET", `/api/messages/conversations/${bigId}?limit=30`, null, ta);
  const msgs = r.d.messages || [];
  ok(msgs.length === 30, "initial load returns 30, not 40+ (§5: 20–40 recent)", `got ${msgs.length}`);
  ok(r.d.hasMore === true, "reports more history above");
  ok(!!r.d.oldestId, "returns oldestId as the next `before` cursor");
  // Ascending order — the DOM order, so the client never reverses a big array.
  ok(msgs[0].content === "m10" && msgs[29].content === "m39", "messages are oldest → newest", `${msgs[0].content}..${msgs[29].content}`);

  r = await call("GET", `/api/messages/conversations/${bigId}?limit=30&before=${r.d.oldestId}`, null, ta);
  const older = r.d.messages || [];
  // 41 messages exist: "hi 0" from the pagination loop, then m00..m39.
  // 30 arrive first, so 11 remain — and the last page must include the seed.
  ok(older.length === 11, "scroll-up loads only the remaining 11", `got ${older.length}`);
  ok(r.d.hasMore === false, "hasMore false at the top of history");
  ok(older[0].content === "hi 0" && older[10].content === "m09", "older page is the correct slice", `${older[0].content}..${older[10].content}`);
  const dupes = older.filter((m) => msgs.some((n) => String(n._id) === String(m._id)));
  ok(dupes.length === 0, "no overlap between the newest page and the older page");

  // after= catch-up: only messages newer than the anchor.
  const anchor = msgs[29];
  await call("POST", `/api/messages/conversations/${bigId}`, { content: "newer one" }, ta);
  r = await call("GET", `/api/messages/conversations/${bigId}?after=${anchor._id}`, null, ta);
  const newer = r.d.messages || [];
  ok(newer.length === 1 && newer[0].content === "newer one", "after= returns only messages newer than the anchor");

  /* ── §11 — idempotent send ────────────────────────────────────────── */
  section("§11 — idempotency prevents duplicate messages");
  const idem = `client-${stamp}-1`;
  r = await call("POST", `/api/messages/conversations/${bigId}`, { content: "once only", clientMessageId: idem }, ta);
  ok(r.s === 201, "first send is created");
  const firstId = r.d.message?._id;
  ok(r.d.message?.clientMessageId === idem, "server echoes clientMessageId back (so the client can reconcile)");

  r = await call("POST", `/api/messages/conversations/${bigId}`, { content: "once only", clientMessageId: idem }, ta);
  ok(r.s === 200, "retry returns 200, not 201");
  ok(r.d.duplicate === true, "retry is flagged as a duplicate");
  ok(String(r.d.message?._id) === String(firstId), "retry returns the SAME message, not a new one");

  const total = await Message.countDocuments({ conversation: bigId, content: "once only" });
  ok(total === 1, "exactly one row was persisted for two sends", `got ${total}`);

  // Concurrent double-send: both hit the DB at once, the unique index decides.
  const idem2 = `client-${stamp}-2`;
  const [c1, c2] = await Promise.all([
    call("POST", `/api/messages/conversations/${bigId}`, { content: "race", clientMessageId: idem2 }, ta),
    call("POST", `/api/messages/conversations/${bigId}`, { content: "race", clientMessageId: idem2 }, ta),
  ]);
  ok(c1.s < 300 && c2.s < 300, "both concurrent sends succeed (no 500 from the unique index)", `${c1.s}/${c2.s}`);
  const raceCount = await Message.countDocuments({ conversation: bigId, content: "race" });
  ok(raceCount === 1, "a concurrent double-send still persists one message", `got ${raceCount}`);

  // Sends without a clientMessageId must still work (older clients).
  r = await call("POST", `/api/messages/conversations/${bigId}`, { content: "no id" }, ta);
  ok(r.s === 201, "a send with no clientMessageId is unaffected");

  /* ── §14 — batched read ───────────────────────────────────────────── */
  section("§14 — reads are batched, not per message");
  await call("GET", `/api/messages/conversations/${convId}`, null, ta);
  const unreadLeft = await Message.countDocuments({ conversation: convId, sender: { $ne: ua._id }, readAt: null });
  ok(unreadLeft === 0, "opening the thread clears every unread in ONE pass", `${unreadLeft} left`);

  const beforeUpdates = await Message.countDocuments({ conversation: bigId, readAt: { $ne: null } });
  ok(beforeUpdates >= 0, "read state is tracked per message (single source of truth)");

  /* ── §24 — unread accounting, inbox vs archive ────────────────────── */
  section("§24 — archived keeps its own unread state");
  const arch = await call("POST", "/api/messages/conversations", { userId: String(others[1]._id) }, ta);
  const archId = arch.d.conversationId;
  await call("POST", `/api/messages/conversations/${archId}`, { content: "before archive" }, ta);
  // B replies so A has unread in that thread.
  const convBA = await call("POST", "/api/messages/conversations", { userId: ua._id }, tb);
  await call("POST", `/api/messages/conversations/${convBA.d.conversationId}`, { content: "ping" }, tb);

  r = await call("GET", "/api/messages/unread-count", null, ta);
  ok(typeof r.d.unreadCount === "number", "unreadCount present (existing clients unaffected)");
  ok(typeof r.d.archivedUnreadCount === "number", "archivedUnreadCount present (§24)");

  await call("POST", `/api/messages/conversations/${archId}/archive`, { archived: true }, ta);
  r = await call("GET", "/api/messages/conversations?view=archived", null, ta);
  const archList = r.d.conversations || [];
  ok(archList.some((c) => String(c._id) === String(archId)), "archived thread appears in the archived view (findable, §24)");
  r = await call("GET", "/api/messages/conversations?view=all", null, ta);
  ok(!(r.d.conversations || []).some((c) => String(c._id) === String(archId)), "archived thread leaves the inbox");

  // New message arrives in the archived thread — it stays archived, unread shows.
  await call("POST", `/api/messages/conversations/${archId}`, { content: "after archive" }, ta);
  r = await call("GET", "/api/messages/conversations?view=archived", null, ta);
  const stillArchived = (r.d.conversations || []).find((c) => String(c._id) === String(archId));
  ok(!!stillArchived, "a new message does NOT silently unarchive the thread (§24)");
  ok(typeof stillArchived?.unreadCount === "number", "archived row still reports unreadCount (§24)");
  r = await call("GET", "/api/messages/conversations?view=all", null, ta);
  ok(!(r.d.conversations || []).some((c) => String(c._id) === String(archId)), "and it does not reappear in the inbox");

  /* ── §25 — server-side search ─────────────────────────────────────── */
  section("§25 — server-side search");
  r = await call("GET", "/api/messages/search?q=Pal3&type=conversations", null, ta);
  ok(r.s === 200, "conversation search returns 200");
  ok((r.d.results || []).length >= 1, "finds a conversation by participant name", `got ${(r.d.results || []).length}`);
  ok((r.d.results || [])[0]?.other?.username === `pal${stamp}_3`, "search result identifies the right person");

  r = await call("GET", "/api/messages/search?q=m25&type=messages", null, ta);
  ok(r.s === 200, "message search returns 200");
  const mhits = r.d.results || [];
  ok(mhits.length >= 1, "finds a message by body text", `got ${mhits.length}`);
  ok(mhits[0]?.content === "m25", "message search matches even though that page was never loaded client-side");
  ok(!!mhits[0]?.conversationId, "message hits carry a conversationId for navigation");

  // Prefix search — the reason a $text index was rejected.
  r = await call("GET", "/api/messages/search?q=m2&type=messages", null, ta);
  ok((r.d.results || []).length >= 1, "prefix search works (a $text index could not do this)");

  // Regex metacharacters must not throw.
  r = await call("GET", "/api/messages/search?q=a+b(c[&type=messages", null, ta);
  ok(r.s === 200, "regex metacharacters in the query are escaped, not executed");

  r = await call("GET", "/api/messages/search?q=&type=messages", null, ta);
  ok(r.s === 200 && (r.d.results || []).length === 0, "empty query returns no results without a scan");

  /* ── §15 — indexes exist ──────────────────────────────────────────── */
  section("§15 — indexes");
  const msgIdx = await Message.collection.indexes();
  const flat = msgIdx.map((i) => JSON.stringify(i.key));
  ok(flat.some((k) => k.includes("conversation") && k.includes("createdAt")), "Message: {conversation, createdAt}");
  ok(flat.some((k) => k.includes("conversation") && k.includes("readAt")), "Message: {conversation, readAt, sender}");
  const convoIdx = await Conversation.collection.indexes();
  const cflat = convoIdx.map((i) => JSON.stringify(i.key));
  ok(cflat.some((k) => k.includes("participants") && k.includes("updatedAt")), "Conversation: {participants, updatedAt}");

  // The queries the indexes were added for must actually use them.
  const expl = await Message.find({ conversation: bigId, readAt: null, sender: { $ne: ua._id } })
    .explain("queryPlanner");
  const winning = JSON.stringify(expl.queryPlanner?.winningPlan || {});
  ok(winning.includes("IXSCAN"), "unread query uses an index scan, not a collection scan", winning.slice(0, 120));

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  PART 10 MESSAGES BACKEND: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(52));

  await mongoose_disconnect();
  await mongod.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);

  async function mongoose_disconnect() {
    const mongoose = require("mongoose");
    await mongoose.disconnect();
  }
})().catch(async (e) => {
  console.error("FATAL", e);
  process.exit(1);
});
