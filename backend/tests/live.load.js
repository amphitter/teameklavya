/**
 * LOAD FOUNDATION TEST (Part 4, Phase 10 — spec §96: 10 and 50 simulated
 * clients "where practical"). Boots the real server + in-memory Mongo and
 * drives N concurrent participants through a full live quiz.
 *
 * Run:
 *   npm run test:load:100   # 100-client pass  (~30s)
 *   npm run test:load:500   # 500-client pass  (~75s)
 *
 * RAISING THE CAPS IS MANDATORY ABOVE 20 CLIENTS.
 * Every client here originates from 127.0.0.1, so the whole run shares ONE
 * IP bucket. Two separate guards will cap it before the server breaks a
 * sweat, and both are working as designed:
 *   REALTIME_CAP_SOCKETS_PER_IP        (default 20) — concurrent sockets per IP
 *   RATE_LIMIT_REALTIME_CONNECT_IP_LIMIT (default 30/min) — connect rate per IP
 * The :100 and :500 scripts raise both. If you see 20/100 or 30/100 sockets
 * "connected", that is not a failure — it is the cap doing its job.
 *
 * What it measures (the numbers that matter under load):
 *   - connect + join success rate, join ack latency p50/p95
 *   - answer throughput + answer ack latency p50/p95
 *   - broadcast fan-out integrity (every client sees every question event)
 *   - structured-error rate (anything beyond expected rate-limit noise)
 *
 * It is a FOUNDATION: no assertions on absolute latency (machine-dependent),
 * only on correctness under concurrency — success rates must stay 100% and
 * every broadcast must reach every client.
 */
process.env.NODE_ENV = "test";
process.env.PORT = 5059;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x"; process.env.GOOGLE_CLIENT_SECRET = "y"; process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";

const CLIENTS = Math.max(2, Math.min(1000, Number(process.env.LIVE_LOAD_CLIENTS) || 10));
const QUESTIONS = 5;
const QUESTION_SECONDS = 10;
const ADVANCE_MS = 4000; // organizer cadence per question

