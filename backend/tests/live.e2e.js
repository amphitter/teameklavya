/**
 * LIVE ENGINE END-TO-END TEST (Part 4, Phase 10 — spec §95–96, §97).
 * Boots the real server + in-memory Mongo and drives the ENTIRE live flow
 * through real Socket.IO connections — this file is also the executable
 * demo flow (§97): every Phase 2–9 feature in one scripted run.
 *
 * Scenarios (in order):
 *  1. two participants join              12. pause (frozen clock) / resume
 *  2. ready signal (waiting room)        13. leaderboard show/hide + auto-show
 *  3. wrong event (unknown + ended)      14. poll vote → live distribution
 *  4. unauthorized organizer command     15. Q&A submit + upvote + moderation
 *  5. start event                        16. chat + rate limit + pin + mute
 *  6. start activity (quiz)              17. announcement banner
 *  7. sanitized question delivery        18. leaderboard checkpoint activity
 *  8. correct + wrong answers (scored)   19. disconnect (presence)
 *  9. duplicate answer (idempotent)      20. reconnect (full state re-sync)
 * 10. display-mode join (read-only)      21. late join (mid-activity)
 * 11. timer expiration (server clock)    22. end event → final results +
 *      snapshot + achievements + certificate + memory share (HTTP)
 *
 * Timing notes: the server rate-cools joins (1.2s/socket), organizer
 * commands (250ms/socket), answers (400ms/socket), chat/Q&A (1.5s) and
 * QA upvotes (500ms); poll/QA broadcasts are throttled (1s / 400ms).
 * The sleeps below respect those windows — they test the SERVER's
 * protection, not the client's politeness.
 *
 * Run: npm i (needs socket.io-client) → npm run test:live
 */
process.env.NODE_ENV = "test";
process.env.PORT = 5058;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x"; process.env.GOOGLE_CLIENT_SECRET = "y"; process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";

const { MongoMemoryServer } = require("mongodb-memory-server");
const { io } = require("socket.io-client");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const Activity = require("../models/activity.model");
const Question = require("../models/question.model");
const EventResult = require("../models/eventResult.model");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── tiny assertion harness ── */
let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/* ── socket recorder: every event lands in a log we can await ── */
function connect(token) {
  const socket = io(`http://localhost:${process.env.PORT}`, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });
  const log = [];
  socket.onAny((event, payload) => log.push({ event, payload, at: Date.now() }));
  const rec = { socket, log };
  rec.waitFor = (event, { timeout = 6000, from = 0, pred = () => true } = {}) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = log.slice(from).find((e) => e.event === event && pred(e.payload));
        if (hit) return resolve(hit.payload);
        if (Date.now() - started > timeout) {
          return reject(new Error(`timeout waiting for "${event}" (log tail: ${log.slice(-6).map((e) => e.event).join(", ")})`));
        }
        setTimeout(tick, 40);
      };
      tick();
    });
  return rec;
}

/** Emit with ack, racing the structured error event. */
function attempt(rec, event, payload, timeout = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const from = rec.log.length;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish({ ack: null, error: null, timeout: true }), timeout);
    rec
      .waitFor("error", { timeout, from, pred: () => true })
      .then((p) => {
        clearTimeout(timer);
        finish({ ack: null, error: p });
      })
      .catch(() => {});
    rec.socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      finish({ ack: ack || {}, error: null });
    });
  });
}

/** Structured-error code from whichever channel answered. */
const errCode = (r) => r.error?.code || r.ack?.code || null;

