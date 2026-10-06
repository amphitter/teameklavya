#!/usr/bin/env node
/**
 * EventHub — Part 5, Phase 6 selftest (realtime hardening)
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers spec §43 (connection caps + stale-socket sweep), §44 (backpressure:
 * throttles documented, correctness never coalesced) and §45 (state
 * reconstruction on reconnect/late join).
 *
 * Boots the real server + Socket.IO against an in-memory MongoDB and lowers
 * the caps through the env so a handful of sockets can prove the ceiling.
 *
 * Run: npm run test:phase6
 */
"use strict";

/* Caps are read once when config/rate-limits.js is first required, so they
 * must be set before anything pulls the module in. */
process.env.NODE_ENV = "test";
process.env.PORT = 5321;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";

const CAP_USER = 3;
const CAP_IP = 6;
const CAP_ROOM = 2;
const TTL_MS = 60_000;
process.env.REALTIME_CAP_SOCKETS_PER_USER = String(CAP_USER);
process.env.REALTIME_CAP_SOCKETS_PER_IP = String(CAP_IP);
process.env.REALTIME_CAP_PARTICIPANTS_PER_ROOM = String(CAP_ROOM);
process.env.REALTIME_CAP_IDLE_ROOM_TTL_MS = String(TTL_MS);
process.env.REALTIME_CAP_SWEEP_INTERVAL_MS = "600000"; // never fires mid-test

const { MongoMemoryServer } = require("mongodb-memory-server");
const { io } = require("socket.io-client");