const { MongoMemoryServer } = require("mongodb-memory-server");
const { io } = require("socket.io-client");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const Activity = require("../models/activity.model");
const Question = require("../models/question.model");
const ParticipantSession = require("../models/participantSession.model");
const LiveAnswer = require("../models/liveAnswer.model");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(token) {
  const socket = io(`http://localhost:${process.env.PORT}`, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });
  const log = [];
  socket.onAny((event) => log.push(event));
  return { socket, log };
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  require("../server");
  const B = `http://localhost:${process.env.PORT}/api`;
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    try {
      const r = await fetch(`${B}/events`);
      up = r.status > 0;
    } catch {
      await wait(300);
    }
  }
  if (!up) throw new Error("server never came up");

  /* ── fixtures ── */
  const stamp = Date.now();
  // Event creation is admin-gated, so the load organizer must be an admin.
  const organizer = await User.create({ firstName: "Load", lastName: "Runner", email: `load-org${stamp}@test.com`, passwordHash: "x", emailVerified: true, role: "admin" });
  const orgTok = jwt.sign({ id: String(organizer._id), role: "user", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });
  const users = await User.insertMany(
    Array.from({ length: CLIENTS }, (_, i) => ({ firstName: `Bot${i}`, lastName: "Loader", email: `load-p${i}-${stamp}@test.com`, passwordHash: "x", emailVerified: true }))
  );

  const createRes = await fetch(`${B}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${orgTok}` },
    body: JSON.stringify({
      title: `Load Test Arena (${CLIENTS} clients)`,
      description: "Phase 10 load foundation",
      category: "Workshop",
      eventType: "offline",
      venue: "The Internet",
      organizer: "Load Runner",
      startDate: new Date(Date.now() - 600e3).toISOString(),
      endDate: new Date(Date.now() + 7200e3).toISOString(),
      maxAttendees: 1000,
      price: 0,
    }),
  });
  const _cr = await createRes.json();
  if (!_cr || !_cr.event) { console.error("CREATE FAILED", createRes.status, JSON.stringify(_cr).slice(0,600)); process.exit(1); }
  const ev = _cr.event;
  await Event.updateOne({ _id: ev._id }, { $set: { liveState: "WAITING" } });
  const quizAct = await Activity.create({ event: ev._id, type: "QUIZ", title: "Load round", order: 0, state: "UPCOMING" });
  for (let i = 0; i < QUESTIONS; i++) {
    await Question.create({
      activity: quizAct._id,
      type: "SINGLE_CHOICE",
      text: `Load question ${i + 1}?`,
      options: ["A", "B", "C", "D"],
      correctAnswer: i % 4,
      points: 100,
      timeLimit: QUESTION_SECONDS,
      order: i,
    });
  }

  /* ── spin up clients: connect + join, measure latency ── */
  const t0 = Date.now();
  const clients = users.map((u) => ({
    user: u,
    token: jwt.sign({ id: String(u._id), role: "user", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" }),
    rec: null,
    joined: false,
    joinedMs: null,
    answers: 0,
    answerMs: [],
    errors: 0,
    opened: 0,
    closed: 0,
    completed: false,
  }));

  await Promise.all(
    clients.map(
      (c) =>
        new Promise((resolve) => {
          c.rec = connect(c.token);
          c.rec.socket.on("connect", () => resolve());
          c.rec.socket.on("connect_error", () => resolve());
          setTimeout(resolve, 5000);
        })
    )
  );
  const connected = clients.filter((c) => c.rec.socket.connected).length;

  /**
   * AWAIT every join ack. This previously fired the emits and resolved
   * immediately, so at high client counts no ack had landed yet when the
   * answer listeners were registered — every client was skipped by
   * `if (!c.joined) continue` and the run reported 0 answers and 0 fan-out
   * even though the server was healthy. Wait for the acks, with a ceiling.
   */
  const JOIN_ACK_TIMEOUT = 30000;
  await Promise.all(
    clients.map(
      (c) =>
        new Promise((resolve) => {
          if (!c.rec.socket.connected) return resolve();
          let settled = false;
          const fin = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          const s = Date.now();
          c.rec.socket.emit("event:join", { eventId: ev._id }, (ack) => {
            if (ack?.ok) {
              c.joined = true;
              c.joinedMs = Date.now() - s;
            } else {
              c.errors += 1;
            }
            fin();
          });
          setTimeout(fin, JOIN_ACK_TIMEOUT);
        })
    )
  );
  // Settle time must scale with client count — a fixed 1500ms is plenty for
  // 10 clients but far too short for 500, which produced false failures.
  const SETTLE = Math.max(1500, CLIENTS * 12);
  await wait(SETTLE); // let all joins land + settle

  const joinLat = clients.filter((c) => c.joinedMs != null).map((c) => c.joinedMs);

  /* ── answer engine: every client answers every question after a jitter ── */
  for (const c of clients) {
    if (!c.joined) continue;
    c.rec.socket.on("question:opened", (payload) => {
      const q = payload?.question;
      if (!q) return;
      setTimeout(() => {
        if (!c.rec.socket.connected) return;
        const s = Date.now();
        c.rec.socket.emit("activity:answer", { activityId: quizAct._id, questionId: q.id, answer: Math.floor(Math.random() * 4) }, (ack) => {
          if (ack?.ok) {
            c.answers += 1;
            c.answerMs.push(Date.now() - s);
          } else {
            c.errors += 1;
          }
        });
      }, 150 + Math.floor(Math.random() * 1200));
    });
    c.rec.socket.on("question:closed", () => (c.closed += 1));
    c.rec.socket.onAny((event) => {
      if (event === "question:opened") c.opened += 1;
      if (event === "event:completed") c.completed = true;
    });
  }

  /* ── organizer drives the run ── */
  const orgRec = connect(orgTok);
  const orgCmd = (event, payload) =>
    new Promise((resolve) => {
      let done = false;
      const fin = (v) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      orgRec.socket.emit(event, payload, (ack) => fin({ ack: ack || {} }));
      orgRec.socket.on("error", (e) => fin({ ack: null, error: e }));
      setTimeout(() => fin({ ack: null, timeout: true }), 6000);
    });
  await new Promise((r) => orgRec.socket.on("connect", r));
  await orgCmd("event:join", { eventId: ev._id });
  await wait(300);
  await orgCmd("event:start", { eventId: ev._id });
  await wait(300);
  await orgCmd("activity:start", { activityId: quizAct._id, eventId: ev._id });

  for (let i = 1; i < QUESTIONS; i++) {
    await wait(ADVANCE_MS);
    await orgCmd("question:next", { activityId: quizAct._id });
  }
  await wait(ADVANCE_MS); // last question breathing room
  await orgCmd("activity:end", { activityId: quizAct._id, eventId: ev._id });
  await wait(300);
  await orgCmd("event:end", { eventId: ev._id });
  await wait(Math.max(2500, CLIENTS * 12)); // let completion + snapshot fan out

  /* ── verification + report ── */
  const answerLat = clients.flatMap((c) => c.answerMs);
  const totalAnswers = clients.reduce((s, c) => s + c.answers, 0);
  const sessions = await ParticipantSession.countDocuments({ event: ev._id });
  const dbAnswers = await LiveAnswer.countDocuments({ event: ev._id });
  const expectedAnswers = connected * QUESTIONS;
  if (process.env.LOAD_DEBUG) {
    console.log("DEBUG per-client (first 5):");
    clients.slice(0, 5).forEach((c, i) =>
      console.log(`  #${i} joined=${c.joined} opened=${c.opened} closed=${c.closed} completed=${c.completed} answers=${c.answers} errors=${c.errors} connected=${c.rec.socket.connected}`)
    );
  }
  const fullFanout = clients.filter((c) => c.joined && c.opened === QUESTIONS && c.closed === QUESTIONS && c.completed).length;
  const errorClients = clients.filter((c) => c.errors > 0).length;
  const runtimeS = Math.round((Date.now() - t0) / 1000);

  console.log("\n══════════ LOAD FOUNDATION REPORT ══════════");
  console.log(`clients requested      : ${CLIENTS}`);
  console.log(`sockets connected      : ${connected}/${CLIENTS} (${Math.round((connected / CLIENTS) * 100)}%)`);
  console.log(`joins accepted         : ${clients.filter((c) => c.joined).length}/${connected}`);
  console.log(`join ack latency p50   : ${pct(joinLat, 50)} ms   p95: ${pct(joinLat, 95)} ms`);
  console.log(`answers sent (acks ok) : ${totalAnswers}/${expectedAnswers}`);
  console.log(`answer ack latency p50 : ${pct(answerLat, 50)} ms   p95: ${pct(answerLat, 95)} ms`);
  console.log(`sessions in DB         : ${sessions}`);
  console.log(`LiveAnswer rows in DB  : ${dbAnswers}`);
  console.log(`full broadcast fan-out : ${fullFanout}/${clients.filter((c) => c.joined).length} clients saw all ${QUESTIONS} opens+closes+completion`);
  console.log(`clients with errors    : ${errorClients}`);
  console.log(`wall time              : ${runtimeS}s`);

  let failed = 0;
  const check = (name, cond) => {
    console.log(`  ${cond ? "✅" : "❌"} ${name}`);
    if (!cond) failed += 1;
  };
  check("100% socket connects", connected === CLIENTS);
  check("100% joins accepted", clients.filter((c) => c.joined).length === connected);
  check("100% answers acked", totalAnswers === expectedAnswers);
  check("DB session count = clients", sessions === connected);
  check("DB answers = expected", dbAnswers === expectedAnswers);
  check("100% broadcast fan-out", fullFanout === clients.filter((c) => c.joined).length);
  check("zero client errors", errorClients === 0);

  console.log(`\n${failed === 0 ? "✅" : "❌"} LOAD (${CLIENTS} clients): ${failed === 0 ? "ALL GREEN" : failed + " FAILURES"}`);
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
