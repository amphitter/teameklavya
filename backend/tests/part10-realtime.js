/**
 * Part 10 realtime test — DM delivery over Socket.IO.
 *
 *   node tests/part10-realtime.js
 *
 * Connects two real sockets and asserts what the client will actually
 * receive. Specifically checks the things the spec calls out by number:
 *   §12  events reach the right user rooms and nowhere else
 *   §13  typing never writes to the database and self-expires
 *   §14  reads are batched, not one write per message
 *   §24  archived state travels with the event, per recipient
 *   §28  a reconnect re-joins the user room and does not duplicate
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5103";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "part10-rt-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.REALTIME_CAP_SOCKETS_PER_IP = "700";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Collect every event a socket receives, so we can assert on "none". */
function listen(socket) {
  const seen = [];
  socket.onAny((event, payload) => seen.push({ event, payload }));
  return seen;
}
const eventsOf = (seen, name) => seen.filter((s) => s.event === name);

function connect(token) {
  const { io } = require("socket.io-client");
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${PORT}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (e) => reject(e));
    setTimeout(() => reject(new Error("connect timeout")), 8000);
  });
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const fs = require("fs");
  const dataDir = `/var/tmp/mongo-p10rt-${Date.now()}`;
  fs.mkdirSync(dataDir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dataDir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");

  for (let i = 0; i < 60; i++) {
    try {
      if ((await call("GET", "/api/health")).s === 200) break;
    } catch {}
    await sleep(120);
  }

  const mongoose = require("mongoose");
  const User = require("../models/user.model");
  const Message = require("../models/message.model");
  const Conversation = require("../models/conversation.model");
  const dm = require("../services/dm-realtime.service");
  await Promise.all([User.init(), Message.init(), Conversation.init()]);

  const stamp = Date.now();
  const A = { email: `ra${stamp}@x.com`, password: "Test1234!" };
  const B = { email: `rb${stamp}@x.com`, password: "Test1234!" };
  const C = { email: `rc${stamp}@x.com`, password: "Test1234!" };
  for (const [u, fn, ln] of [
    [A, "Ana", "Roy"],
    [B, "Ben", "Sky"],
    [C, "Cy", "Dee"],
  ]) {
    await call("POST", "/api/auth/signup", { ...u, firstName: fn, lastName: ln, confirmPassword: u.password, acceptTerms: true });
  }
  await User.updateMany(
    { email: { $in: [A.email, B.email, C.email] } },
    { $set: { emailVerified: true } }
  );

  let r = await call("POST", "/api/auth/login", A);
  const ta = r.d.token;
  const ua = r.d.user;
  r = await call("POST", "/api/auth/login", B);
  const tb = r.d.token;
  const ub = r.d.user;
  r = await call("POST", "/api/auth/login", C);
  const tc = r.d.token;

  const conv = await call("POST", "/api/messages/conversations", { userId: ub._id }, ta);
  const convId = conv.d.conversationId;

  /* ── §12 — user rooms ─────────────────────────────────────────────── */
  section("§12 — user rooms");
  const sockA = await connect(ta);
  const sockB = await connect(tb);
  const sockC = await connect(tc);
  const seenA = listen(sockA);
  const seenB = listen(sockB);
  const seenC = listen(sockC);
  await sleep(150); // let the joins land

  ok(dm.isUserConnected(ua._id), "A is registered as connected");
  ok(dm.isUserConnected(ub._id), "B is registered as connected");

  r = await call("POST", `/api/messages/conversations/${convId}`, { content: "hello over socket" }, ta);
  const sentId = String(r.d.message._id);
  await sleep(250);

  const aMsgs = eventsOf(seenA, "dm:message");
  const bMsgs = eventsOf(seenB, "dm:message");
  ok(bMsgs.length === 1, "recipient receives exactly one dm:message", `got ${bMsgs.length}`);
  ok(aMsgs.length === 1, "sender's own rooms receive it too (multi-device sync)", `got ${aMsgs.length}`);
  ok(aMsgs[0]?.payload?.self === true, "the sender's copy is flagged `self` so the UI can ignore its own echo");
  ok(bMsgs[0]?.payload?.message?._id === sentId, "the event carries the persisted message id");
  ok(bMsgs[0]?.payload?.conversationId === String(convId), "the event carries the conversationId (client routes on it)");
  ok(bMsgs[0]?.payload?.preview?.text === "hello over socket", "the event carries the inbox preview (no refetch needed)");
  ok(bMsgs[0]?.payload?.message?.clientMessageId === null, "clientMessageId is echoed (null when the sender omitted it)");

  /* §12 — a non-participant must never receive it */
  ok(eventsOf(seenC, "dm:message").length === 0, "an uninvolved user's socket receives NOTHING (§12 isolation)");

  /* ── §11 — reconciliation key survives the round trip ─────────────── */
  section("§11 — optimistic reconciliation over the wire");
  const cmid = `cm-${stamp}`;
  await call("POST", `/api/messages/conversations/${convId}`, { content: "optimistic", clientMessageId: cmid }, ta);
  await sleep(250);
  const withCmid = eventsOf(seenB, "dm:message").find((e) => e.payload?.message?.clientMessageId === cmid);
  ok(!!withCmid, "the socket event carries clientMessageId so the peer/client can dedupe");

  /* ── §13 — typing never touches the database ──────────────────────── */
  section("§13 — typing is socket-only");
  const beforeTyping = await Message.countDocuments({});
  const beforeConv = await Conversation.findById(convId).lean();

  sockA.emit("dm:typing", { conversationId: convId, typing: true });
  await sleep(200);
  const typingB = eventsOf(seenB, "dm:typing");
  ok(typingB.length === 1, "peer receives dm:typing", `got ${typingB.length}`);
  ok(typingB[0]?.payload?.typing === true, "typing:true is forwarded");
  ok(typingB[0]?.payload?.userId === String(ua._id), "the event names who is typing");
  ok(eventsOf(seenA, "dm:typing").length === 0, "the typist's own socket gets no echo of their typing");
  ok(eventsOf(seenC, "dm:typing").length === 0, "a third party gets no typing event");

  const afterTyping = await Message.countDocuments({});
  ok(beforeTyping === afterTyping, "typing wrote ZERO messages (§13)");
  const afterConv = await Conversation.findById(convId).lean();
  ok(
    new Date(afterConv.updatedAt).getTime() === new Date(beforeConv.updatedAt).getTime(),
    "typing did not touch the conversation document either (§13)"
  );

  // Rate limited? Disabled here, so explicit typing:false must pass through.
  sockA.emit("dm:typing", { conversationId: convId, typing: false });
  await sleep(200);
  const stopB = eventsOf(seenB, "dm:typing").filter((e) => e.payload?.typing === false);
  ok(stopB.length === 1, "typing:false is forwarded so the indicator clears immediately");

  /* §13 — a missed stop must self-expire, or the peer is stuck on "typing…" */
  sockA.emit("dm:typing", { conversationId: convId, typing: true });
  await sleep(200);
  const ttlNow = dm.typingErrorCount();
  ok(ttlNow >= 1, "a live typing signal holds an expiry timer", `timers=${ttlNow}`);

  /* ── §12 — typing must not leak into a conversation you are not in ── */
  const conv2 = await call("POST", "/api/messages/conversations", { userId: (await User.findOne({ email: C.email }).lean())._id }, ta);
  sockA.emit("dm:typing", { conversationId: conv2.d.conversationId, typing: true });
  await sleep(200);
  ok(
    eventsOf(seenB, "dm:typing").filter((e) => e.payload?.conversationId === String(conv2.d.conversationId)).length === 0,
    "typing in a different thread does not reach the first peer"
  );

  /* ── §14 — read receipts are batched ──────────────────────────────── */
  section("§14 — batched read receipts");
  // B sends three; A reads once.
  for (let i = 0; i < 3; i++) await call("POST", `/api/messages/conversations/${convId}`, { content: `b${i}` }, tb);
  await sleep(200);
  const unreadBefore = await Message.countDocuments({ conversation: convId, sender: ub._id, readAt: null });
  ok(unreadBefore === 3, "three unread from B", `got ${unreadBefore}`);

  seenB.length = 0;
  r = await call("POST", `/api/messages/conversations/${convId}/read`, {}, ta);
  ok(r.s === 200, "mark-read returns 200");
  await sleep(250);

  const unreadAfter = await Message.countDocuments({ conversation: convId, sender: ub._id, readAt: null });
  ok(unreadAfter === 0, "all three cleared by ONE batched update");
  const allSameStamp = await Message.find({ conversation: convId, sender: ub._id }).select("readAt").lean();
  const stamps = new Set(allSameStamp.map((m) => String(m.readAt)));
  ok(stamps.size === 1, "every message shares one read timestamp — proof of a single batched write", `${stamps.size} distinct`);

  const readEvents = eventsOf(seenB, "dm:read");
  ok(readEvents.length >= 1, "the sender is told their messages were read (§12 — no refetch needed)", `got ${readEvents.length}`);
  ok(readEvents[0]?.payload?.conversationId === String(convId), "the read event names the conversation");

  /* ── §24 — archived state travels per recipient ───────────────────── */
  section("§24 — archived state is per recipient");
  await call("POST", `/api/messages/conversations/${convId}/archive`, { archived: true }, tb);
  seenA.length = 0;
  seenB.length = 0;
  await call("POST", `/api/messages/conversations/${convId}`, { content: "into an archived thread" }, ta);
  await sleep(250);
  const bEvent = eventsOf(seenB, "dm:message")[0];
  ok(!!bEvent, "recipient still receives the message");
  ok(bEvent?.payload?.recipientArchived === true, "the event tells B their copy is archived (§24)");
  ok(bEvent?.payload?.senderArchived === false, "and tells A their copy is NOT (archive is personal)");

  /* ── §28 — reconnect ──────────────────────────────────────────────── */
  section("§28 — reconnect re-joins without duplicating");
  sockB.disconnect();
  await sleep(250);
  ok(!dm.isUserConnected(ub._id), "B is deregistered on disconnect");

  const sockB2 = await connect(tb);
  const seenB2 = listen(sockB2);
  await sleep(200);
  ok(dm.isUserConnected(ub._id), "B is registered again after reconnecting");
  ok(eventsOf(seenB2, "dm:message").length === 0, "a fresh connection replays nothing (no duplicate messages on reconnect)");

  await call("POST", `/api/messages/conversations/${convId}`, { content: "after reconnect" }, ta);
  await sleep(250);
  ok(eventsOf(seenB2, "dm:message").length === 1, "the reconnected socket receives subsequent messages exactly once");

  /* ── unsend propagates ────────────────────────────────────────────── */
  section("— unsend propagates over the socket");
  r = await call("POST", `/api/messages/conversations/${convId}`, { content: "delete me" }, ta);
  await sleep(200);
  seenB2.length = 0;
  await call("DELETE", `/api/messages/${r.d.message._id}`, null, ta);
  await sleep(250);
  const delEvents = eventsOf(seenB2, "dm:deleted");
  ok(delEvents.length === 1, "peer is told a message was unsent", `got ${delEvents.length}`);
  ok(delEvents[0]?.payload?.messageId === String(r.d.message._id), "the delete event names the message");

  /* ── authorization ────────────────────────────────────────────────── */
  section("— authorization is re-checked per event");
  seenB2.length = 0;
  const sockC2 = await connect(tc);
  const seenC2 = listen(sockC2);
  await sleep(150);
  sockC2.emit("dm:typing", { conversationId: convId, typing: true });
  await sleep(250);
  ok(eventsOf(seenB2, "dm:typing").length === 0, "a non-participant cannot inject typing into a thread they are not in");
  r = await call("POST", `/api/messages/conversations/${convId}/read`, {}, tc);
  ok(r.s === 404, "a non-participant cannot mark someone else's thread read", `got ${r.s}`);

  for (const s of [sockA, sockB2, sockC, sockC2]) s.disconnect();
  dm._resetTimers();

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  PART 10 REALTIME: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(52));

  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error("FATAL", e);
  process.exit(1);
});