/* ── harness ─────────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures = [];
let section = "";

function sec(name) {
  section = name;
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 58 - name.length))}`);
}

function ok(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(`[${section}] ${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(label, actual, expected) {
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();

  const User = require("../models/user.model");
  const Event = require("../models/event.model");
  const Activity = require("../models/activity.model");
  const Question = require("../models/question.model");
  const ParticipantSession = require("../models/participantSession.model");
  const jwt = require("jsonwebtoken");

  require("../server");
  const realtime = require("../services/realtime.service");
  const { REALTIME_CAPS } = require("../config/rate-limits");
  const { ERROR_CODES } = require("../config/socket-protocol");
  const { EVENTS } = require("../config/socket-protocol");

  // The sweep timer started by init() would race the sweep assertions.
  realtime.stopStaleSocketSweep();

  const B = `http://localhost:${process.env.PORT}/api`;
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${B}/events`); break; } catch { await wait(300); }
  }

  const mint = (u) => jwt.sign({ id: String(u._id), role: u.role || "user", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });

  /* ── socket helper ──
   * Resolves "connected" or "rejected" (server closed the socket), and records
   * any structured S_ERROR the server managed to emit first. */
  const opened = [];
  function connect(token) {
    const socket = io(`http://localhost:${process.env.PORT}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });
    const rec = { socket, errors: [], connected: false, rejected: false };
    socket.on("connect", () => { rec.connected = true; });
    socket.on("disconnect", (reason) => { rec.rejected = true; rec.reason = reason; });
    socket.on(EVENTS.S_ERROR, (p) => rec.errors.push(p));
    socket.on("connect_error", (e) => { rec.rejected = true; rec.connectError = e.message; });
    rec.settled = new Promise((resolve) => {
      const done = (v) => { if (!rec._s) { rec._s = true; resolve(v); } };
      socket.on("connect", () => done("connected"));
      socket.on("disconnect", () => done("rejected"));
      socket.on("connect_error", () => done("rejected"));
      setTimeout(() => done("timeout"), 4000);
    });

    /* A capped socket CONNECTS first and is only then closed by the server,
     * so `settled` alone always reports "connected". This waits for the
     * follow-up: either the structured cap error or the server-side close. */
    rec.kicked = new Promise((resolve) => {
      const done = (v) => { if (!rec._k) { rec._k = true; resolve(v); } };
      socket.on(EVENTS.S_ERROR, (payload) => {
        if (payload && payload.code === ERROR_CODES.TOO_MANY_CONNECTIONS) done("capped");
      });
      socket.on("disconnect", (reason) => done(reason || "disconnected"));
      socket.on("connect_error", (e) => done(e.message));
      setTimeout(() => done(false), 3000);
    });
    opened.push(rec);
    return rec;
  }

  const emitAck = (socket, event, payload, timeout = 5000) =>
    new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ack: null, error: null, timeout: true }), timeout);
      socket.emit(event, payload, (ack) => { clearTimeout(t); resolve({ ack: ack || null }); });
    });

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. Config surface (§43)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("1. Caps configuration (§43)");

  eq("env override applied — per-user cap", REALTIME_CAPS.SOCKETS_PER_USER, CAP_USER);
  eq("env override applied — per-IP cap", REALTIME_CAPS.SOCKETS_PER_IP, CAP_IP);
  eq("env override applied — room cap", REALTIME_CAPS.PARTICIPANTS_PER_ROOM, CAP_ROOM);
  ok("per-IP cap exceeds per-user cap (a NAT'd network is legitimate)",
    REALTIME_CAPS.SOCKETS_PER_IP > REALTIME_CAPS.SOCKETS_PER_USER);
  ok("room cap is bounded", REALTIME_CAPS.PARTICIPANTS_PER_ROOM > 0);
  ok("idle room TTL is positive", REALTIME_CAPS.IDLE_ROOM_TTL_MS > 0);
  ok("sweep interval is positive", REALTIME_CAPS.SWEEP_INTERVAL_MS > 0);

  ok("TOO_MANY_CONNECTIONS is a distinct error code", ERROR_CODES.TOO_MANY_CONNECTIONS === "TOO_MANY_CONNECTIONS");
  ok("ROOM_FULL is a distinct error code", ERROR_CODES.ROOM_FULL === "ROOM_FULL");
  ok("caps are distinct from RATE_LIMITED (client can tell them apart)",
    ERROR_CODES.TOO_MANY_CONNECTIONS !== ERROR_CODES.RATE_LIMITED);

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. Connection registry
   * ══════════════════════════════════════════════════════════════════════ */

  sec("2. Connection registry (§43)");

  const reg = realtime.connectionRegistry;
  reg.reset();

  reg.add("s1", "u1", "1.1.1.1");
  reg.add("s2", "u1", "1.1.1.1");
  reg.add("s3", "u2", "1.1.1.1");
  reg.add("s4", "u3", "2.2.2.2");

  eq("counts sockets per user", reg.countForUser("u1"), 2);
  eq("counts sockets per user (single)", reg.countForUser("u2"), 1);
  eq("counts sockets per IP", reg.countForIp("1.1.1.1"), 3);
  eq("counts sockets per IP (other)", reg.countForIp("2.2.2.2"), 1);
  eq("unknown user counts zero", reg.countForUser("nobody"), 0);
  eq("unknown IP counts zero", reg.countForIp("9.9.9.9"), 0);
  eq("total tracked sockets", reg.total(), 4);

  ok("has() reflects a live socket", reg.has("s1") === true);
  reg.remove("s1");
  eq("after removal the user count drops", reg.countForUser("u1"), 1);
  eq("after removal the IP count drops", reg.countForIp("1.1.1.1"), 2);
  ok("has() is false after removal", reg.has("s1") === false);
  eq("removing an unknown socket is a no-op", reg.remove("ghost"), null);

  // Empty sets must be deleted, not left to accumulate.
  reg.remove("s3");
  eq("user entry removed when their last socket goes", reg.countForUser("u2"), 0);

  reg.reset();
  eq("reset clears every socket", reg.total(), 0);
  ok("stats exposes the caps", reg.stats().capPerUser === CAP_USER && reg.stats().capPerIp === CAP_IP);

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. Per-user concurrency cap (§43)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("3. Per-user connection cap (§43)");

  const alice = await User.create({ firstName: "Alice", lastName: "Cap", email: "alice@cap.io", passwordHash: "x", role: "admin", emailVerified: true });
  const bob = await User.create({ firstName: "Bob", lastName: "Cap", email: "bob@cap.io", passwordHash: "x", emailVerified: true });
  const cara = await User.create({ firstName: "Cara", lastName: "Cap", email: "cara@cap.io", passwordHash: "x", emailVerified: true });

  // Alice opens CAP_USER tabs — all must succeed.
  const aliceSockets = [];
  for (let i = 0; i < CAP_USER; i++) {
    const r = connect(mint(alice));
    aliceSockets.push(r);
    eq(`alice socket ${i + 1}/${CAP_USER} connects`, await r.settled, "connected");
  }
  eq("registry agrees alice holds the cap", reg.countForUser(String(alice._id)), CAP_USER);

  // The next one must be refused.
  const overflow = connect(mint(alice));
  await overflow.settled;
  const overflowKick = await overflow.kicked;
  ok("alice's next socket is refused",
    overflowKick === "capped" || overflowKick === "io server disconnect",
    String(overflowKick));
  ok("refusal is reported as a structured error",
    overflow.errors.some((e) => e && e.code === ERROR_CODES.TOO_MANY_CONNECTIONS),
    JSON.stringify(overflow.errors));
  ok("refusal message tells the user what to do",
    /close another tab/i.test(overflow.errors[0]?.message || ""),
    overflow.errors[0]?.message);
  eq("the refused socket did not count", reg.countForUser(String(alice._id)), CAP_USER);

  // Freeing a slot lets a new one in — the cap is concurrency, not lifetime.
  aliceSockets[0].socket.disconnect();
  await wait(250);
  const freed = connect(mint(alice));
  eq("after closing one tab a new socket is accepted", await freed.settled, "connected");
  eq("count is back at the cap, not above it", reg.countForUser(String(alice._id)), CAP_USER);

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. Per-IP concurrency cap (§43)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("4. Per-IP connection cap (§43)");

  // Alice holds CAP_USER; add Bob and Cara to walk the shared IP up to CAP_IP.
  const bobSockets = [];
  const ipTotal = reg.countForIp("127.0.0.1");
  for (let i = 0; i < CAP_IP - CAP_USER; i++) {
    const r = connect(mint(i % 2 === 0 ? bob : cara));
    bobSockets.push(r);
    eq(`ip socket ${i + 1}/${CAP_IP - CAP_USER} connects`, await r.settled, "connected");
  }
  eq("IP is now at its cap", reg.countForIp("127.0.0.1"), CAP_IP);

  // One more from ANY user on this IP must be refused — that is the point of
  // a per-IP cap: one network cannot occupy every slot.
  const ipOverflow = connect(mint(bob));
  await ipOverflow.settled;
  const ipKick = await ipOverflow.kicked;
  ok("an extra socket from the same IP is refused",
    ipKick === "capped" || ipKick === "io server disconnect",
    String(ipKick));
  ok("IP refusal is a structured error",
    ipOverflow.errors.some((e) => e && e.code === ERROR_CODES.TOO_MANY_CONNECTIONS),
    JSON.stringify(ipOverflow.errors));
  ok("IP never exceeds its cap", reg.countForIp("127.0.0.1") <= CAP_IP);

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. Room capacity cap (§43)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("5. Room capacity cap (§43)");

  const now = Date.now();
  const event = await Event.create({
    title: "Cap Event", slug: `cap-event-${Date.now()}`, description: "d", category: "Workshop",
    eventType: "offline", venue: "Hall", startDate: new Date(now + 3600e3), endDate: new Date(now + 7200e3),
    visibility: "public", createdBy: alice._id, liveState: "WAITING",
  });

  // Three fresh participants on a DIFFERENT logical room: clear the IP first
  // so the connection caps don't mask the room cap.
  for (const r of opened) r.socket.disconnect();
  await wait(400);
  reg.reset();
  // The registry is authoritative for the sweep; re-register what is live.

  const p1 = await User.create({ firstName: "P1", lastName: "Room", email: "p1@room.io", passwordHash: "x", emailVerified: true });
  const p2 = await User.create({ firstName: "P2", lastName: "Room", email: "p2@room.io", passwordHash: "x", emailVerified: true });
  const p3 = await User.create({ firstName: "P3", lastName: "Room", email: "p3@room.io", passwordHash: "x", emailVerified: true });

  const mk = async (u) => { const r = connect(mint(u)); eq(`${u.firstName} connects`, await r.settled, "connected"); return r; };
  const c1 = await mk(p1);
  const c2 = await mk(p2);
  const c3 = await mk(p3);

  const j1 = await emitAck(c1.socket, EVENTS.C_EVENT_JOIN, { eventId: String(event._id) });
  ok("participant 1 joins", j1.ack?.ok === true, JSON.stringify(j1.ack));
  const j2 = await emitAck(c2.socket, EVENTS.C_EVENT_JOIN, { eventId: String(event._id) });
  ok("participant 2 joins (room now at cap)", j2.ack?.ok === true, JSON.stringify(j2.ack));

  await wait(1300); // join cooldown
  const j3 = await emitAck(c3.socket, EVENTS.C_EVENT_JOIN, { eventId: String(event._id) });
  ok("participant 3 is refused — room full", j3.ack?.ok !== true, JSON.stringify(j3.ack));

  const room = realtime.roomOf(String(event._id));
  eq("room holds exactly the cap", room.participants.size, CAP_ROOM);
  ok("the refused user is not in the room", !room.participants.has(String(p3._id)));

  // Re-joining from a second tab is ALWAYS allowed: the cap counts distinct
  // participants, so nobody can lock themselves out by reconnecting.
  await wait(1300);
  const j1again = await emitAck(c1.socket, EVENTS.C_EVENT_JOIN, { eventId: String(event._id) });
  ok("a participant already in the room can still re-join", j1again.ack?.ok === true, JSON.stringify(j1again.ack));

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. Stale-socket sweep (§43)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("6. Stale-socket sweep (§43)");

  // Simulate a socket that died without a clean disconnect (laptop lid, dead
  // radio). Its id is in the room but the transport has never heard of it.
  room.participants.set("ghost-user", {
    socketIds: new Set(["dead-socket-1", "dead-socket-2"]),
    identity: { _id: "ghost-user" },
    displayName: "Ghost",
    state: "connected",
    ready: false,
    joinedAt: new Date(),
    lastSeenAt: new Date(),
  });
  room.organizers.set("ghost-org", { socketIds: new Set(["dead-socket-3"]) });

  let res = realtime.sweepStaleSockets();
  ok("stale sockets are detected", res.staleSockets >= 1, JSON.stringify(res));
  ok("the orphaned organizer is dropped immediately", !room.organizers.has("ghost-org"));
  ok("the orphaned participant is marked disconnected",
    room.participants.get("ghost-user")?.state === "disconnected");
  ok("a freshly-disconnected participant is KEPT (fast reconnect restores state)",
    room.participants.has("ghost-user"));

  // Real participants with live sockets must survive the sweep untouched.
  ok("live participants keep their sockets",
    room.participants.get(String(p1._id))?.socketIds.size >= 1);
  ok("live participants stay connected",
    room.participants.get(String(p1._id))?.state !== "disconnected");

  // Past the TTL the disconnected entry is finally removed.
  const ghost = room.participants.get("ghost-user");
  if (ghost) ghost.lastSeenAt = new Date(Date.now() - 3 * TTL_MS);
  res = realtime.sweepStaleSockets();
  ok("an entry idle past the TTL is dropped", !room.participants.has("ghost-user"), JSON.stringify(res));
  ok("dropped participants are reported", res.droppedParticipants >= 1);

  // An empty, idle room is reaped.
  const otherRoom = realtime.roomOf("000000000000000000000099");
  otherRoom.lastActivityAt = Date.now() - 3 * TTL_MS;
  res = realtime.sweepStaleSockets();
  ok("an empty idle room is reaped", res.droppedRooms >= 1, JSON.stringify(res));
  ok("the reaped room is gone from roomStats",
    !realtime.roomStats().some((r) => r.eventId === "000000000000000000000099"));

  // A room in active use must never be reaped.
  ok("the live room survives", realtime.roomStats().some((r) => r.eventId === String(event._id)));
  ok("the live room reports below its cap",
    realtime.roomStats().find((r) => r.eventId === String(event._id))?.participants <= CAP_ROOM);

  /* ═══════════════════════════════════════════════════════════════════════
   * 7. Backpressure (§44) — throttles documented, correctness never coalesced
   * ══════════════════════════════════════════════════════════════════════ */

  sec("7. Backpressure (§44)");

  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "services", "realtime.service.js"), "utf8");

  ok("leaderboard re-rank is throttled to 1s", /lastBoardAt \|\| 0\) > 1000/.test(src));
  ok("poll distribution is throttled to 1s", /lastPollAt \|\| 0\) > 1000/.test(src));
  ok("Q&A list is throttled to 400ms", /qaListAt \|\| 0\) < 400/.test(src));
  ok("answers have a 400ms per-socket cooldown", /answerAt && now - socket\.data\.answerAt < 400/.test(src));
  ok("organizer commands have a 250ms cooldown", /cmdAt && now - socket\.data\.cmdAt < 250/.test(src));
  ok("joins have a 1.2s per-socket cooldown", /joinAttemptAt && now - socket\.data\.joinAttemptAt < 1200/.test(src));

  // The correctness half of §44: an accepted answer is persisted and acked
  // BEFORE any throttled broadcast, so a coalesced board can never cost a
  // participant their points.
  const answerIdx = src.indexOf("Personal, server-authoritative result");
  const boardIdx = src.indexOf("while the board is on participant screens");
  ok("the score is acked before the board refresh is considered",
    answerIdx > 0 && boardIdx > answerIdx);

  // Behavioural proof: rapid-fire answers each score exactly once.
  // The quiz can only be driven by someone who can manage the event — p1 is a
  // participant, so alice (the creator) has to run it.
  reg.reset();
  for (const r of opened) { try { r.socket.disconnect(); } catch {} }
  await wait(400);

  const qPart = await mk(p1);
  const qOrg = await mk(alice);
  await emitAck(qOrg.socket, EVENTS.C_EVENT_JOIN, { eventId: String(event._id) }, 6000);
  await emitAck(qPart.socket, EVENTS.C_EVENT_JOIN, { eventId: String(event._id) }, 6000);
  await wait(300); // organizer command cooldown

  // Must be UPCOMING: startActivity short-circuits an already-LIVE activity
  // with alreadyLive and never opens its first question.
  const quizAct = await Activity.create({ event: event._id, type: "QUIZ", title: "R1", order: 0, state: "UPCOMING" });
  await Question.create({ activity: quizAct._id, type: "SINGLE_CHOICE", text: "2+2?", options: ["3", "4", "5"], correctAnswer: 1, points: 100, timeLimit: 30, order: 0 });
  await Event.updateOne({ _id: event._id }, { $set: { liveState: "LIVE" } });

  const openedQ = await emitAck(qOrg.socket, "activity:start", { activityId: String(quizAct._id), eventId: String(event._id) }, 6000);
  ok("quiz activity starts", openedQ.ack?.ok === true, JSON.stringify(openedQ.ack));
  await wait(400);

  // The answer handler validates questionId against the open question in the
  // activity runtime, so it has to be the real one.
  const runningAct = await Activity.findById(quizAct._id).lean();
  const openQuestionId = String(runningAct?.questionRuntime?.questionId || "");
  ok("starting the activity opens a question", Boolean(openQuestionId), openQuestionId);

  const a1 = await emitAck(qPart.socket, "activity:answer", { activityId: String(quizAct._id), questionId: openQuestionId, answer: 1 }, 6000);
  ok("first answer accepted", a1.ack?.ok === true, JSON.stringify(a1.ack));
  const scoredOnce = await ParticipantSession.findOne({ event: event._id, user: p1._id }).lean();
  eq("correct answer scored 100 (never coalesced away)", scoredOnce?.score, 100);

  await wait(500); // clear the 400ms answer cooldown
  const dup = await emitAck(qPart.socket, "activity:answer", { activityId: String(quizAct._id), questionId: openQuestionId, answer: 1 }, 6000);
  ok("duplicate answer is rejected, not double-counted",
    dup.ack?.ok !== true || dup.ack?.correct === false, JSON.stringify(dup.ack));
  const afterDup = await ParticipantSession.findOne({ event: event._id, user: p1._id }).lean();
  eq("score unchanged after the duplicate", afterDup?.score, 100);

  /* ═══════════════════════════════════════════════════════════════════════
   * 8. State reconstruction (§45)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("8. State reconstruction (§45)");

  // A reconnect must hand back the FULL state, including the in-flight
  // question — this is the assertion that caught the questionRuntime
  // projection bug in Phase 5.
  const c1b = connect(mint(p1)); // reconnect of qPart
  eq("reconnect socket connects", await c1b.settled, "connected");
  const rejoin = await emitAck(c1b.socket, EVENTS.C_EVENT_JOIN, { eventId: String(event._id) }, 6000);
  ok("rejoin succeeds", rejoin.ack?.ok === true, JSON.stringify(rejoin.ack));
  ok("rejoined state carries my score", rejoin.ack?.state?.me?.score === 100, JSON.stringify(rejoin.ack?.state?.me));
  ok("rejoined state carries the open question",
    Boolean(rejoin.ack?.state?.question?.text), JSON.stringify(rejoin.ack?.state?.question));
  ok("rejoined state carries counts", typeof rejoin.ack?.state?.counts?.connected === "number");
  ok("the open question carries no answer key (§39)",
    rejoin.ack?.state?.question?.correctAnswer === undefined);

  /* A late join gets the running activity too (§54). The room is sitting at
   * its cap from §5, so lift it first — caps are read at call time, not
   * captured, which is exactly what lets a test raise one. */
  REALTIME_CAPS.PARTICIPANTS_PER_ROOM = 10;
  await wait(1300); // join cooldown
  const late = connect(mint(p3));
  eq("late joiner connects", await late.settled, "connected");
  const lateJoin = await emitAck(late.socket, EVENTS.C_EVENT_JOIN, { eventId: String(event._id) }, 6000);
  ok("late joiner is admitted (under the cap after sweeps)", lateJoin.ack?.ok === true, JSON.stringify(lateJoin.ack));
  ok("late joiner receives state", Boolean(lateJoin.ack?.state));

  /* ── teardown ── */
  for (const r of opened) { try { r.socket.disconnect(); } catch {} }
  await wait(300);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  Phase 6 selftest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log(`   • ${f}`));
  }
  console.log(`${"═".repeat(64)}\n`);

  await mongod.stop();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error("\n💥 selftest crashed:", e);
  process.exit(1);
});
