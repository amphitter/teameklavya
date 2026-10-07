/**
 * Part 11 — teams (group conversations) and presence.
 *
 *   node tests/part11-teams.js
 *
 * Teams are the product's replacement for "groups": a named conversation
 * assembled from your followers, the people you follow, or anyone else on the
 * app. These assertions pin down the membership rules, the permission model,
 * and the fact that a team is a real multi-party conversation rather than a
 * direct chat with a bigger participant list.
 *
 * Presence is asserted over real sockets: online is derived from live sockets,
 * lastSeenAt is durable, and neither writes a row on every connect.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5105";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "part11-test-secret";
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
    socket.on("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 8000);
  });
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const fs = require("fs");
  const dataDir = `/var/tmp/mongo-p11-${Date.now()}`;
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
  const Conversation = require("../models/conversation.model");
  const Message = require("../models/message.model");
  const dm = require("../services/dm-realtime.service");
  await Promise.all([User.init(), Conversation.init(), Message.init()]);

  const stamp = Date.now();
  const mk = (tag) => ({ email: `${tag}${stamp}@x.com`, password: "Test1234!" });
  const A = mk("a"), B = mk("b"), C = mk("c"), D = mk("d");
  const people = [
    [A, "Ana", "Roy"],
    [B, "Ben", "Sky"],
    [C, "Cy", "Dee"],
    [D, "Dia", "Fox"],
  ];
  for (const [u, fn, ln] of people) {
    await call("POST", "/api/auth/signup", { ...u, firstName: fn, lastName: ln, confirmPassword: u.password, acceptTerms: true });
  }
  await User.updateMany(
    { email: { $in: [A.email, B.email, C.email, D.email] } },
    { $set: { emailVerified: true } }
  );

  let r = await call("POST", "/api/auth/login", A);
  const ta = r.d.token, ua = r.d.user;
  r = await call("POST", "/api/auth/login", B);
  const tb = r.d.token, ub = r.d.user;
  r = await call("POST", "/api/auth/login", C);
  const tc = r.d.token, uc = r.d.user;
  r = await call("POST", "/api/auth/login", D);
  const td = r.d.token, ud = r.d.user;

  /* ── Following, so "add from followers/following" has real data ──── */
  section("setup — A follows B, B follows A, C is a stranger");
  await call("POST", `/api/follow/${ub._id}`, {}, ta);
  await call("POST", `/api/follow/${ua._id}`, {}, tb);
  r = await call("GET", `/api/follow/${ua._id}/followers`, null, ta);
  ok(r.s === 200, "followers list loads (the member picker's source)");
  r = await call("GET", `/api/follow/${ua._id}/following`, null, ta);
  ok(r.s === 200, "following list loads");
  r = await call("GET", `/api/search?q=Cy&type=people`, null, ta);
  ok(r.s === 200 && Array.isArray(r.d.people), "'anyone on the app' search works (member picker's third tab)");

  /* ── Create ───────────────────────────────────────────────────────── */
  section("teams — create");
  r = await call("POST", "/api/messages/teams", { name: "", memberIds: [ub._id] }, ta);
  ok(r.s === 400, "a team with no name is refused", `${r.s}`);

  r = await call("POST", "/api/messages/teams", { name: "Hack Night", memberIds: [] }, ta);
  ok(r.s === 400, "a team with no members is refused (not a note-to-self)", `${r.s}`);

  r = await call("POST", "/api/messages/teams", { name: "Hack Night", memberIds: [ub._id, uc._id] }, ta);
  ok(r.s === 201, "a team is created", `${r.s}`);
  const teamId = r.d.conversationId;
  ok(!!teamId, "creation returns the conversation id");
  ok(r.d.team?.name === "Hack Night", "the team carries its name");
  ok(r.d.team?.memberCount === 3, "the team holds creator + invitees", `${r.d.team?.memberCount}`);
  ok(r.d.team?.myRole === "owner", "the creator is the owner");
  ok(r.d.team?.type === "team", "the row is typed as a team, not a direct chat");

  const teamDoc = await Conversation.findById(teamId).lean();
  ok(teamDoc.type === "team", "persisted with type=team");
  ok(!teamDoc.participantsKey, "a team has NO pair key (its roster changes, so it must not be pair-unique)");
  ok(String(teamDoc.owner) === String(ua._id), "owner persisted");

  // The creator must not be duplicated if they list themselves.
  r = await call("POST", "/api/messages/teams", { name: "Self", memberIds: [ua._id, ub._id] }, ta);
  ok(r.d.team?.memberCount === 2, "listing yourself as a member does not duplicate you");

  /* ── Appears for everyone ─────────────────────────────────────────── */
  section("teams — visible to every member");
  for (const [label, token, uid] of [["creator", ta, ua._id], ["member B", tb, ub._id], ["member C", tc, uc._id]]) {
    r = await call("GET", "/api/messages/conversations", null, token);
    const row = (r.d.conversations || []).find((c) => String(c._id) === String(teamId));
    ok(!!row, `${label} sees the team in their inbox`);
    ok(row?.type === "team" && row?.name === "Hack Night", `${label}'s row carries the team name`);
    ok(row?.presence === null, `${label}'s row has no presence (meaningless for a set of people)`);
  }
  r = await call("GET", "/api/messages/conversations", null, td);
  ok(!(r.d.conversations || []).some((c) => String(c._id) === String(teamId)), "a non-member sees NOTHING about the team");

  /* ── Message fan-out ──────────────────────────────────────────────── */
  section("teams — messages reach every member");
  r = await call("POST", `/api/messages/conversations/${teamId}`, { content: "standup at 6" }, ta);
  ok(r.s === 201, "a message sends to the team");

  r = await call("GET", `/api/messages/conversations/${teamId}`, null, tb);
  ok(r.s === 200, "a member can open the team");
  ok(r.d.type === "team", "the thread reports its type");
  ok(r.d.team?.memberCount === 3, "the thread reports the roster size");
  ok((r.d.team?.members || []).length === 3, "the thread returns the roster for sender labels");
  ok(r.d.other === null, "a team thread has no single 'other' participant");
  ok(
    (r.d.team?.members || []).length === 3 && (r.d.team.members || []).every((m) => m.firstName),
    "the thread carries the FULL roster with names (sender labels and typing names need it)"
  );
  ok(r.d.messages?.[0]?.sender?.firstName === "Ana", "each message carries its actual sender (so bubbles can name them)");

  r = await call("GET", `/api/messages/conversations/${teamId}`, null, td);
  ok(r.s === 404, "a non-member cannot open the team", `${r.s}`);
  r = await call("POST", `/api/messages/conversations/${teamId}`, { content: "intruder" }, td);
  ok(r.s === 404, "a non-member cannot post to the team", `${r.s}`);

  /* ── Permissions ──────────────────────────────────────────────────── */
  section("teams — permissions");
  r = await call("POST", `/api/messages/teams/${teamId}/members`, { userIds: [ud._id] }, tc);
  ok(r.s === 403, "a plain member cannot add people", `${r.s}`);
  r = await call("GET", `/api/messages/teams/${teamId}/members`, null, ta);
  ok(r.s === 200, "the roster loads");
  ok((r.d.members || []).every((m) => ["owner", "admin", "member"].includes(m.role)), "every member carries a role (the client badges from data, not list order)");
  ok(String(r.d.members?.[0]?._id) === String(ua._id) && r.d.members[0].role === "owner", "the owner leads the roster and is marked as such");

  r = await call("POST", `/api/messages/teams/${teamId}/members`, { userIds: [ud._id] }, ta);
  ok(r.s === 200 && r.d.added === 1, "the owner can add a member");
  r = await call("GET", `/api/messages/teams/${teamId}/members`, null, ta);
  const newcomer = (r.d.members || []).find((m) => String(m._id) === String(ud._id));
  ok(newcomer?.role === "member", "someone added is a plain member, not an admin");
  r = await call("GET", "/api/messages/conversations", null, td);
  ok((r.d.conversations || []).some((c) => String(c._id) === String(teamId)), "the new member's inbox gains the team");

  r = await call("POST", `/api/messages/teams/${teamId}/members`, { userIds: [ud._id] }, ta);
  ok(r.d.added === 0, "adding someone already in the team is a no-op, not a duplicate");

  r = await call("DELETE", `/api/messages/teams/${teamId}/members/${uc._id}`, null, tb);
  ok(r.s === 403, "a plain member cannot remove someone else", `${r.s}`);
  r = await call("DELETE", `/api/messages/teams/${teamId}/members/${ua._id}`, null, tb);
  ok(r.s === 403, "nobody can remove the owner", `${r.s}`);
  r = await call("DELETE", `/api/messages/teams/${teamId}/members/${uc._id}`, null, ta);
  ok(r.s === 200, "the owner can remove a member");
  r = await call("GET", "/api/messages/conversations", null, tc);
  ok(!(r.d.conversations || []).some((c) => String(c._id) === String(teamId)), "the removed member loses the team");
  r = await call("GET", `/api/messages/conversations/${teamId}`, null, tc);
  ok(r.s === 404, "and can no longer read it", `${r.s}`);

  r = await call("DELETE", `/api/messages/teams/${teamId}/members/${uc._id}`, null, ta);
  ok(r.s === 404, "removing someone who is not a member is a clean 404", `${r.s}`);

  r = await call("PATCH", `/api/messages/teams/${teamId}`, { name: "Renamed" }, tc);
  ok(r.s === 404, "a non-member cannot rename the team", `${r.s}`);
  r = await call("PATCH", `/api/messages/teams/${teamId}`, { name: "" }, ta);
  ok(r.s === 400, "a team cannot be renamed to empty", `${r.s}`);
  r = await call("PATCH", `/api/messages/teams/${teamId}`, { name: "Hack Night 2026" }, ta);
  ok(r.s === 200 && r.d.team.name === "Hack Night 2026", "the owner can rename the team");

  /* ── Direct chats are untouched ───────────────────────────────────── */
  section("teams — direct conversations still behave");
  r = await call("POST", "/api/messages/conversations", { userId: ub._id }, ta);
  const dmId = r.d.conversationId;
  ok(!!dmId, "a direct conversation is created alongside teams");
  r = await call("GET", "/api/messages/conversations", null, ta);
  const dmRow = (r.d.conversations || []).find((c) => String(c._id) === String(dmId));
  ok(dmRow?.type === "direct", "the direct row is typed as direct");
  ok(dmRow?.name === null, "a direct row has no team name");
  ok(dmRow?.other?._id, "a direct row still carries the other participant");
  ok(dmRow?.presence && typeof dmRow.presence.online === "boolean", "a direct row carries presence");

  ok(dmId !== teamId, "the direct chat did NOT resolve to the 2-person team (the pair lookup ignores teams)");
  const dmDoc = await Conversation.findById(dmId).lean();
  ok(typeof dmDoc.participantsKey === "string" && dmDoc.participantsKey.includes(":"), "the direct pair key still exists");
  r = await call("POST", `/api/messages/conversations/${dmId}`, { content: "hi" }, ta);
  ok(r.d.archived === false, "the direct send path is unchanged");

  /* ── Team search ──────────────────────────────────────────────────── */
  section("teams — searchable by name");
  r = await call("GET", "/api/messages/search?q=Hack%20Night&type=conversations", null, ta);
  ok((r.d.results || []).some((x) => String(x._id) === String(teamId)), "a member finds the team by name");
  r = await call("GET", "/api/messages/search?q=Hack%20Night&type=conversations", null, td);
  ok((r.d.results || []).some((x) => String(x._id) === String(teamId)), "every member finds it, not just the owner");
  r = await call("GET", "/api/messages/search?q=Hack%20Night&type=conversations", null, tc);
  ok(!(r.d.results || []).some((x) => String(x._id) === String(teamId)), "someone who was removed cannot find it");

  /* ── Realtime fan-out ─────────────────────────────────────────────── */
  section("teams & presence — over sockets");
  const sockA = await connect(ta);
  const sockB = await connect(tb);
  const sockD = await connect(td);
  const seenA = listen(sockA);
  const seenB = listen(sockB);
  const seenD = listen(sockD);
  await sleep(200);

  r = await call("POST", `/api/messages/conversations/${teamId}`, { content: "ping everyone" }, ta);
  await sleep(250);
  ok(eventsOf(seenB, "dm:message").length === 1, "member B receives the team message", `${eventsOf(seenB, "dm:message").length}`);
  ok(eventsOf(seenD, "dm:message").length === 1, "member D receives it too (fan-out, not one recipient)");
  ok(eventsOf(seenB, "dm:message")[0]?.payload?.teamName === "Hack Night 2026", "the event names the team");
  ok(!!eventsOf(seenB, "dm:message")[0]?.payload?.preview?.senderName, "the event names WHO spoke (team rows need it)");

  // Typing in a team reaches every other member.
  seenB.length = 0;
  seenD.length = 0;
  sockA.emit("dm:typing", { conversationId: teamId, typing: true });
  await sleep(250);
  ok(eventsOf(seenB, "dm:typing").length === 1, "typing reaches member B");
  ok(eventsOf(seenD, "dm:typing").length === 1, "typing reaches member D");

  /* ── Presence ─────────────────────────────────────────────────────── */
  section("presence — active / last seen");
  ok(dm.isUserOnline(ub._id), "B is online while holding a socket");

  sockA.emit("dm:watch", { conversationId: dmId });
  await sleep(250);
  const presenceEvents = eventsOf(seenA, "dm:presence").filter((e) => e.payload?.userId === String(ub._id));
  ok(presenceEvents.length >= 1, "watching a thread immediately reports the peer's presence", `${presenceEvents.length}`);
  ok(presenceEvents.some((e) => e.payload.online === true), "and reports them as active now");

  seenA.length = 0;
  sockB.disconnect();
  await sleep(350);
  const offline = eventsOf(seenA, "dm:presence").find((e) => e.payload?.userId === String(ub._id));
  ok(!!offline, "the watcher is told when the peer goes away");
  ok(offline?.payload?.online === false, "the transition is reported as offline");
  ok(!!offline?.payload?.lastSeenAt, "it carries the last-seen timestamp (§ active/last seen)");

  const stored = await User.findById(ub._id).select("lastSeenAt").lean();
  ok(!!stored?.lastSeenAt, "last seen is PERSISTED, not just broadcast (it survives a restart)");

  // A non-watcher must not receive another pair's presence.
  seenD.length = 0;
  const sockB2 = await connect(tb);
  await sleep(300);
  ok(eventsOf(seenD, "dm:presence").length === 0, "presence is scoped — a third party learns nothing");

  // Two sockets for one user is still one online user.
  const sockB3 = await connect(tb);
  await sleep(200);
  seenA.length = 0;
  sockB2.disconnect();
  await sleep(300);
  const stillOnline = (eventsOf(seenA, "dm:presence") || []).some((e) => e.payload?.online === true);
  ok(!stillOnline, "closing one of a user's two sockets does NOT mark them offline");

  r = await call("GET", `/api/messages/conversations/${dmId}`, null, ta);
  ok(r.d.presence && typeof r.d.presence.online === "boolean", "opening a thread returns the peer's presence");
  sockB3.disconnect();

  /* ── The inbox batch watch ──────────────────────────────────────────
   * The list already has each row's presence from its REST read, so its
   * watch must register WITHOUT the per-conversation state burst — and it
   * must still deliver transitions, or the dots freeze. */
  section("presence — the batched inbox watch");
  r = await call("POST", "/api/messages/conversations", { userId: uc._id }, ta);
  const dmAC = r.d.conversationId;

  const sockA2 = await connect(ta);
  const seenA2 = listen(sockA2);
  await sleep(200);
  sockA2.emit("dm:watch", { conversationIds: [dmId, dmAC], silent: true });
  await sleep(300);
  ok(eventsOf(seenA2, "dm:presence").length === 0, "a silent batch watch does not spend a state burst on the list");

  // Watching a conversation this user is not in must do nothing at all.
  sockA2.emit("dm:watch", { conversationIds: ["64b000000000000000000000"], silent: true });
  await sleep(200);
  ok(eventsOf(seenA2, "dm:presence").length === 0, "watching a conversation you are not in is ignored silently");

  const sockC = await connect(tc);
  await sleep(400);
  const cOnline = eventsOf(seenA2, "dm:presence").filter((e) => e.payload?.userId === String(uc._id));
  ok(cOnline.length >= 1 && cOnline.some((e) => e.payload.online === true), "but a transition DOES arrive for a batched watch (the dot stays truthful)");
  sockC.disconnect();
  sockA2.disconnect();

  for (const s of [sockA, sockD]) s.disconnect();
  dm._resetTimers();

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  PART 11 TEAMS + PRESENCE: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(52));

  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error("FATAL", e);
  process.exit(1);
});