const mint = (user) => jwt.sign({ id: String(user._id), role: "user", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  require("../server"); // boots HTTP + Socket.IO
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
  console.log("server up");

  /* ── fixtures ── */
  // POST /events is admin-gated, so the organizer needs the admin role —
  // every other e2e suite (mgmt, quiz, social) grants it for the same reason.
  const organizer = await User.create({ firstName: "Org", lastName: "Runner", email: `org${Date.now()}@test.com`, passwordHash: "x", role: "admin", emailVerified: true });
  const p1u = await User.create({ firstName: "Anu", lastName: "Rao", email: `p1${Date.now()}@test.com`, passwordHash: "x", emailVerified: true });
  const p2u = await User.create({ firstName: "Dev", lastName: "Mehta", email: `p2${Date.now()}@test.com`, passwordHash: "x", emailVerified: true });
  const p3u = await User.create({ firstName: "Leela", lastName: "Nair", email: `p3${Date.now()}@test.com`, passwordHash: "x", emailVerified: true });
  const orgTok = mint(organizer);
  const p1Tok = mint(p1u);
  const p2Tok = mint(p2u);
  const p3Tok = mint(p3u);
  const eventManagerOwner = await User.create({ firstName: "Org", lastName: "Owner", email: `orgowner${Date.now()}@test.com`, passwordHash: "x", emailVerified: true });
  const organizationEventManager = await User.create({ firstName: "Event", lastName: "Manager", email: `eventmanager${Date.now()}@test.com`, passwordHash: "x", emailVerified: true });
  const organizationEventManagerToken = mint(organizationEventManager);
  const eventOrganization = await Organization.create({
    name: "Socket Event Organization",
    slug: `socket-event-org-${Date.now()}`,
    createdBy: eventManagerOwner._id,
    category: "TECH_COMMUNITY",
  });
  await OrganizationMembership.create({
    organizationId: eventOrganization._id,
    userId: organizationEventManager._id,
    role: "EVENT_MANAGER",
    status: "ACTIVE",
  });

  const createRes = await fetch(`${B}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${orgTok}` },
    body: JSON.stringify({
      title: "Live E2E Quiz Night",
      description: "Phase 10 end-to-end",
      category: "Workshop",
      eventType: "offline",
      venue: "Test Hall",
      organizer: "Org Runner",
      startDate: new Date(Date.now() - 600e3).toISOString(),
      endDate: new Date(Date.now() + 7200e3).toISOString(),
      maxAttendees: 100,
      price: 0,
    }),
  });
  const ev = (await createRes.json()).event;
  await Event.updateOne({ _id: ev._id }, { $set: { liveState: "WAITING" } }); // doors open, organizer hasn't started

  const organizationOwnedEvent = await Event.create({
    title: "Organization Event Manager Socket Check",
    slug: `org-event-manager-socket-${Date.now()}`,
    description: "Owner-aware Socket.IO authorization",
    eventType: "offline",
    venue: "Test Hall",
    startDate: new Date(Date.now() - 600e3),
    endDate: new Date(Date.now() + 7200e3),
    liveState: "WAITING",
    createdBy: organizer._id,
    organizerType: "ORGANIZATION",
    organizerId: eventOrganization._id,
    organization: eventOrganization._id,
  });
  const userOwnedAssociatedEvent = await Event.create({
    title: "User-owned Association Socket Check",
    slug: `user-owned-associated-socket-${Date.now()}`,
    description: "Association must not grant Socket.IO organizer rights",
    eventType: "offline",
    venue: "Test Hall",
    startDate: new Date(Date.now() - 600e3),
    endDate: new Date(Date.now() + 7200e3),
    liveState: "WAITING",
    createdBy: p1u._id,
    organizerType: "USER",
    organizerId: p1u._id,
    organization: eventOrganization._id,
  });

  const quizAct = await Activity.create({ event: ev._id, type: "QUIZ", title: "Round 1 — Mixed Bag", order: 0, state: "UPCOMING" });
  await Question.create({ activity: quizAct._id, type: "SINGLE_CHOICE", text: "2 + 2 ?", options: ["3", "4", "5", "6"], correctAnswer: 1, points: 100, timeLimit: 30, order: 0 });
  await Question.create({ activity: quizAct._id, type: "SINGLE_CHOICE", text: "First president of the moon?", options: ["Nobody", "Buzz", "Neil"], correctAnswer: 0, points: 100, timeLimit: 5, order: 1 });
  await Question.create({ activity: quizAct._id, type: "TRUE_FALSE", text: "The sun is a star.", options: ["True", "False"], correctAnswer: 0, points: 100, timeLimit: 30, order: 2 });
  const pollAct = await Activity.create({ event: ev._id, type: "POLL", title: "Snack vote", order: 1, state: "UPCOMING" });
  await Question.create({ activity: pollAct._id, type: "SINGLE_CHOICE", text: "Best snack?", options: ["Samosa", "Momos", "Pizza"], correctAnswer: null, points: 0, timeLimit: 30, order: 0 });
  const qaAct = await Activity.create({ event: ev._id, type: "QA", title: "Ask us anything", order: 2, state: "UPCOMING" });
  const lbAct = await Activity.create({ event: ev._id, type: "LEADERBOARD", title: "Final board", order: 3, state: "UPCOMING" });

  /* ── connect: organizer + two participants ── */
  const org = connect(orgTok);
  const p1 = connect(p1Tok);
  const p2 = connect(p2Tok);
  const eventManagerSocket = connect(organizationEventManagerToken);
  await Promise.all([org, p1, p2, eventManagerSocket].map((r) => r.waitFor("server:time", { timeout: 4000 }).catch(() => {})));
  console.log("sockets connected");

  // Phase 5: Socket.IO uses the same explicit owner policy as REST. An active
  // EVENT_MANAGER can control an Organization-owned Event, but an organization
  // association on a USER-owned Event does not grant organizer commands.
  const eventManagerJoin = await attempt(eventManagerSocket, "event:join", { eventId: organizationOwnedEvent._id });
  check("Organization EVENT_MANAGER joins as organizer", eventManagerJoin.ack?.ok && eventManagerJoin.ack.role === "organizer", JSON.stringify(eventManagerJoin));
  await wait(300);
  const eventManagerStart = await attempt(eventManagerSocket, "event:start", { eventId: organizationOwnedEvent._id });
  check("Organization EVENT_MANAGER controls Organization-owned live Event", eventManagerStart.ack?.ok === true, JSON.stringify(eventManagerStart));
  const associationOnlyStart = await attempt(eventManagerSocket, "event:start", { eventId: userOwnedAssociatedEvent._id });
  check("organization association grants no Socket.IO owner access", errCode(associationOnlyStart) === "NOT_AUTHORIZED", JSON.stringify(associationOnlyStart));
  eventManagerSocket.socket.disconnect();

  /* 1. organizer + two participants join.
   * The organizer MUST emit event:join too — the server only calls
   * socket.join(roomKey(eventId)) inside the join handler, so an organizer
   * socket that skips it sits outside the room and silently receives none of
   * the room broadcasts this suite asserts on. */
  const j0 = await attempt(org, "event:join", { eventId: ev._id });
  check("organizer joins the room", j0.ack?.ok && j0.ack.role === "organizer");
  const j1 = await attempt(p1, "event:join", { eventId: ev._id });
  const j2 = await attempt(p2, "event:join", { eventId: ev._id });
  check("participant 1 joins", j1.ack?.ok && j1.ack.role === "participant");
  check("participant 2 joins", j2.ack?.ok && j2.ack.role === "participant");
  check("join state syncs (counts + participants preview)", typeof j1.ack?.state?.counts?.connected === "number" && Array.isArray(j1.ack?.state?.participants));
  await org.waitFor("participant:joined", { pred: (p) => p.connected >= 2 });

  /* 2. ready signal */
  p1.socket.emit("event:ready", { eventId: ev._id });
  const ready = await org.waitFor("ready:count", { pred: (p) => p.ready >= 1 });
  check("ready:count broadcast", ready.ready === 1 && ready.total === 2);

  /* 3. wrong events → structured errors (joins are rate-cooled 1.2s — wait it out) */
  await wait(1300);
  const jbogus = await attempt(p1, "event:join", { eventId: "000000000000000000000000" });
  check("unknown event → VALIDATION_FAILED", errCode(jbogus) === "VALIDATION_FAILED", JSON.stringify(jbogus));
  // startDate / endDate / venue are required by the Event schema.
  const endedEv = await Event.create({
    title: "Already over",
    slug: `over-${Date.now()}`,
    description: "x",
    eventType: "offline",
    venue: "Old Hall",
    startDate: new Date(Date.now() - 7200e3),
    endDate: new Date(Date.now() - 3600e3),
    createdBy: organizer._id,
    liveState: "COMPLETED",
  });
  await wait(1300);
  const jEnded = await attempt(p1, "event:join", { eventId: endedEv._id });
  check("ended event → EVENT_ENDED", errCode(jEnded) === "EVENT_ENDED", JSON.stringify(jEnded));

  /* 4. unauthorized organizer command */
  const hack = await attempt(p1, "event:start", { eventId: ev._id });
  check("non-organizer event:start → NOT_AUTHORIZED", errCode(hack) === "NOT_AUTHORIZED", JSON.stringify(hack));

  /* 5. start event */
  const started = await attempt(org, "event:start", { eventId: ev._id });
  check("organizer starts event", started.ack?.ok === true);
  await p1.waitFor("event:state", { pred: (p) => p.event?.liveState === "LIVE" });

  /* 6. start quiz activity */
  const actStart = await attempt(org, "activity:start", { activityId: quizAct._id, eventId: ev._id });
  check("activity:start ok", actStart.ack?.ok === true, JSON.stringify(actStart));
  const q1open = await p1.waitFor("question:opened", { timeout: 5000 });

  /* 7. sanitized delivery: participant never sees the key, organizer does */
  check("Q1 opens automatically on activity start", q1open.question?.text === "2 + 2 ?");
  check("participant question has NO correctAnswer", !("correctAnswer" in (q1open.question || {})));
  const orgQ1 = org.log.filter((e) => e.event === "question:opened").pop().payload;
  check("organizer question HAS the answer key", orgQ1.question?.correctAnswer === 1);
  check("clock sync fields present", typeof q1open.startedAt === "number" && q1open.durationSec === 30 && typeof q1open.serverTime === "number");

  /* 8. correct + wrong answers, server-scored */
  const a1 = await attempt(p1, "activity:answer", { activityId: quizAct._id, questionId: q1open.question.id, answer: 1 });
  check("correct answer scored +100", a1.ack?.ok && a1.ack.correct === true && a1.ack.points === 100 && a1.ack.score === 100, JSON.stringify(a1.ack));
  const acc = await p1.waitFor("answer:accepted", { pred: (p) => p.correct === true });
  check("answer:accepted mirrors server score", acc.score === 100);
  await p1.waitFor("question:answers", { pred: (p) => p.count === 1 });
  const a2 = await attempt(p2, "activity:answer", { activityId: quizAct._id, questionId: q1open.question.id, answer: 2 });
  check("wrong answer scored 0", a2.ack?.ok && a2.ack.correct === false && a2.ack.points === 0 && a2.ack.score === 0, JSON.stringify(a2.ack));

  /* 9. duplicate answer is idempotent (answers are rate-cooled 400ms — wait it out) */
  await wait(500);
  const dup = await attempt(p1, "activity:answer", { activityId: quizAct._id, questionId: q1open.question.id, answer: 0 });
  check("duplicate answer → ALREADY_ANSWERED", errCode(dup) === "ALREADY_ANSWERED", JSON.stringify(dup));

  /* 10. display-mode join is read-only and session-free */
  const disp = connect(p3Tok);
  const dJoin = await attempt(disp, "event:join", { eventId: ev._id, display: true });
  check("display join gets role display", dJoin.ack?.ok && dJoin.ack.role === "display", JSON.stringify(dJoin.ack));
  const dispChat = await attempt(disp, "chat:send", { eventId: ev._id, text: "hi" });
  check("display socket cannot chat", errCode(dispChat) === "NOT_AUTHORIZED");
  disp.socket.disconnect();

  /* advance to Q2 (5s) — question:next closes Q1 with reveal */
  const n1 = await attempt(org, "question:next", { activityId: quizAct._id });
  check("question:next acks index 1", n1.ack?.ok && n1.ack.index === 1, JSON.stringify(n1.ack));
  const q1closed = await p1.waitFor("question:closed", { pred: (p) => String(p.questionId) === String(q1open.question.id) });
  check("close reveals the answer key", q1closed.correctAnswer === 1 && typeof q1closed.explanation === "string");

  /* 11. timer expiration — the 5s question runs out; a late attempt is
   * rejected by the SERVER clock (no client timer is ever trusted) */
  const q2open = await p1.waitFor("question:opened", { pred: (p) => p.question?.text?.includes("moon") });
  await wait(6000); // 5s limit + margin
  const late = await attempt(p1, "activity:answer", { activityId: quizAct._id, questionId: q2open.question.id, answer: 0 });
  check("late answer → TIME_UP (server clock)", errCode(late) === "TIME_UP", JSON.stringify(late));
  await p1.waitFor("question:closed", { pred: (p) => String(p.questionId) === String(q2open.question.id) });

  /* 12. pause freezes the clock; Q3 opens first */
  const n2 = await attempt(org, "question:next", { activityId: quizAct._id });
  void n2;
  await p1.waitFor("question:opened", { pred: (p) => p.question?.text?.includes("sun") });
  await wait(300); // organizer command cooldown
  const paused = await attempt(org, "activity:pause", { activityId: quizAct._id, eventId: ev._id });
  check("activity:pause ok with frozen remaining", paused.ack?.ok && typeof paused.ack.questionRemainingMs === "number", JSON.stringify(paused.ack));
  const pauseB = await p1.waitFor("activity:paused", { pred: (p) => p.questionRemainingMs != null });
  check("paused broadcast carries questionRemainingMs", pauseB.questionRemainingMs > 0 && pauseB.questionRemainingMs <= 30000);

  /* 19/20 (mid-pause): disconnect + reconnect — state must survive */
  p2.socket.disconnect();
  await org.waitFor("participant:left", { pred: () => true });
  check("disconnect broadcasts participant:left", true);
  const p2b = connect(p2Tok);
  const rejoin = await attempt(p2b, "event:join", { eventId: ev._id });
  check("reconnect re-joins with score preserved", rejoin.ack?.ok && rejoin.ack.state?.me?.score === 0 && rejoin.ack.state?.question?.text?.includes("sun"), JSON.stringify(rejoin.ack?.state?.me));

  await wait(300);
  const resumed = await attempt(org, "activity:resume", { activityId: quizAct._id, eventId: ev._id });
  check("activity:resume ok", resumed.ack?.ok === true);
  const q3reopen = await p2b.waitFor("question:opened", { pred: (p) => p.question?.text?.includes("sun") });
  check("resumed question keeps elapsed time", q3reopen.elapsedBeforePause > 0, `elapsedBeforePause=${q3reopen.elapsedBeforePause}`);
  const r3 = await attempt(p1, "activity:answer", { activityId: quizAct._id, questionId: q3reopen.question.id, answer: 0 });
  check("answer after resume scored", r3.ack?.ok && r3.ack.correct === true && r3.ack.score === 200, JSON.stringify(r3.ack));
  const r3b = await attempt(p2b, "activity:answer", { activityId: quizAct._id, questionId: q3reopen.question.id, answer: 1 });
  check("reconnected participant can answer", r3b.ack?.ok === true, JSON.stringify(r3b.ack));

  /* 13. leaderboard show/hide (manual) */
  await wait(300);
  const shown = await attempt(org, "leaderboard:show", { eventId: ev._id });
  check("leaderboard:show ok", shown.ack?.ok === true, JSON.stringify(shown.ack));
  const board = await p1.waitFor("leaderboard:update", { pred: (p) => p.visible === true });
  const me1 = (board.leaderboard || []).find((e) => String(e.participantId) === String(p1u._id));
  check("board visible with P1 ranked #1 @200", me1?.rank === 1 && me1?.score === 200, JSON.stringify(me1));
  await wait(300);
  const hidden = await attempt(org, "leaderboard:hide", { eventId: ev._id });
  check("leaderboard:hide ok", hidden.ack?.ok === true);
  const hid = await p1.waitFor("leaderboard:update", { pred: (p) => p.visible === false });
  check("hidden update carries NO board data", !("leaderboard" in hid));

  /* end quiz activity → after_activity auto-show */
  await wait(300);
  const endQuiz = await attempt(org, "activity:end", { activityId: quizAct._id, eventId: ev._id });
  check("activity:end ok", endQuiz.ack?.ok === true);
  const autoBoard = await p1.waitFor("leaderboard:update", { pred: (p) => p.visible === true });
  check("after_activity auto-shows the board", Array.isArray(autoBoard.leaderboard) && autoBoard.leaderboard.length >= 2);

  /* 14. poll vote → live percentages (poll broadcasts are throttled 1s) */
  await wait(300);
  const pollStart = await attempt(org, "activity:start", { activityId: pollAct._id, eventId: ev._id });
  check("poll activity starts", pollStart.ack?.ok === true, JSON.stringify(pollStart.ack));
  const pollQ = await p1.waitFor("question:opened", { pred: (p) => p.question?.text?.includes("snack") });
  const v1 = await attempt(p1, "activity:answer", { activityId: pollAct._id, questionId: pollQ.question.id, answer: 0 });
  check("poll vote is neutral (correct null, 0 pts)", v1.ack?.ok && v1.ack.correct === null && v1.ack.points === 0, JSON.stringify(v1.ack));
  await wait(1100); // let the poll-broadcast throttle clear
  await attempt(p2b, "activity:answer", { activityId: pollAct._id, questionId: pollQ.question.id, answer: 1 });
  const results = await p1.waitFor("poll:results", { pred: (p) => p.total >= 2 });
  check("poll:results distribution (counts only, never who)", results.counts[0] === 1 && results.counts[1] === 1 && results.total === 2, JSON.stringify(results));
  await wait(300);
  await attempt(org, "question:close", { activityId: pollAct._id }); // final unthrottled distribution + reveal
  await wait(300);
  await attempt(org, "activity:end", { activityId: pollAct._id, eventId: ev._id });

  /* 15. Q&A submit + upvote + moderation */
  await wait(300);
  const qaStart = await attempt(org, "activity:start", { activityId: qaAct._id, eventId: ev._id });
  check("QA activity starts", qaStart.ack?.ok === true, JSON.stringify(qaStart.ack));

  /* 21. late join mid-activity */
  const p3 = connect(p3Tok);
  const lateJoin = await attempt(p3, "event:join", { eventId: ev._id });
  check("late join sees the running QA activity", lateJoin.ack?.state?.activity?.type === "QA" && Array.isArray(lateJoin.ack?.state?.qa?.questions), JSON.stringify(lateJoin.ack?.state?.activity));

  const qaSub = await attempt(p1, "qa:submit", { activityId: qaAct._id, text: "Will there be a round 2?" });
  check("qa:submit ok", qaSub.ack?.ok === true, JSON.stringify(qaSub));
  const qaList = await p3.waitFor("qa:list", { pred: (p) => p.questions?.length >= 1 });
  check("qa:list broadcast (public list, counts only)", qaList.questions[0].text === "Will there be a round 2?" && qaList.questions[0].votes === 0);
  await wait(450); // QA list broadcast throttle (400ms)
  await attempt(p2b, "qa:upvote", { questionId: qaList.questions[0].id });
  const upvoted = await p1.waitFor("qa:list", { pred: (p) => p.questions?.[0]?.votes === 1 });
  check("qa upvote counted", upvoted.questions[0].votes === 1);
  await wait(300);
  const feat = await attempt(org, "qa:feature", { questionId: qaList.questions[0].id });
  check("qa:feature ok", feat.ack?.ok && feat.ack.status === "featured", JSON.stringify(feat.ack));
  await wait(300);
  const ans = await attempt(org, "qa:answer", { questionId: qaList.questions[0].id, answerText: "Yes — next month!" });
  check("qa:answer ok", ans.ack?.ok === true);
  await p1.waitFor("qa:list", { pred: (p) => p.questions?.[0]?.answerText === "Yes — next month!" });
  await wait(300);
  await attempt(org, "activity:end", { activityId: qaAct._id, eventId: ev._id });

  /* 16. chat + rate limit + pin + mute */
  const chat1 = await attempt(p1, "chat:send", { eventId: ev._id, text: "hello room" });
  check("chat:send ok", chat1.ack?.ok === true, JSON.stringify(chat1));
  const msg = await p2b.waitFor("chat:message", { pred: (p) => p.message?.text === "hello room" });
  check("chat:message broadcast (public identity)", msg.message.displayName === "Anu Rao");
  await attempt(p2b, "chat:send", { eventId: ev._id, text: "hi!" }); // first send on this socket: allowed
  const spam = await attempt(p2b, "chat:send", { eventId: ev._id, text: "too fast" }); // immediately again
  check("chat rate limit → RATE_LIMITED", errCode(spam) === "RATE_LIMITED", JSON.stringify(spam));
  await wait(300);
  const pin = await attempt(org, "chat:pin", { messageId: msg.message.id });
  check("chat:pin ok", pin.ack?.ok && pin.ack.pinned === true, JSON.stringify(pin.ack));
  await p2b.waitFor("chat:pinned", { pred: (p) => p.pinned === true });
  await wait(300);
  const mute = await attempt(org, "chat:mute", { eventId: ev._id, userId: p2u._id, muted: true });
  check("chat:mute ok", mute.ack?.ok && mute.ack.muted === true);
  await wait(1600); // past the chat cooldown — the MUTE must be the blocker, not the rate limit
  const mutedSend = await attempt(p2b, "chat:send", { eventId: ev._id, text: "am i muted?" });
  check("muted participant → MUTED", errCode(mutedSend) === "MUTED", JSON.stringify(mutedSend));

  /* 17. announcement banner */
  const ann = await attempt(org, "announcement:send", { eventId: ev._id, text: "Final results in a moment!" });
  check("announcement:send ok", ann.ack?.ok === true, JSON.stringify(ann));
  const banner = await p1.waitFor("announcement:new", { pred: (p) => p.text === "Final results in a moment!" });
  check("announcement:new broadcast", typeof banner.at === "number");

  /* 18. leaderboard checkpoint activity */
  await wait(300);
  const lbStart = await attempt(org, "activity:start", { activityId: lbAct._id, eventId: ev._id });
  check("LEADERBOARD checkpoint starts", lbStart.ack?.ok === true, JSON.stringify(lbStart.ack));
  await p1.waitFor("leaderboard:update", { pred: (p) => p.visible === true });
  check("checkpoint shows the board", true);
  await wait(300);
  await attempt(org, "activity:end", { activityId: lbAct._id, eventId: ev._id });
  await p1.waitFor("leaderboard:update", { pred: (p) => p.visible === false });
  check("checkpoint end hides the board", true);

  /* 22. end event → final results, snapshot, achievements, certificate, share */
  await wait(300); // organizer commands are cooled down 250ms apart
  const end = await attempt(org, "event:end", { eventId: ev._id });
  check("event:end ok with 3 participants", end.ack?.ok === true && end.ack.participants === 3, JSON.stringify(end.ack));
  const completed = await p1.waitFor("event:completed", { timeout: 8000 });
  const finalMe = (completed.leaderboard || []).find((e) => String(e.participantId) === String(p1u._id));
  check("completed broadcast has final board with P1 #1 @200", finalMe?.rank === 1 && finalMe?.score === 200, JSON.stringify(finalMe));

  const snap = await EventResult.findOne({ event: ev._id }).lean();
  check("immutable EventResult snapshot exists", Boolean(snap) && (snap.summary?.totalAnswers || 0) >= 5, JSON.stringify(snap?.summary));

  const res1 = await fetch(`${B}/events/${ev._id}/results`, { headers: { Authorization: `Bearer ${p1Tok}` } });
  const res1J = await res1.json();
  check("GET /results: participant row + summary", res1.ok && res1J.me?.rank === 1 && res1J.me?.score === 200 && (res1J.me?.accuracy ?? 0) >= 50, JSON.stringify(res1J.me));
  check(
    "achievements awarded (winner set)",
    ["first_live_event", "live_participant", "top_10", "top_3", "quiz_winner"].every((c) => (res1J.achievements || []).includes(c)),
    JSON.stringify(res1J.achievements)
  );
  check("certificate requested (winner)", res1J.certificate?.available === true && res1J.certificate?.kind === "winner", JSON.stringify(res1J.certificate));

  const share = await fetch(`${B}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p1Tok}` },
    body: JSON.stringify({ content: "What a night!", eventId: ev._id, type: "event_memory", visibility: "public" }),
  });
  const shareJ = await share.json();
  check("event_memory share freezes server stats", share.ok && shareJ.post?.memory?.rank === 1 && shareJ.post?.memory?.score === 200, JSON.stringify(shareJ.post?.memory));

  console.log(`\n${failed === 0 ? "✅" : "❌"} LIVE E2E: ${passed} passed, ${failed} failed`);
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
