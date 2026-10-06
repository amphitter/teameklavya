/**
 * EventHub Realtime Service (Part 4, Phase 2) — the live engine core.
 * ─────────────────────────────────────────────────────────────────────
 * Rooms (spec §2):        event:{eventId}  ·  event:{eventId}:activity:{activityId} (Phase 3+)
 * Presence (§4, §71):     IN-MEMORY ONLY — volatile state never touches MongoDB.
 * Persistence:            ParticipantSession (join identity) is the only DB write.
 * Duplicate sockets (§52): many sockets per user allowed, ONE logical participant.
 * Reconnect (§51):        re-join revalidates + returns full state; nothing restarts.
 *
 * Every command is authorized server-side (§68): organizer = canManageEvent.
 */
const mongoose = require("mongoose");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const ParticipantSession = require("../models/participantSession.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Ticket = require("../models/ticket.model");
const Activity = require("../models/activity.model");
const Question = require("../models/question.model");
const LiveAnswer = require("../models/liveAnswer.model");
const QAQuestion = require("../models/qaQuestion.model");
const LiveMessage = require("../models/liveMessage.model");
const resultService = require("./result.service");
const { validateActivity } = require("../services/quizValidation.service");
const { canManageEvent } = require("../middleware/auth.middleware");
// Part 5, Phase 2 — cross-socket rate guards (§24 REALTIME)
const { SlidingWindow } = require("../utils/frequency-limiter");
const { LIMITS, isRateLimitingDisabled } = require("../config/rate-limits");
const metrics = require("../services/metrics.service");
const { EVENTS, ERROR_CODES, socketError } = require("../config/socket-protocol");

let io = null;

/* ── In-memory room registry: eventId → room ──
 * room = {
 *   participants: Map<userId, { socketIds:Set, identity, state, ready, joinedAt, lastSeenAt }>,
 *   organizers:   Map<userId, { socketIds:Set }>,
 * } */
const rooms = new Map();

function roomOf(eventId) {
  const key = String(eventId);
  if (!rooms.has(key)) {
    rooms.set(key, { participants: new Map(), organizers: new Map() });
  }
  const room = rooms.get(key);
  // Phase 5 leaderboard room state (transient display data — scores live in DB):
  // lastRanks powers rankChange; questionsClosed powers every_n; leaderboardVisible
  // is the participant-screen flag.
  if (!room.lastRanks) room.lastRanks = new Map();
  if (typeof room.leaderboardVisible !== "boolean") room.leaderboardVisible = false;
  if (typeof room.questionsClosed !== "number") room.questionsClosed = 0;
  if (typeof room.lastBoardAt !== "number") room.lastBoardAt = 0;
  return room;
}

function roomKey(eventId) {
  return `event:${String(eventId)}`;
}

function activityRoomKey(eventId, activityId) {
  return `event:${String(eventId)}:activity:${String(activityId)}`;
}

/** Current (LIVE or PAUSED) activity of an event — DB is the source of truth. */
async function currentActivityOf(eventId) {
  return Activity.findOne({ event: eventId, state: { $in: ["LIVE", "PAUSED"] } })
    .select("type title state order startedAt")
    .lean();
}

function connectedCount(room) {
  let n = 0;
  room.participants.forEach((p) => {
    if (p.state === "connected" || p.state === "ready" || p.state === "active") n += 1;
  });
  return n;
}

function readyCount(room) {
  let n = 0;
  room.participants.forEach((p) => {
    if (p.ready) n += 1;
  });
  return n;
}

function participantList(room) {
  return Array.from(room.participants.values()).map((p) => ({
    userId: p.identity._id,
    displayName: p.displayName,
    username: p.identity.username,
    avatar: p.identity.profile?.avatar || "",
    state: p.state,
    ready: Boolean(p.ready),
    score: p.score || 0,
    muted: Boolean(p.muted),
    joinedAt: p.joinedAt,
  }));
}

/* ── Join validation chain (spec §7) — never trust the client ── */
const PRE_LIVE_STATES = ["DRAFT", "PUBLISHED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"];
const JOINABLE_STATES = ["CHECK_IN", "WAITING", "LIVE", "PAUSED"];
const ENDED_STATES = ["COMPLETED", "CANCELLED"];

async function validateJoin(user, eventId) {
  const event = await Event.findById(eventId).select(
    "title slug liveState visibility removedAt createdBy liveSettings organization"
  );
  if (!event || event.removedAt) {
    return { ok: false, code: ERROR_CODES.VALIDATION_FAILED, message: "Event not found", event: null };
  }
  if (ENDED_STATES.includes(event.liveState)) {
    return { ok: false, code: ERROR_CODES.EVENT_ENDED, message: "This event has already ended", event };
  }
  const isOrganizer = await canManageEvent(user, event);
  if (PRE_LIVE_STATES.includes(event.liveState)) {
    return {
      ok: false,
      code: ERROR_CODES.NOT_JOINABLE,
      message: "Event hasn't started yet.",
      event,
      isOrganizer,
      notStarted: true,
    };
  }
  if (isOrganizer) return { ok: true, event, isOrganizer };

  // Participant eligibility (spec §50) — all server-side
  if (event.visibility === "private") {
    const registered = await RegistrationResponse.exists({ eventId: event._id, userId: user.id });
    if (!registered) {
      return { ok: false, code: ERROR_CODES.NOT_AUTHORIZED, message: "This event is invite-only", event, isOrganizer };
    }
  }
  const settings = event.liveSettings || {};
  if (settings.requireRegistration) {
    const registered = await RegistrationResponse.exists({ eventId: event._id, userId: user.id });
    if (!registered) {
      return { ok: false, code: ERROR_CODES.REGISTRATION_REQUIRED, message: "You must register for this event first", event, isOrganizer };
    }
  }
  if (settings.requireCheckIn) {
    const checkedIn = await Ticket.exists({ eventId: event._id, userId: user.id, checkedIn: true });
    if (!checkedIn) {
      return { ok: false, code: ERROR_CODES.CHECK_IN_REQUIRED, message: "Check-in is required before joining", event, isOrganizer };
    }
  }
  return { ok: true, event, isOrganizer: false };
}

/* ── Role-scoped state snapshots (spec §78) ── */
async function stateForParticipant(eventId, userId) {
  const event = await Event.findById(eventId).select("title slug liveState liveSettings").lean();
  if (!event) return null;
  const room = roomOf(eventId);
  const session = await ParticipantSession.findOne({ event: eventId, user: userId }).lean();
  const entry = room.participants.get(String(userId));
  // Public identity preview for the waiting-room bubbles (§8–10) — no scores,
  // no private profile data, capped like the UI itself.
  const preview = Array.from(room.participants.values())
    .filter((p) => p.state !== "disconnected")
    .slice(-32)
    .map((p) => ({
      userId: p.identity._id,
      displayName: p.displayName,
      username: p.identity.username,
      avatar: p.identity.profile?.avatar || "",
    }));
  const activity = await currentActivityOf(eventId);
  // Open-question state for reconnects (§23): sanitized question + derived
  // remaining time + whether this participant already answered. No answer key.
  let question = null;
  if (
    activity &&
    (activity.type === "QUIZ" || activity.type === "POLL") &&
    activity.questionRuntime &&
    activity.questionRuntime.questionId
  ) {
    const runtime = activity.questionRuntime;
    const q = await sanitizedQuestionById(runtime.questionId);
    if (q) {
      const total = await Question.countDocuments({ activity: activity._id });
      const answeredDoc = session
        ? await LiveAnswer.exists({ session: session._id, question: q._id })
        : null;
      question = {
        id: q._id,
        type: q.type,
        text: q.text,
        media: q.media,
        options: q.options,
        points: q.points,
        index: runtime.index,
        total,
        startedAt: runtime.startedAt ? new Date(runtime.startedAt).getTime() : null,
        durationSec: runtime.durationSec,
        elapsedBeforePause: runtime.elapsedBeforePause || 0,
        closed: runtime.closed,
        remainingMs: remainingMs(runtime),
        answered: Boolean(answeredDoc),
      };
      // Phase 6 (§39): polls expose the live distribution (counts only)
      if (activity.type === "POLL") {
        question.results = await pollDistribution(q._id);
      }
    }
  }
  // Phase 6 (§40–41): Q&A list while a QA activity runs + chat state
  const qa =
    activity && activity.type === "QA"
      ? { closed: Boolean(activity.qaClosed), questions: await qaListFor(activity._id, userId, false) }
      : null;
  const chat = {
    enabled: event.liveSettings?.chatEnabled !== false,
    muted: Boolean(session?.muted),
    messages: await chatHistory(eventId),
  };
  // Phase 5 (§31–38): leaderboard visibility is CONFIG-gated; the board is
  // only in the snapshot while it's on participant screens. myRank is the
  // participant's own data (score + join tiebreak) and is always included.
  const mode = event.liveSettings?.leaderboardVisibility || "after_activity";
  const boardAllowed = mode !== "never" && mode !== "final" && event.liveState !== "COMPLETED";
  const leaderboardVisible = Boolean(boardAllowed && room.leaderboardVisible);
  let leaderboard = null;
  if (leaderboardVisible) {
    leaderboard = (await computeBoard(eventId, Boolean(event.liveSettings?.teamMode), room, false)).map(
      ({ sessionId, ...rest }) => rest
    );
  }
  let myRank = null;
  if (session) {
    const myScore = session.score || 0;
    myRank =
      1 +
      (await ParticipantSession.countDocuments({
        event: eventId,
        $or: [{ score: { $gt: myScore } }, { score: myScore, joinedAt: { $lt: session.joinedAt } }],
      }));
  }
  // Phase 7 (§47): latest announcement while fresh (10 min) — banner state
  const announcement = room.lastAnnouncement && Date.now() - room.lastAnnouncement.at < 10 * 60 * 1000
    ? room.lastAnnouncement
    : null;
  return {
    event: { title: event.title, slug: event.slug, liveState: event.liveState, joinCode: event.joinCode },
    activity: activity
      ? { id: activity._id, type: activity.type, title: activity.title, state: activity.state }
      : null,
    question,
    qa,
    chat,
    announcement,
    leaderboardVisible,
    leaderboard,
    myRank,
    me: {
      joined: Boolean(session),
      ready: Boolean(session?.readyAt),
      connected: Boolean(entry && entry.state !== "disconnected"),
      score: session?.score || 0,
    },
    participants: preview,
    counts: { connected: connectedCount(room), ready: readyCount(room) },
  };
}

async function stateForOrganizer(eventId) {
  const event = await Event.findById(eventId).select("title slug liveState joinCode liveSettings").lean();
  if (!event) return null;
  const room = roomOf(eventId);
  const [registered, checkedIn] = await Promise.all([
    RegistrationResponse.countDocuments({ eventId }),
    Ticket.countDocuments({ eventId, checkedIn: true }),
  ]);
  const activity = await currentActivityOf(eventId);
  // Organizer sees the answer key for the open question (they run the show)
  // plus a live answered count — identities stay private (§39).
  let question = null;
  if (
    activity &&
    (activity.type === "QUIZ" || activity.type === "POLL") &&
    activity.questionRuntime &&
    activity.questionRuntime.questionId
  ) {
    const runtime = activity.questionRuntime;
    const [q, total, answeredCount] = await Promise.all([
      Question.findById(runtime.questionId).select("+correctAnswer").lean(),
      Question.countDocuments({ activity: activity._id }),
      LiveAnswer.countDocuments({ question: runtime.questionId }),
    ]);
    if (q) {
      question = {
        id: q._id,
        type: q.type,
        text: q.text,
        media: q.media,
        options: q.options,
        points: q.points,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        // Phase 6 (§39): poll distribution for the organizer view too
        ...(activity.type === "POLL" ? { results: await pollDistribution(q._id) } : {}),
        index: runtime.index,
        total,
        startedAt: runtime.startedAt ? new Date(runtime.startedAt).getTime() : null,
        durationSec: runtime.durationSec,
        elapsedBeforePause: runtime.elapsedBeforePause || 0,
        closed: runtime.closed,
        remainingMs: remainingMs(runtime),
        answeredCount,
      };
    }
  }
  // Phase 6 (§40–41): organizer sees the QA list incl. hidden + chat state
  const qa =
    activity && activity.type === "QA"
      ? { closed: Boolean(activity.qaClosed), questions: await qaListFor(activity._id, null, true) }
      : null;
  const chat = {
    enabled: event.liveSettings?.chatEnabled !== false,
    muted: false,
    messages: await chatHistory(eventId),
  };
  // Phase 5: the organizer always sees the live board (their own event),
  // enriched with per-participant answer stats (§69).
  const leaderboard = await organizerBoard(eventId, Boolean(event.liveSettings?.teamMode));
  // Phase 7 (§47): latest announcement while fresh (organizer sees it too)
  const announcement = room.lastAnnouncement && Date.now() - room.lastAnnouncement.at < 10 * 60 * 1000
    ? room.lastAnnouncement
    : null;
  return {
    event: { title: event.title, slug: event.slug, liveState: event.liveState, joinCode: event.joinCode },
    activity: activity
      ? { id: activity._id, type: activity.type, title: activity.title, state: activity.state }
      : null,
    question,
    qa,
    chat,
    announcement,
    leaderboard,
    leaderboardVisible: room.leaderboardVisible,
    leaderboardMode: event.liveSettings?.leaderboardVisibility || "after_activity",
    teamMode: Boolean(event.liveSettings?.teamMode),
    participants: participantList(room),
    counts: { registered, checkedIn, connected: connectedCount(room), ready: readyCount(room) },
  };
}

/* ── Leaderboard Engine (Phase 5 — spec §31–38, §88–89) ─────────────
 * One scoring engine (Phase 4) feeds one ranking engine: sessions are the
 * source of truth, ranks are derived (score desc, joinedAt asc), and the
 * DISPLAY is gated by liveSettings.leaderboardVisibility. Board data is
 * sent to participants only while visible — never for "never"/"final"
 * modes (§31–33). rankChange is computed against the last BROADCAST
 * snapshot kept in room state. */

/** Raw ranked entries (no rank-change info) from ParticipantSessions. */
async function rankedSessions(eventId) {
  const sessions = await ParticipantSession.find({ event: eventId })
    .sort({ score: -1, joinedAt: 1 })
    .populate("user", "firstName lastName username profile")
    .lean();
  return sessions.map((sess, i) => ({
    key: String(sess.user?._id || sess._id), // stable key (§88: no flash re-render)
    participantId: sess.user?._id,
    sessionId: String(sess._id), // for organizer answer-stats lookup
    displayName: `${sess.user?.firstName || ""} ${sess.user?.lastName || ""}`.trim() || "Participant",
    username: sess.user?.username,
    avatar: sess.user?.profile?.avatar || "",
    team: sess.teamName || "",
    score: sess.score || 0,
    rank: i + 1,
  }));
}

/** Team-mode board (foundation, §37): same scores aggregated by team at
 *  DISPLAY time — the scoring engine is never duplicated. Solo sessions
 *  (no teamName) become 1-member pseudo-teams so nobody disappears. */
function teamBoard(entries) {
  const groups = new Map();
  for (const e of entries) {
    const name = e.team || e.displayName;
    const g = groups.get(name) || { team: name, memberCount: 0, score: 0, members: [] };
    g.memberCount += 1;
    g.score += e.score;
    g.members.push(e.key);
    groups.set(name, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.score - a.score || a.team.localeCompare(b.team))
    .map((g, i) => ({ key: `team:${g.team}`, team: g.team, memberCount: g.memberCount, score: g.score, rank: i + 1 }));
}

/** Per-participant answer stats for the ORGANIZER view (§69) — real
 *  LiveAnswer aggregation: correct count + average response time. */
async function organizerAnswerStats(eventId) {
  const rows = await LiveAnswer.aggregate([
    { $match: { event: new mongoose.Types.ObjectId(String(eventId)) } },
    {
      $group: {
        _id: "$session",
        correct: { $sum: { $cond: [{ $eq: ["$correct", true] }, 1, 0] } },
        answered: { $sum: 1 },
        avgResponseMs: { $avg: "$responseTime" },
      },
    },
  ]);
  const stats = new Map();
  for (const r of rows) stats.set(String(r._id), r);
  return stats;
}

/**
 * Broadcast the leaderboard. `visible` controls the participant screen.
 * When visible, the full board is sent to the event room; when hidden,
 * participants only get { visible: false } — no board data leaks (§31–33).
 * Organizer sockets always receive the board + their answer stats.
 */
/** Board entries with rankChange. updateRanks=false = PEEK (state snapshots,
 *  reconnects) — the last-broadcast snapshot is not shifted. */
async function computeBoard(eventId, teamMode, room, updateRanks) {
  let base = await rankedSessions(eventId);
  if (teamMode) base = teamBoard(base);
  return base.map((e) => {
    const prev = room.lastRanks.get(e.key);
    if (updateRanks) room.lastRanks.set(e.key, e.rank);
    return {
      ...e,
      previousRank: prev ?? null,
      rankChange: prev == null ? null : prev - e.rank, // +up / −down / 0 steady
    };
  });
}

async function broadcastLeaderboard(eventId, event, visible) {
  const room = roomOf(eventId);
  const teamMode = Boolean(event?.liveSettings?.teamMode);
  const board = await computeBoard(eventId, teamMode, room, true);

  const payload = { visible, serverTime: Date.now() };
  if (visible) {
    // Public board: strip the internal sessionId (organizer-only lookup key)
    const publicBoard = board.map(({ sessionId, ...rest }) => rest);
    io.to(roomKey(eventId)).emit(EVENTS.S_LEADERBOARD_UPDATE, { ...payload, leaderboard: publicBoard });
  } else {
    io.to(roomKey(eventId)).emit(EVENTS.S_LEADERBOARD_UPDATE, payload);
  }

  // Organizer-only enriched emit (§69): per-participant correct count +
  // average response time from LiveAnswer. Never broadcast to the room —
  // answerer identities are private for participants (§39).
  if (room.organizers.size) {
    const keyedBoard = await organizerBoard(eventId, teamMode);
    const keyed = { ...payload, visible, leaderboard: keyedBoard };
    for (const org of room.organizers.values()) {
      for (const sid of org.socketIds) io.to(sid).emit(EVENTS.S_LEADERBOARD_UPDATE, keyed);
    }
  }
  room.leaderboardVisible = visible;
  room.lastBoardAt = Date.now();
  return board;
}

/** Board + per-participant answer stats, sessionId stripped (organizer view). */
async function organizerBoard(eventId, teamMode) {
  const room = roomOf(eventId);
  const board = await computeBoard(eventId, teamMode, room, false);
  if (teamMode) return board.map(({ sessionId, ...rest }) => rest);
  const stats = await organizerAnswerStats(eventId);
  return board.map((e) => {
    const st = stats.get(e.sessionId);
    const { sessionId, ...rest } = e;
    return st
      ? { ...rest, correctCount: st.correct, answeredCount: st.answered, avgResponseMs: Math.round(st.avgResponseMs || 0) }
      : rest;
  });
}

/** Visibility gate (§33): should the participant screen show the board now? */
function leaderboardAutoShow(liveSettings, reason, room) {
  const mode = liveSettings?.leaderboardVisibility || "after_activity";
  if (mode === "never" || mode === "final") return false;
  if (reason === "question_close") {
    if (mode === "every_question") return true;
    if (mode === "every_n") {
      return room.questionsClosed > 0 && room.questionsClosed % Math.max(1, liveSettings.leaderboardInterval || 1) === 0;
    }
    return false;
  }
  if (reason === "activity_end") return mode === "after_activity";
  return false;
}

/* ── Q&A + Chat + Poll (Phase 6 — spec §39–43) ──────────────────────
 * Polls reuse the Phase 4 answer engine (one generic pipeline); only the
 * FEEDBACK differs (neutral) and results are a distribution broadcast —
 * counts only, never who voted (§39). Q&A votes likewise broadcast as
 * counts. Chat is event-scoped, persisted, and moderated with soft
 * deletes (§41). */

/** QA question for the wire: public identity, vote COUNT (+ own vote flag),
 *  never the voter list (§40). */
function publicQAQuestion(doc, userId, includeHidden) {
  return {
    id: doc._id,
    text: doc.text,
    author: {
      displayName: `${doc.author?.firstName || ""} ${doc.author?.lastName || ""}`.trim() || "Participant",
      username: doc.author?.username,
      avatar: doc.author?.profile?.avatar || "",
    },
    votes: (doc.votes || []).length,
    voted: userId ? (doc.votes || []).some((v) => String(v) === String(userId)) : false,
    status: doc.status,
    answerText: doc.answerText || "",
    answeredAt: doc.answeredAt,
    createdAt: doc.createdAt,
  };
}

/** QA list for an activity (state snapshots): featured first, then votes,
 *  then oldest first. Hidden questions are organizer-only (moderation audit). */
async function qaListFor(activityId, userId, includeHidden) {
  const filter = includeHidden
    ? { activity: activityId }
    : { activity: activityId, status: { $in: ["open", "featured", "answered"] } };
  const docs = await QAQuestion.find(filter).populate("author", "firstName lastName username profile").lean();
  return sortQADocs(docs).map((d) => publicQAQuestion(d, userId, includeHidden));
}

/** Sort QA docs: featured first, then votes, then oldest. */
function sortQADocs(docs) {
  const order = { featured: 0, open: 1, answered: 2, hidden: 3, closed: 3 };
  return [...docs].sort(
    (a, b) =>
      (order[a.status] ?? 3) - (order[b.status] ?? 3) ||
      (b.votes || []).length - (a.votes || []).length ||
      new Date(a.createdAt) - new Date(b.createdAt)
  );
}

/** Broadcast the QA list — PERSONALIZED per socket so every participant
 *  keeps their own `voted` flag (docs are loaded once, mapped per user).
 *  Organizer sockets additionally see hidden questions. Throttled unless
 *  forced (moderation + submits force; upvotes ride the throttle). */
async function broadcastQAList(activity, { force = false } = {}) {
  const room = roomOf(activity.event);
  if (!force && Date.now() - (room.qaListAt || 0) < 400) return; // upvote storms
  room.qaListAt = Date.now();
  const closed = Boolean(activity.qaClosed);
  const base = { activityId: activity._id, closed };

  const publicDocs = sortQADocs(
    await QAQuestion.find({ activity: activity._id, status: { $in: ["open", "featured", "answered"] } })
      .populate("author", "firstName lastName username profile")
      .lean()
  );
  // Participants: their own voted flags, computed from the same docs
  for (const [uid, p] of room.participants) {
    const questions = publicDocs.map((d) => publicQAQuestion(d, uid));
    for (const sid of p.socketIds) io.to(sid).emit(EVENTS.S_QA_LIST, { ...base, questions });
  }
  // Organizers: full list incl. hidden (moderation audit)
  if (room.organizers.size) {
    const allDocs =
      publicDocs.length && (await QAQuestion.countDocuments({ activity: activity._id })) === publicDocs.length
        ? publicDocs
        : sortQADocs(
            await QAQuestion.find({ activity: activity._id })
              .populate("author", "firstName lastName username profile")
              .lean()
          );
    const keyed = allDocs.map((d) => publicQAQuestion(d, null));
    for (const org of room.organizers.values()) {
      for (const sid of org.socketIds) io.to(sid).emit(EVENTS.S_QA_LIST, { ...base, questions: keyed });
    }
  }
}

/** Poll distribution from LiveAnswer — counts per option, total (§39).
 *  Never includes who voted. */
async function pollDistribution(questionId) {
  const q = await Question.findById(questionId).select("options").lean();
  const optionCount = Math.max(2, (q?.options || []).length);
  const rows = await LiveAnswer.aggregate([
    { $match: { question: new mongoose.Types.ObjectId(String(questionId)) } },
    { $group: { _id: "$answer", count: { $sum: 1 } } },
  ]);
  const counts = new Array(optionCount).fill(0);
  let total = 0;
  for (const r of rows) {
    const idx = Number(r._id);
    if (Number.isInteger(idx) && idx >= 0 && idx < optionCount) counts[idx] = r.count;
    total += r.count;
  }
  return { counts, total };
}

/** Broadcast the poll distribution to the event room. */
async function pollResults(activity, questionId) {
  const { counts, total } = await pollDistribution(questionId);
  io.to(roomKey(activity.event)).emit(EVENTS.S_POLL_RESULTS, {
    activityId: activity._id,
    questionId,
    counts,
    total,
    serverTime: Date.now(),
  });
}

/** Chat message for the wire: public identity only. */
function publicChatMessage(doc) {
  return {
    id: doc._id,
    senderId: doc.sender?._id || doc.sender,
    displayName: `${doc.sender?.firstName || ""} ${doc.sender?.lastName || ""}`.trim() || "Participant",
    username: doc.sender?.username,
    avatar: doc.sender?.profile?.avatar || "",
    text: doc.text,
    pinned: Boolean(doc.pinned),
    createdAt: doc.createdAt,
  };
}

/** Last 50 chat messages (soft-deleted excluded), oldest → newest. */
async function chatHistory(eventId) {
  const docs = await LiveMessage.find({ event: eventId, deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("sender", "firstName lastName username profile")
    .lean();
  return docs.reverse().map(publicChatMessage);
}

/* ── Quiz Engine (Phase 4 — spec §16, §22, §27–30, §55) ──────────────
 * Server owns the clock: runtime lives on the Activity document, remaining
 * time is always derived (startedAt + duration − pauses) vs SERVER time.
 * Question delivery is sanitized — the answer key never leaves the server
 * for participants until the question is closed (no more scoring). */

/** Sanitized question for participants (select:false keeps correctAnswer out). */
async function sanitizedQuestionById(questionId) {
  return Question.findById(questionId)
    .select("type text media options points timeLimit order")
    .lean();
}

/** Server-clock remaining ms for an open question runtime. */
function remainingMs(runtime, now = Date.now()) {
  if (!runtime || !runtime.questionId || runtime.closed) return 0;
  const elapsed =
    (runtime.elapsedBeforePause || 0) +
    (runtime.startedAt ? now - new Date(runtime.startedAt).getTime() : 0);
  return Math.max(0, (runtime.durationSec || 30) * 1000 - elapsed);
}

/** Broadcast the open question: sanitized to the room + answer key to
 *  ORGANIZER sockets only (§21 — the key never reaches participants). */
async function broadcastQuestionOpened(activity, q, index, total) {
  const runtime = activity.questionRuntime;
  const answeredCount = await LiveAnswer.countDocuments({ question: q._id });
  const payload = {
    activityId: activity._id,
    question: {
      id: q._id,
      type: q.type,
      text: q.text,
      media: q.media,
      options: q.options,
      points: q.points,
    },
    index,
    total,
    startedAt: runtime.startedAt ? new Date(runtime.startedAt).getTime() : null,
    durationSec: runtime.durationSec,
    elapsedBeforePause: runtime.elapsedBeforePause || 0,
    answeredCount,
    serverTime: Date.now(),
  };
  // Everyone gets the sanitized question (no answer key, §21)
  io.to(roomKey(activity.event)).emit(EVENTS.S_QUESTION_OPENED, payload);
  // Organizer sockets additionally get the key + explanation
  const keyed = {
    ...payload,
    question: { ...payload.question, correctAnswer: q.correctAnswer ?? null, explanation: q.explanation || "" },
  };
  for (const org of roomOf(activity.event).organizers.values()) {
    for (const sid of org.socketIds) io.to(sid).emit(EVENTS.S_QUESTION_OPENED, keyed);
  }
}

/** Open question [index] of an activity and broadcast it (sanitized). */
async function openQuestion(activity, index) {
  const questions = await Question.find({ activity: activity._id }).sort({ order: 1 }).select("+correctAnswer").lean();
  if (index < 0 || index >= questions.length) return false;
  const q = questions[index];
  activity.questionRuntime = {
    questionId: q._id,
    index,
    durationSec: q.timeLimit || 30,
    startedAt: new Date(),
    elapsedBeforePause: 0,
    closed: false,
  };
  await activity.save();
  roomOf(activity.event).leaderboardVisible = false; // question screen supersedes the board
  await broadcastQuestionOpened(activity, q, index, questions.length);
  return true;
}

/** Close the open question; reveal correct answer + explanation (answers stopped). */
async function closeQuestion(activity, opts = {}) {
  const count = opts.count !== false; // question:prev re-opens — not a checkpoint
  const runtime = activity.questionRuntime;
  if (!runtime || !runtime.questionId || runtime.closed) return false;
  runtime.closed = true;
  await activity.save();
  const q = await Question.findById(runtime.questionId).select("+correctAnswer").lean();
  io.to(roomKey(activity.event)).emit(EVENTS.S_QUESTION_CLOSED, {
    activityId: activity._id,
    questionId: runtime.questionId,
    correctAnswer: q?.correctAnswer ?? null,
    explanation: q?.explanation || "",
    serverTime: Date.now(),
  });
  // Phase 5 (§33): auto-show the leaderboard per visibility config
  if (count) {
    const room = roomOf(activity.event);
    room.questionsClosed += 1;
    const ev = await Event.findById(activity.event).select("liveSettings");
    if (ev && leaderboardAutoShow(ev.liveSettings, "question_close", room)) {
      await broadcastLeaderboard(activity.event, ev, true);
    }
    // Phase 6 (§39): final poll distribution on close (unthrottled)
    if (activity.type === "POLL") {
      await pollResults(activity, runtime.questionId);
    }
  }
  return true;
}

/** Pause the question clock (organizer pause) — returns frozen remaining ms. */
function freezeQuestionClock(activity) {
  const runtime = activity.questionRuntime;
  if (!runtime || !runtime.questionId || runtime.closed || !runtime.startedAt) return null;
  const frozen = remainingMs(runtime);
  runtime.elapsedBeforePause = (runtime.elapsedBeforePause || 0) + (Date.now() - new Date(runtime.startedAt).getTime());
  runtime.startedAt = null;
  return frozen;
}

/** Server-authoritative scoring (spec §28–30) — configurable, never client input. */
function scoreAnswer(question, answer, responseTimeMs, scoring) {
  const cfg = scoring || {};
  const base = cfg.questionWeighting ? Number(question.points) || 100 : Number(cfg.basePoints ?? 100);
  const durationMs = (question.timeLimit || 30) * 1000;

  const finish = (correct, points, status = "scored") => ({ correct, points, status });

  if (question.type === "SHORT_ANSWER" || question.type === "LONG_ANSWER") {
    return finish(null, 0, "pending_review"); // subjective — never client-graded
  }

  let correct = false;
  let partialRatio = 0;
  if (question.type === "MULTI_SELECT") {
    const given = Array.isArray(answer) ? [...new Set(answer.map(Number))].sort((a, b) => a - b) : [];
    const key = Array.isArray(question.correctAnswer) ? [...question.correctAnswer].map(Number).sort((a, b) => a - b) : [];
    correct = given.length === key.length && given.every((v, i) => v === key[i]);
    if (!correct && cfg.partialScoring && given.length && given.every((g) => key.includes(g))) {
      partialRatio = given.length / Math.max(1, key.length);
    }
  } else {
    correct = Number(answer) === Number(question.correctAnswer);
  }

  if (correct) {
    // Speed bonus: linear decay — full bonus at instant answer, 0 at expiry (§29)
    let bonus = 0;
    if (Number(cfg.speedBonus) > 0) {
      bonus = Math.round(Number(cfg.speedBonus) * Math.max(0, 1 - responseTimeMs / durationMs));
    }
    return finish(true, base + bonus);
  }
  if (partialRatio > 0) {
    return finish(false, Math.round(base * partialRatio));
  }
  return finish(false, Number(cfg.negativeMarking) > 0 ? -Number(cfg.negativeMarking) : 0);
}

/* ── Organizer command engine (Phase 3 — spec §15, §57, §92) ──
 * Every command: rate-cooled, activity/event loaded from DB, ownership
 * verified server-side. Organizer A can never command Event B. */

async function commandGuard(socket, payload, needActivityId) {
  const now = Date.now();
  if (socket.data.cmdAt && now - socket.data.cmdAt < 250) {
    emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many commands — slow down");
    return null;
  }
  socket.data.cmdAt = now;

  if (needActivityId) {
    const activityId = String(payload?.activityId || "");
    if (!mongoose.isValidObjectId(activityId)) {
      emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Invalid activity");
      return null;
    }
    const activity = await Activity.findById(activityId);
    if (!activity) {
      emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Activity not found");
      return null;
    }
    const event = await Event.findById(activity.event).select("liveState removedAt");
    if (!event || event.removedAt) {
      emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      return null;
    }
    if (!(await canManageEvent(socket.data.user, event))) {
      emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to control this event");
      return null;
    }
    return { activity, event };
  }
  return {};
}

/** Public activity shape for broadcasts. */
function publicActivity(a) {
  return { id: a._id, type: a.type, title: a.title, state: a.state };
}

/** Start an activity (validation → single-active invariant → rooms → broadcast). */
async function startActivity(socket, activity, event, ack) {
  if (event.liveState !== "LIVE") {
    emitError(socket, ERROR_CODES.NOT_LIVE, "Start the event first");
    if (ack) ack({ ok: false, message: "Start the event first" });
    return false;
  }
  if (activity.state === "LIVE") {
    if (ack) ack({ ok: true, alreadyLive: true });
    return true;
  }
  if (activity.state === "COMPLETED") {
    emitError(socket, ERROR_CODES.NOT_JOINABLE, "This activity has already completed");
    if (ack) ack({ ok: false, message: "Activity already completed" });
    return false;
  }

  // Malformed quizzes/polls can never go live (spec §26)
  if (activity.type === "QUIZ" || activity.type === "POLL") {
    const questions = await Question.find({ activity: activity._id }).sort({ order: 1 }).select("+correctAnswer").lean();
    const check = validateActivity(activity, questions);
    if (!check.valid) {
      emitError(socket, ERROR_CODES.VALIDATION_FAILED, `Activity is not ready: ${check.errors[0]}`);
      if (ack) ack({ ok: false, message: check.errors[0] });
      return false;
    }
  }

  // Single-active-activity invariant: end any running activity first
  const running = await Activity.findOne({ event: activity.event, state: { $in: ["LIVE", "PAUSED"] } });
  if (running && String(running._id) !== String(activity._id)) {
    await endActivity(activity.event, running, socket.data.user.id);
  }

  activity.state = "LIVE";
  activity.startedAt = new Date();
  await activity.save();

  const aRoom = activityRoomKey(activity.event, activity._id);
  io.in(roomKey(activity.event)).socketsJoin(aRoom);

  // Transition cue (§43) then start
  io.to(roomKey(activity.event)).emit(EVENTS.S_ACTIVITY_STARTING, {
    activity: publicActivity(activity),
    serverTime: Date.now(),
  });
  io.to(roomKey(activity.event)).emit(EVENTS.S_ACTIVITY_STARTED, {
    activity: publicActivity(activity),
    serverTime: Date.now(),
  });
  // Quizzes and polls open their first question immediately (§97: Start → Question 1)
  if (activity.type === "QUIZ" || activity.type === "POLL") {
    await openQuestion(activity, 0);
  }
  // LEADERBOARD activity = organizer-defined checkpoint (§33): show the board.
  // NB: the commandGuard event only selects liveState/removedAt — reload
  // liveSettings so the visibility CONFIG wins over the checkpoint.
  if (activity.type === "LEADERBOARD") {
    const ev = event?.liveSettings ? event : await Event.findById(activity.event).select("liveSettings");
    const mode = ev?.liveSettings?.leaderboardVisibility || "after_activity";
    if (mode !== "never" && mode !== "final") {
      await broadcastLeaderboard(activity.event, ev, true);
    }
  }
  if (ack) ack({ ok: true, activity: publicActivity(activity) });
  return true;
}

/** End an activity: state COMPLETED, leave activity room, broadcast. */
async function endActivity(eventId, activity, endedBy) {
  if (activity.state === "COMPLETED") return;
  activity.state = "COMPLETED";
  activity.endedAt = new Date();
  await activity.save();
  io.in(activityRoomKey(eventId, activity._id)).socketsLeave(activityRoomKey(eventId, activity._id));
  io.to(roomKey(eventId)).emit(EVENTS.S_ACTIVITY_ENDED, {
    activityId: activity._id,
    endedBy: endedBy || null,
    serverTime: Date.now(),
  });
  // Phase 5 (§33): after_activity shows the board; ending a LEADERBOARD
  // checkpoint hides it again.
  const room = roomOf(eventId);
  const ev = await Event.findById(eventId).select("liveSettings");
  if (activity.type === "LEADERBOARD") {
    if (room.leaderboardVisible) await broadcastLeaderboard(eventId, ev, false);
  } else if (ev && leaderboardAutoShow(ev.liveSettings, "activity_end", room)) {
    await broadcastLeaderboard(eventId, ev, true);
  }
}

/* ── Socket handler wiring ── */
/* ══ Cross-socket rate guards (Part 5, Phase 2 — §24 REALTIME) ══════════
 * The per-socket cooldowns in the handlers below stay untouched; these
 * windows add the per-user / per-IP dimension (reconnect storms, join
 * and answer spam from many sockets at once). Numbers: config/rate-limits.js */
const connectGuardUser = new SlidingWindow(LIMITS.REALTIME_CONNECT_USER.limit, LIMITS.REALTIME_CONNECT_USER.windowMs);
const connectGuardIp = new SlidingWindow(LIMITS.REALTIME_CONNECT_IP.limit, LIMITS.REALTIME_CONNECT_IP.windowMs);
const joinGuard = new SlidingWindow(LIMITS.REALTIME_JOIN.limit, LIMITS.REALTIME_JOIN.windowMs);
const answerGuard = new SlidingWindow(LIMITS.REALTIME_ANSWER.limit, LIMITS.REALTIME_ANSWER.windowMs);

function emitError(socket, code, message) {
  socket.emit(EVENTS.S_ERROR, socketError(code, message));
}

function registerHandlers(socket) {
  const user = socket.data.user;

  /* event:join { eventId } */
  socket.on(EVENTS.C_EVENT_JOIN, async (payload, ack) => {
    try {
      const now = Date.now();
      if (socket.data.joinAttemptAt && now - socket.data.joinAttemptAt < 1200) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Slow down — try again in a moment");
        return;
      }
      socket.data.joinAttemptAt = now;

      // Per-user join cap (§24/§27) — cross-socket; the 1.2s per-socket cooldown above stays
      if (!isRateLimitingDisabled() && !joinGuard.allow(`u:${user?.id || socket.id}`).allowed) {
        metrics.recordRateLimit("REALTIME_JOIN");
        return emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many join attempts — slow down");
      }

      const eventId = String(payload?.eventId || "");
      if (!mongoose.isValidObjectId(eventId)) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Invalid event");
      }

      /* Projector / display mode (Phase 7 — spec §46): a READ-ONLY mirror of
       * participant broadcasts. No session, no presence, no scores of its
       * own, no controls — and it can NEVER receive organizer-only data
       * (answer keys, stats), so projecting it leaks nothing. */
      if (payload?.display) {
        const event = await Event.findById(eventId).select("liveState removedAt");
        if (!event || event.removedAt) {
          return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
        }
        socket.join(roomKey(eventId));
        socket.data.eventId = eventId;
        socket.data.isOrganizer = false;
        socket.data.isDisplay = true;
        const state = await stateForParticipant(eventId, user.id);
        if (ack) ack({ ok: true, role: "display", state });
        socket.emit(EVENTS.S_EVENT_STATE, state);
        return;
      }

      const result = await validateJoin(user, eventId);
      if (!result.ok) {
        if (ack) ack({ ok: false, code: result.code, message: result.message, notStarted: Boolean(result.notStarted) });
        return emitError(socket, result.code, result.message);
      }
      const { event, isOrganizer } = result;
      const room = roomOf(eventId);
      socket.join(roomKey(eventId));
      socket.data.eventId = eventId;
      socket.data.isOrganizer = Boolean(isOrganizer);

      if (isOrganizer) {
        // Organizer: presence tracked, no participant session
        const org = room.organizers.get(user.id) || { socketIds: new Set() };
        org.socketIds.add(socket.id);
        room.organizers.set(user.id, org);
        const state = await stateForOrganizer(eventId);
        if (ack) ack({ ok: true, role: "organizer", state });
        socket.emit(EVENTS.S_EVENT_STATE, state);
      } else {
        // Participant: idempotent persistent session (existing score/join kept)
        const session = await ParticipantSession.findOneAndUpdate(
          { event: eventId, user: user.id },
          { $setOnInsert: { event: eventId, user: user.id, joinedAt: new Date() } },
          { upsert: true, new: true }
        );
        const dbUser = await User.findById(user.id).select("firstName lastName username profile").lean();
        const entry = room.participants.get(user.id) || {
          socketIds: new Set(),
          identity: dbUser,
          displayName: `${dbUser?.firstName || ""} ${dbUser?.lastName || ""}`.trim(),
          state: "connected",
          ready: Boolean(session.readyAt),
          joinedAt: new Date(),
          lastSeenAt: new Date(),
          score: session.score || 0,
          muted: Boolean(session.muted),
        };
        entry.socketIds.add(socket.id);
        entry.state = entry.ready ? "ready" : "connected";
        entry.lastSeenAt = new Date();
        entry.muted = Boolean(session.muted);
        room.participants.set(user.id, entry);

        // Late joiners (spec §54): join the running activity room when allowed
        const current = await currentActivityOf(eventId);
        if (current && (event.liveSettings || {}).allowLateJoin !== false) {
          socket.join(activityRoomKey(eventId, current._id));
        }

        // Everyone in the room sees the join (public identity only, §10)
        io.to(roomKey(eventId)).emit(EVENTS.S_PARTICIPANT_JOINED, {
          participant: {
            userId: entry.identity._id,
            displayName: entry.displayName,
            username: entry.identity.username,
            avatar: entry.identity.profile?.avatar || "",
          },
          connected: connectedCount(room),
        });
        io.to(roomKey(eventId)).emit(EVENTS.S_READY_COUNT, {
          ready: readyCount(room),
          total: room.participants.size,
        });

        const state = await stateForParticipant(eventId, user.id);
        if (ack) ack({ ok: true, role: "participant", state });
        socket.emit(EVENTS.S_EVENT_STATE, state);
      }
    } catch (error) {
      console.error("event:join error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Join failed — please retry");
    }
  });

  /* event:ready { eventId } */
  socket.on(EVENTS.C_EVENT_READY, async (payload) => {
    try {
      if (socket.data.isDisplay) return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Display is view-only");
      const eventId = String(payload?.eventId || "");
      if (socket.data.eventId !== eventId || socket.data.isOrganizer) return;
      const room = roomOf(eventId);
      const entry = room.participants.get(user.id);
      if (!entry || entry.ready) return;

      entry.ready = true;
      entry.state = "ready";
      await ParticipantSession.updateOne({ event: eventId, user: user.id }, { $set: { readyAt: new Date() } });
      io.to(roomKey(eventId)).emit(EVENTS.S_READY_COUNT, {
        ready: readyCount(room),
        total: room.participants.size,
      });
    } catch (error) {
      console.error("event:ready error:", error.message);
    }
  });

  /* event:leave { eventId } */
  socket.on(EVENTS.C_EVENT_LEAVE, async (payload) => {
    try {
      const eventId = String(payload?.eventId || "");
      if (socket.data.eventId !== eventId) return;
      await handleLeave(socket, eventId, "left");
    } catch (_error) {
      /* ignore */
    }
  });

  /* event:start { eventId } — organizer only (spec §11, §15) */
  socket.on(EVENTS.O_EVENT_START, async (payload, ack) => {
    try {
      const eventId = String(payload?.eventId || "");
      if (!mongoose.isValidObjectId(eventId)) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Invalid event");
      }
      const event = await Event.findById(eventId).select("liveState removedAt");
      if (!event || event.removedAt) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      if (!(await canManageEvent(user, event))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to control this event");
      }
      if (event.liveState === "LIVE") {
        if (ack) ack({ ok: true, alreadyLive: true });
        return;
      }
      if (!["CHECK_IN", "WAITING", "PUBLISHED", "REGISTRATION_CLOSED"].includes(event.liveState)) {
        return emitError(socket, ERROR_CODES.NOT_JOINABLE, `Can't start from state ${event.liveState}`);
      }
      event.liveState = "LIVE";
      await event.save();
      io.to(roomKey(eventId)).emit(EVENTS.S_EVENT_STATE, {
        event: { liveState: "LIVE" },
        counts: { connected: connectedCount(roomOf(eventId)), ready: readyCount(roomOf(eventId)) },
        serverTime: Date.now(),
      });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("event:start error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Start failed");
    }
  });

  /* event:pause { eventId } — organizer only */
  socket.on(EVENTS.O_EVENT_PAUSE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const eventId = String(payload?.eventId || "");
      const event = await Event.findById(eventId).select("liveState removedAt");
      if (!event || event.removedAt) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      if (!(await canManageEvent(user, event))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to control this event");
      }
      if (event.liveState !== "LIVE") {
        if (ack) ack({ ok: true, notLive: true });
        return;
      }
      event.liveState = "PAUSED";
      await event.save();
      io.to(roomKey(eventId)).emit(EVENTS.S_EVENT_STATE, {
        event: { liveState: "PAUSED" },
        serverTime: Date.now(),
      });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("event:pause error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Pause failed");
    }
  });

  /* event:resume { eventId } — organizer only */
  socket.on(EVENTS.O_EVENT_RESUME, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const eventId = String(payload?.eventId || "");
      const event = await Event.findById(eventId).select("liveState removedAt");
      if (!event || event.removedAt) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      if (!(await canManageEvent(user, event))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to control this event");
      }
      if (event.liveState !== "PAUSED") {
        if (ack) ack({ ok: true, notPaused: true });
        return;
      }
      event.liveState = "LIVE";
      await event.save();
      io.to(roomKey(eventId)).emit(EVENTS.S_EVENT_STATE, {
        event: { liveState: "LIVE" },
        serverTime: Date.now(),
      });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("event:resume error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Resume failed");
    }
  });

  /* event:end { eventId } — organizer only (spec §57)
   * Completes the event, stops the activity, finalizes scores into a
   * real leaderboard from participant sessions, broadcasts completion. */
  socket.on(EVENTS.O_EVENT_END, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const eventId = String(payload?.eventId || "");
      const event = await Event.findById(eventId).select("liveState removedAt");
      if (!event || event.removedAt) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      if (!(await canManageEvent(user, event))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to control this event");
      }
      if (event.liveState === "COMPLETED") {
        if (ack) ack({ ok: true, alreadyCompleted: true });
        return;
      }

      // Stop the running activity
      const running = await Activity.findOne({ event: eventId, state: { $in: ["LIVE", "PAUSED"] } });
      if (running) await endActivity(eventId, running, user.id);

      event.liveState = "COMPLETED";
      await event.save();

      // Finalize: real leaderboard from participant sessions (sorted by score)
      await ParticipantSession.updateMany({ event: eventId }, { $set: { completedAt: new Date() } });
      // Phase 8 (§73): immutable EventResult snapshot — certificates,
      // analytics and memories read THIS, never live collections. A snapshot
      // failure must never break event completion, hence the catch.
      try {
        await resultService.buildEventResult(eventId, user.id);
      } catch (snapErr) {
        console.error("EventResult snapshot failed:", snapErr.message);
      }
      const sessions = await ParticipantSession.find({ event: eventId })
        .sort({ score: -1, joinedAt: 1 })
        .populate("user", "firstName lastName username profile")
        .lean();
      const leaderboard = sessions.map((sess, i) => ({
        rank: i + 1,
        participantId: sess.user?._id,
        displayName: `${sess.user?.firstName || ""} ${sess.user?.lastName || ""}`.trim(),
        username: sess.user?.username,
        avatar: sess.user?.profile?.avatar || "",
        score: sess.score || 0,
      }));

      io.to(roomKey(eventId)).emit(EVENTS.S_EVENT_COMPLETED, {
        event: { liveState: "COMPLETED" },
        leaderboard,
        counts: { connected: connectedCount(roomOf(eventId)), total: sessions.length },
        serverTime: Date.now(),
      });
      if (ack) ack({ ok: true, participants: sessions.length });
    } catch (error) {
      console.error("event:end error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "End failed");
    }
  });

  /* activity:start { activityId } — organizer only */
  socket.on(EVENTS.O_ACTIVITY_START, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      await startActivity(socket, guard.activity, guard.event, ack);
    } catch (error) {
      console.error("activity:start error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Activity start failed");
    }
  });

  /* activity:pause { activityId } */
  socket.on(EVENTS.O_ACTIVITY_PAUSE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      const { activity } = guard;
      if (activity.state !== "LIVE") {
        if (ack) ack({ ok: true, notLive: true });
        return;
      }
      activity.state = "PAUSED";
      const frozenRemaining = freezeQuestionClock(activity);
      await activity.save();
      io.to(roomKey(activity.event)).emit(EVENTS.S_ACTIVITY_PAUSED, {
        activityId: activity._id,
        pausedAt: Date.now(),
        questionRemainingMs: frozenRemaining,
      });
      if (ack) ack({ ok: true, questionRemainingMs: frozenRemaining });
    } catch (error) {
      console.error("activity:pause error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Activity pause failed");
    }
  });

  /* activity:resume { activityId } */
  socket.on(EVENTS.O_ACTIVITY_RESUME, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      const { activity, event } = guard;
      if (activity.state !== "PAUSED") {
        if (ack) ack({ ok: true, notPaused: true });
        return;
      }
      if (event.liveState !== "LIVE") {
        emitError(socket, ERROR_CODES.NOT_LIVE, "Resume the event first");
        return;
      }
      activity.state = "LIVE";
      const runtime = activity.questionRuntime;
      if (runtime && runtime.questionId && !runtime.closed && !runtime.startedAt) {
        runtime.startedAt = new Date(); // clock resumes with elapsed time preserved
      }
      await activity.save();
      io.to(roomKey(activity.event)).emit(EVENTS.S_ACTIVITY_STARTED, {
        activity: publicActivity(activity),
        serverTime: Date.now(),
      });
      // Re-deliver the open question with a server-fresh clock (§56 resume recalc):
      // startedAt = now, elapsedBeforePause preserved → remaining time continues.
      if (runtime && runtime.questionId && !runtime.closed) {
        const q = await Question.findById(runtime.questionId).select("+correctAnswer").lean();
        const total = await Question.countDocuments({ activity: activity._id });
        if (q) await broadcastQuestionOpened(activity, q, runtime.index, total);
      }
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("activity:resume error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Activity resume failed");
    }
  });

  /* activity:end { activityId } */
  socket.on(EVENTS.O_ACTIVITY_END, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      await endActivity(guard.activity.event, guard.activity, user.id);
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("activity:end error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Activity end failed");
    }
  });

  /* activity:next { activityId } — end current, start next in order (§42) */
  socket.on(EVENTS.O_ACTIVITY_NEXT, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      const { activity, event } = guard;
      if (event.liveState !== "LIVE") {
        emitError(socket, ERROR_CODES.NOT_LIVE, "Start the event first");
        return;
      }
      const next = await Activity.findOne({
        event: activity.event,
        order: { $gt: activity.order },
        state: { $in: ["UPCOMING", "READY"] },
      })
        .sort({ order: 1 })
        .lean();
      if (activity.state === "LIVE" || activity.state === "PAUSED") {
        await endActivity(activity.event, activity, user.id);
      }
      if (!next) {
        if (ack) ack({ ok: true, ended: true, next: null });
        return;
      }
      const nextDoc = await Activity.findById(next._id);
      await startActivity(socket, nextDoc, event, ack);
    } catch (error) {
      console.error("activity:next error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Next activity failed");
    }
  });

  /* activity:prev { activityId } — go back to the latest non-completed
   * previous activity (completed activities never restart — answer data
   * integrity, spec §53/§67) */
  socket.on(EVENTS.O_ACTIVITY_PREV, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      const { activity, event } = guard;
      const prev = await Activity.findOne({
        event: activity.event,
        order: { $lt: activity.order },
        state: { $in: ["UPCOMING", "READY", "PAUSED"] },
      })
        .sort({ order: -1 })
        .lean();
      if (!prev) {
        emitError(socket, ERROR_CODES.NOT_JOINABLE, "No earlier activity to go back to");
        if (ack) ack({ ok: false, message: "No earlier activity" });
        return;
      }
      if (activity.state === "LIVE" || activity.state === "PAUSED") {
        await endActivity(activity.event, activity, user.id);
      }
      if (prev.state === "PAUSED") {
        // Already PAUSED — it becomes the current activity as-is
        if (ack) ack({ ok: true, activity: { id: prev._id, type: prev.type, title: prev.title, state: "PAUSED" } });
        return;
      }
      const prevDoc = await Activity.findById(prev._id);
      await startActivity(socket, prevDoc, event, ack);
    } catch (error) {
      console.error("activity:prev error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Previous activity failed");
    }
  });

  /* ══ QUIZ ENGINE (Phase 4) ═══════════════════════════════════ */

  /* activity:answer { activityId, questionId, answer } — spec §27
   * Full server validation: in event · activity LIVE · question open ·
   * not closed · time not up · session exists · format valid ·
   * idempotent (first submission counts, §53). */
  socket.on(EVENTS.C_ACTIVITY_ANSWER, async (payload, ack) => {
    try {
      const now = Date.now();
      if (socket.data.answerAt && now - socket.data.answerAt < 400) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Slow down");
        return;
      }
      socket.data.answerAt = now;

      // Per-user answer cap (§24 REALTIME) — cross-socket; the 400ms per-socket cooldown above stays
      if (!isRateLimitingDisabled() && !answerGuard.allow(`u:${user?.id || socket.id}`).allowed) {
        metrics.recordRateLimit("REALTIME_ANSWER");
        return emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many answers — slow down");
      }

      if (!socket.data.eventId) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Join the event first");
      }
      const activityId = String(payload?.activityId || "");
      const questionId = String(payload?.questionId || "");
      if (!mongoose.isValidObjectId(activityId) || !mongoose.isValidObjectId(questionId)) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Invalid answer target");
      }

      const activity = await Activity.findById(activityId);
      if (!activity || String(activity.event) !== String(socket.data.eventId)) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Activity not found");
      }
      if (socket.data.isOrganizer) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Organizers don't answer");
      }
      if (activity.state !== "LIVE") {
        return emitError(socket, ERROR_CODES.NOT_LIVE, "This activity isn't accepting answers");
      }
      const runtime = activity.questionRuntime;
      if (!runtime || !runtime.questionId || String(runtime.questionId) !== questionId) {
        return emitError(socket, ERROR_CODES.QUESTION_CLOSED, "No active question");
      }
      if (runtime.closed) {
        return emitError(socket, ERROR_CODES.QUESTION_CLOSED, "This question is closed");
      }
      const left = remainingMs(runtime);
      if (left <= 0) {
        // Late answers are rejected by the SERVER clock (§55) — client timers mean nothing.
        // closeQuestion reveals + runs the leaderboard auto-show gate.
        await closeQuestion(activity);
        return emitError(socket, ERROR_CODES.TIME_UP, "Time's up.");
      }
      if (!socket.rooms.has(activityRoomKey(activity.event, activityId))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You're not in this activity room");
      }

      const session = await ParticipantSession.findOne({ event: activity.event, user: user.id });
      if (!session) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Join the event first");
      }

      const question = await Question.findById(questionId).select("+correctAnswer").lean();
      if (!question) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Question not found");

      /* Answer format validation per type (spec §27) */
      const raw = payload.answer;
      let answer;
      if (question.type === "MULTI_SELECT") {
        if (!Array.isArray(raw) || !raw.length) {
          return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Pick at least one option");
        }
        const unique = [...new Set(raw.map(Number))];
        if (unique.some((i) => !Number.isInteger(i) || i < 0 || i >= (question.options || []).length)) {
          return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Invalid options");
        }
        answer = unique;
      } else if (question.type === "SHORT_ANSWER" || question.type === "LONG_ANSWER") {
        const text = String(raw ?? "").trim();
        if (!text || text.length > 1000) {
          return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Write an answer (max 1000 chars)");
        }
        answer = text;
      } else {
        const idx = Number(raw);
        if (!Number.isInteger(idx) || idx < 0 || idx >= (question.options || []).length) {
          return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Pick an option");
        }
        answer = idx;
      }

      /* Idempotency: first valid submission counts (§53) */
      const event_ = await Event.findById(activity.event).select("liveSettings");
      const settings = (event_ && event_.liveSettings) || {};
      const existing = await LiveAnswer.findOne({ session: session._id, question: questionId }).lean();
      if (existing && !settings.allowAnswerChanges) {
        return emitError(socket, ERROR_CODES.ALREADY_ANSWERED, "You already answered this question");
      }

      /* Server-clock response time (adjusted for pauses, §29) */
      const responseTimeMs =
        (runtime.elapsedBeforePause || 0) + (runtime.startedAt ? Date.now() - new Date(runtime.startedAt).getTime() : 0);

      const result =
        activity.type === "POLL"
          ? { correct: null, points: 0, status: "scored" } // polls: neutral — no grading (§39)
          : scoreAnswer(question, answer, responseTimeMs, settings.scoring);
      let delta;
      if (existing) {
        // allowAnswerChanges: re-score in place, apply the difference
        delta = result.points - (existing.points || 0);
        await LiveAnswer.updateOne(
          { _id: existing._id },
          { $set: { answer, correct: result.correct, points: result.points, status: result.status, responseTime: responseTimeMs, answeredAt: new Date() } }
        );
      } else {
        delta = result.points;
        try {
          await LiveAnswer.create({
            session: session._id,
            event: activity.event,
            activity: activity._id,
            question: questionId,
            answer,
            correct: result.correct,
            points: result.points,
            status: result.status,
            responseTime: responseTimeMs,
          });
        } catch (err) {
          if (String(err.code) === "11000") {
            return emitError(socket, ERROR_CODES.ALREADY_ANSWERED, "You already answered this question");
          }
          throw err;
        }
      }

      if (delta !== 0) {
        // Session score never drops below zero (model min 0) — apply clamped delta
        const newScore = Math.max(0, (session.score || 0) + delta);
        await ParticipantSession.updateOne({ _id: session._id }, { $set: { score: newScore } });
      }

      // Room entry score (for organizer list + participant self)
      const room = roomOf(activity.event);
      const entry = room.participants.get(user.id);
      if (entry) {
        entry.score = Math.max(0, (entry.score || 0) + delta);
      }

      // Personal, server-authoritative result (§28: client only displays)
      const fresh = await ParticipantSession.findById(session._id).select("score").lean();
      if (entry) entry.score = fresh.score;
      socket.emit(EVENTS.S_ANSWER_ACCEPTED, {
        questionId,
        correct: result.correct,
        points: result.points,
        score: fresh.score,
        pending: result.status === "pending_review",
      });

      // Answer count only — never identities (§39-style privacy)
      const count = await LiveAnswer.countDocuments({ question: questionId });
      io.to(roomKey(activity.event)).emit(EVENTS.S_QUESTION_ANSWERS, {
        activityId: activity._id,
        questionId,
        count,
      });

      // §35: while the board is on participant screens, it re-ranks live as
      // answers land (throttled to 1/s — answers can be rapid-fire).
      if (room.leaderboardVisible && Date.now() - (room.lastBoardAt || 0) > 1000) {
        const ev = await Event.findById(activity.event).select("liveSettings");
        await broadcastLeaderboard(activity.event, ev, true);
      }

      // §39: polls show the live distribution as votes land (throttled 1/s)
      if (activity.type === "POLL" && Date.now() - (room.lastPollAt || 0) > 1000) {
        room.lastPollAt = Date.now();
        await pollResults(activity, questionId);
      }
      if (ack) ack({ ok: true, correct: result.correct, points: result.points, score: fresh.score });
    } catch (error) {
      console.error("activity:answer error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Answer failed");
    }
  });

  /* question:next { activityId } — close current (reveal) + open next */
  socket.on(EVENTS.O_QUESTION_NEXT, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      const { activity } = guard;
      if (activity.state !== "LIVE") return emitError(socket, ERROR_CODES.NOT_LIVE, "Activity isn't live");
      const runtime = activity.questionRuntime;
      await closeQuestion(activity);
      const nextIndex = (runtime?.index ?? -1) + 1;
      const total = await Question.countDocuments({ activity: activity._id });
      if (nextIndex >= total) {
        if (ack) ack({ ok: true, noMore: true });
        return;
      }
      const opened = await openQuestion(activity, nextIndex);
      if (ack) ack({ ok: opened, index: nextIndex, total });
    } catch (error) {
      console.error("question:next error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Next question failed");
    }
  });

  /* question:prev { activityId } — reopen the previous question
   * (already-answered participants stay answered — idempotency intact) */
  socket.on(EVENTS.O_QUESTION_PREV, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      const { activity } = guard;
      if (activity.state !== "LIVE") return emitError(socket, ERROR_CODES.NOT_LIVE, "Activity isn't live");
      const runtime = activity.questionRuntime;
      const prevIndex = (runtime?.index ?? 1) - 1;
      if (prevIndex < 0) {
        emitError(socket, ERROR_CODES.NOT_JOINABLE, "No earlier question");
        if (ack) ack({ ok: false, message: "No earlier question" });
        return;
      }
      await closeQuestion(activity, { count: false }); // re-opening ≠ checkpoint
      const opened = await openQuestion(activity, prevIndex);
      if (ack) ack({ ok: opened, index: prevIndex });
    } catch (error) {
      console.error("question:prev error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Previous question failed");
    }
  });

  /* question:close { activityId } — close early + reveal */
  socket.on(EVENTS.O_QUESTION_CLOSE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      const closed = await closeQuestion(guard.activity);
      if (ack) ack({ ok: closed });
    } catch (error) {
      console.error("question:close error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Close failed");
    }
  });

  /* ══ LEADERBOARD COMMANDS (Phase 5 — §31–38, §44) ══════════════════ */

  /* leaderboard:show { eventId } — put the board on participant screens.
   * The visibility CONFIG wins: "never" and "final" refuse the command. */
  socket.on(EVENTS.O_LEADERBOARD_SHOW, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const eventId = String(payload?.eventId || "");
      const event = await Event.findById(eventId).select("liveState removedAt liveSettings");
      if (!event || event.removedAt) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      }
      if (!(await canManageEvent(socket.data.user, event))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to control this event");
      }
      const mode = event.liveSettings?.leaderboardVisibility || "after_activity";
      if (mode === "never" || mode === "final") {
        if (ack) ack({ ok: false, message: `Leaderboard is set to "${mode}" for this event` });
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, `Leaderboard visibility is "${mode}" — change it in event settings`);
      }
      if (event.liveState !== "LIVE" && event.liveState !== "PAUSED") {
        return emitError(socket, ERROR_CODES.NOT_LIVE, "Start the event first");
      }
      const board = await broadcastLeaderboard(eventId, event, true);
      if (ack) ack({ ok: true, entries: board.length });
    } catch (error) {
      console.error("leaderboard:show error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Show failed");
    }
  });

  /* leaderboard:hide { eventId } — take the board off participant screens */
  socket.on(EVENTS.O_LEADERBOARD_HIDE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const eventId = String(payload?.eventId || "");
      const event = await Event.findById(eventId).select("liveState removedAt liveSettings");
      if (!event || event.removedAt) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      }
      if (!(await canManageEvent(socket.data.user, event))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to control this event");
      }
      await broadcastLeaderboard(eventId, event, false);
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("leaderboard:hide error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Hide failed");
    }
  });

  /* ══ Q&A (Phase 6 — spec §40) ════════════════════════════════════ */

  /* qa:submit { activityId, text } — audience question, one activity */
  socket.on(EVENTS.C_QA_SUBMIT, async (payload, ack) => {
    try {
      const now = Date.now();
      if (socket.data.qaAt && now - socket.data.qaAt < 1500) {
        return emitError(socket, ERROR_CODES.RATE_LIMITED, "Slow down");
      }
      socket.data.qaAt = now;
      if (socket.data.isDisplay) return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Display is view-only");
      if (!socket.data.eventId) return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Join the event first");
      const activityId = String(payload?.activityId || "");
      const text = String(payload?.text || "").trim();
      if (!mongoose.isValidObjectId(activityId) || !text || text.length > 500) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Question must be 1–500 characters");
      }
      const activity = await Activity.findById(activityId);
      if (!activity || String(activity.event) !== String(socket.data.eventId)) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Activity not found");
      }
      if (activity.type !== "QA") return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Not a Q&A activity");
      if (activity.state !== "LIVE") return emitError(socket, ERROR_CODES.NOT_LIVE, "Q&A isn't open right now");
      if (activity.qaClosed) return emitError(socket, ERROR_CODES.QA_CLOSED, "The organizer closed this Q&A");
      if (socket.data.isOrganizer) return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Organizers don't submit audience questions");
      const session = await ParticipantSession.findOne({ event: activity.event, user: user.id });
      if (!session) return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Join the event first");
      const doc = await QAQuestion.create({ event: activity.event, activity: activity._id, author: user.id, text });
      await broadcastQAList(activity, { force: true });
      if (ack) ack({ ok: true, id: doc._id });
    } catch (error) {
      console.error("qa:submit error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Submit failed");
    }
  });

  /* qa:upvote { questionId } — toggle, one vote per user (idempotent) */
  socket.on(EVENTS.C_QA_UPVOTE, async (payload, ack) => {
    try {
      const now = Date.now();
      if (socket.data.qaVoteAt && now - socket.data.qaVoteAt < 500) {
        return emitError(socket, ERROR_CODES.RATE_LIMITED, "Slow down");
      }
      socket.data.qaVoteAt = now;
      if (socket.data.isDisplay) return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Display is view-only");
      if (!socket.data.eventId) return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Join the event first");
      const questionId = String(payload?.questionId || "");
      if (!mongoose.isValidObjectId(questionId)) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Invalid question");
      }
      const doc = await QAQuestion.findById(questionId);
      if (!doc || String(doc.event) !== String(socket.data.eventId)) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Question not found");
      }
      const activity = await Activity.findById(doc.activity);
      if (!activity || activity.state !== "LIVE") {
        return emitError(socket, ERROR_CODES.NOT_LIVE, "This Q&A round is over");
      }
      if (doc.status === "hidden" || doc.status === "closed") {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "This question is no longer taking votes");
      }
      const voted = (doc.votes || []).some((v) => String(v) === String(user.id));
      await QAQuestion.updateOne(
        { _id: doc._id },
        voted ? { $pull: { votes: user.id } } : { $addToSet: { votes: user.id } }
      );
      await broadcastQAList(activity); // throttled — upvote storms
      if (ack) ack({ ok: true, voted: !voted });
    } catch (error) {
      console.error("qa:upvote error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Upvote failed");
    }
  });

  /* qa:feature { questionId } — organizer toggle: pin to top */
  socket.on(EVENTS.O_QA_FEATURE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const doc = await QAQuestion.findById(String(payload?.questionId || ""));
      if (!doc) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Question not found");
      const ev = await Event.findById(doc.event).select("createdBy removedAt");
      if (!ev || ev.removedAt || !(await canManageEvent(socket.data.user, ev))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to moderate this event");
      }
      if (doc.status === "open" || doc.status === "featured") {
        doc.status = doc.status === "featured" ? "open" : "featured";
        await doc.save();
        const activity = await Activity.findById(doc.activity);
        if (activity) await broadcastQAList(activity, { force: true });
      }
      if (ack) ack({ ok: true, status: doc.status });
    } catch (error) {
      console.error("qa:feature error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Feature failed");
    }
  });

  /* qa:answer { questionId, answerText } — organizer marks answered */
  socket.on(EVENTS.O_QA_ANSWER, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const answerText = String(payload?.answerText || "").trim();
      if (!answerText || answerText.length > 1000) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Answer must be 1–1000 characters");
      }
      const doc = await QAQuestion.findById(String(payload?.questionId || ""));
      if (!doc) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Question not found");
      const ev = await Event.findById(doc.event).select("createdBy removedAt");
      if (!ev || ev.removedAt || !(await canManageEvent(socket.data.user, ev))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to moderate this event");
      }
      doc.status = "answered";
      doc.answerText = answerText;
      doc.answeredAt = new Date();
      await doc.save();
      const activity = await Activity.findById(doc.activity);
      if (activity) await broadcastQAList(activity, { force: true });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("qa:answer error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Answer failed");
    }
  });

  /* qa:hide { questionId } — organizer removes from the public list */
  socket.on(EVENTS.O_QA_HIDE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const doc = await QAQuestion.findById(String(payload?.questionId || ""));
      if (!doc) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Question not found");
      const ev = await Event.findById(doc.event).select("createdBy removedAt");
      if (!ev || ev.removedAt || !(await canManageEvent(socket.data.user, ev))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to moderate this event");
      }
      doc.status = "hidden";
      await doc.save();
      const activity = await Activity.findById(doc.activity);
      if (activity) await broadcastQAList(activity, { force: true });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("qa:hide error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Hide failed");
    }
  });

  /* qa:close { activityId } — organizer toggles submissions closed */
  socket.on(EVENTS.O_QA_CLOSE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, true);
      if (!guard) return;
      const { activity } = guard;
      if (activity.type !== "QA") return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Not a Q&A activity");
      activity.qaClosed = !activity.qaClosed;
      await activity.save();
      await broadcastQAList(activity, { force: true });
      if (ack) ack({ ok: true, closed: activity.qaClosed });
    } catch (error) {
      console.error("qa:close error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Close failed");
    }
  });

  /* ══ LIVE CHAT (Phase 6 — spec §41) ══════════════════════════════ */

  /* chat:send { eventId, text } — rate-limited, persisted, muted-checked */
  socket.on(EVENTS.C_CHAT_SEND, async (payload, ack) => {
    try {
      if (socket.data.isDisplay) return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Display is view-only");
      const now = Date.now();
      if (socket.data.chatAt && now - socket.data.chatAt < 1500) {
        return emitError(socket, ERROR_CODES.RATE_LIMITED, "Slow down");
      }
      socket.data.chatAt = now;
      const eventId = String(payload?.eventId || "");
      if (!socket.data.eventId || eventId !== String(socket.data.eventId)) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "Join the event first");
      }
      const text = String(payload?.text || "").trim();
      if (!text || text.length > 500) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Message must be 1–500 characters");
      }
      const event = await Event.findById(eventId).select("liveState liveSettings removedAt");
      if (!event || event.removedAt) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      if (event.liveSettings?.chatEnabled === false) {
        return emitError(socket, ERROR_CODES.CHAT_DISABLED, "Chat is turned off for this event");
      }
      if (!socket.data.isOrganizer) {
        const room = roomOf(eventId);
        const entry = room.participants.get(user.id);
        if (entry?.muted) return emitError(socket, ERROR_CODES.MUTED, "You're muted — the organizers muted you");
        const session = await ParticipantSession.findOne({ event: eventId, user: user.id }).select("muted");
        if (session?.muted) return emitError(socket, ERROR_CODES.MUTED, "You're muted — the organizers muted you");
      }
      const doc = await LiveMessage.create({ event: eventId, sender: user.id, text });
      const populated = await LiveMessage.findById(doc._id).populate("sender", "firstName lastName username profile").lean();
      io.to(roomKey(eventId)).emit(EVENTS.S_CHAT_MESSAGE, { message: publicChatMessage(populated) });
      if (ack) ack({ ok: true, id: doc._id });
    } catch (error) {
      console.error("chat:send error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Message failed");
    }
  });

  /* chat:delete { messageId } — moderator soft delete (auditable) */
  socket.on(EVENTS.O_CHAT_DELETE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const msg = await LiveMessage.findById(String(payload?.messageId || ""));
      if (!msg || msg.deletedAt) {
        if (ack) ack({ ok: true, alreadyDeleted: true });
        return;
      }
      const ev = await Event.findById(msg.event).select("createdBy removedAt");
      if (!ev || ev.removedAt || !(await canManageEvent(socket.data.user, ev))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to moderate this event");
      }
      msg.deletedAt = new Date();
      msg.deletedBy = user.id;
      await msg.save();
      io.to(roomKey(msg.event)).emit(EVENTS.S_CHAT_DELETED, { messageId: msg._id });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("chat:delete error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Delete failed");
    }
  });

  /* chat:pin { messageId } — moderator toggle, single pinned message */
  socket.on(EVENTS.O_CHAT_PIN, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const msg = await LiveMessage.findById(String(payload?.messageId || ""));
      if (!msg || msg.deletedAt) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Message not found");
      const ev = await Event.findById(msg.event).select("createdBy removedAt");
      if (!ev || ev.removedAt || !(await canManageEvent(socket.data.user, ev))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to moderate this event");
      }
      let prevPinnedId = null;
      if (msg.pinned) {
        msg.pinned = false;
      } else {
        const prev = await LiveMessage.findOne({ event: msg.event, pinned: true, _id: { $ne: msg._id } }).select("_id");
        prevPinnedId = prev?._id || null;
        if (prevPinnedId) await LiveMessage.updateOne({ _id: prevPinnedId }, { $set: { pinned: false } });
        msg.pinned = true;
      }
      await msg.save();
      io.to(roomKey(msg.event)).emit(EVENTS.S_CHAT_PINNED, {
        messageId: msg._id,
        pinned: msg.pinned,
        prevPinnedId,
      });
      if (ack) ack({ ok: true, pinned: msg.pinned });
    } catch (error) {
      console.error("chat:pin error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Pin failed");
    }
  });

  /* chat:mute { eventId, userId, muted } — moderator, persisted on session */
  socket.on(EVENTS.O_CHAT_MUTE, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const eventId = String(payload?.eventId || "");
      const targetId = String(payload?.userId || "");
      const muted = Boolean(payload?.muted);
      const event = await Event.findById(eventId).select("createdBy removedAt");
      if (!event || event.removedAt) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      if (!(await canManageEvent(socket.data.user, event))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to moderate this event");
      }
      const session = await ParticipantSession.findOneAndUpdate(
        { event: eventId, user: targetId },
        { $set: { muted } },
        { new: true }
      );
      if (!session) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Participant not found");
      const entry = roomOf(eventId).participants.get(targetId);
      if (entry) entry.muted = muted;
      io.to(roomKey(eventId)).emit(EVENTS.S_CHAT_MUTED, { userId: targetId, muted });
      if (ack) ack({ ok: true, muted });
    } catch (error) {
      console.error("chat:mute error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Mute failed");
    }
  });

  /* ══ ANNOUNCEMENTS (Phase 7 — spec §47) ═══════════════════════════ */

  /* announcement:send { eventId, text } — organizer broadcast banner.
   *  Ephemeral by design: the banner lives in room state (reconnects see
   *  the latest one while it's still fresh) and is never persisted. */
  socket.on(EVENTS.O_ANNOUNCEMENT_SEND, async (payload, ack) => {
    try {
      const guard = await commandGuard(socket, payload, false);
      if (!guard) return;
      const eventId = String(payload?.eventId || "");
      const text = String(payload?.text || "").trim();
      if (!text || text.length > 300) {
        return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Announcement must be 1–300 characters");
      }
      const event = await Event.findById(eventId).select("liveState removedAt");
      if (!event || event.removedAt) return emitError(socket, ERROR_CODES.VALIDATION_FAILED, "Event not found");
      if (!(await canManageEvent(socket.data.user, event))) {
        return emitError(socket, ERROR_CODES.NOT_AUTHORIZED, "You are not allowed to run this event");
      }
      if (!["WAITING", "LIVE", "PAUSED", "CHECK_IN"].includes(event.liveState)) {
        return emitError(socket, ERROR_CODES.NOT_LIVE, "Announcements need a live or waiting event");
      }
      const announcement = { text, at: Date.now() };
      roomOf(eventId).lastAnnouncement = announcement;
      io.to(roomKey(eventId)).emit(EVENTS.S_ANNOUNCEMENT_NEW, announcement);
      if (ack) ack({ ok: true, at: announcement.at });
    } catch (error) {
      console.error("announcement:send error:", error.message);
      emitError(socket, ERROR_CODES.INTERNAL, "Announcement failed");
    }
  });
}

/* Disconnect / leave cleanup (spec §51, §52) */
async function handleLeave(socket, eventId, reason) {
  const userId = socket.data.user?.id;
  if (!userId) return;
  const room = roomOf(eventId);

  const org = room.organizers.get(userId);
  if (org) {
    org.socketIds.delete(socket.id);
    if (!org.socketIds.size) room.organizers.delete(userId);
  }

  const entry = room.participants.get(userId);
  if (entry) {
    entry.socketIds.delete(socket.id);
    if (!entry.socketIds.size) {
      // Last socket gone → logically disconnected (session stays for reconnect)
      entry.state = "disconnected";
      entry.lastSeenAt = new Date();
      io.to(roomKey(eventId)).emit(EVENTS.S_PARTICIPANT_LEFT, {
        participantId: userId,
        connected: connectedCount(room),
      });
    }
  }
  if (reason === "left") socket.leave(roomKey(eventId));
}

/* ── Public API ── */
function init(socketIo) {
  io = socketIo;
  const { socketAuth } = require("../middleware/socket-auth.middleware");

  io.use(socketAuth);

  io.on("connection", (socket) => {
    // Reconnect-storm guard (§24 REALTIME): per-user + per-IP connect rate.
    if (!isRateLimitingDisabled()) {
      const uid = socket.data?.user?.id || socket.data?.user?._id || socket.id;
      const ip = socket.handshake?.address || "unknown";
      if (!connectGuardUser.allow(`u:${uid}`).allowed || !connectGuardIp.allow(`ip:${ip}`).allowed) {
        metrics.recordRateLimit("REALTIME_CONNECT");
        socket.disconnect(true);
        return;
      }
    }

    // Clock synchronization baseline (spec §17) — full offset use in Phase 4
    socket.emit(EVENTS.S_SERVER_TIME, { serverTime: Date.now() });

    registerHandlers(socket);

    socket.on("disconnect", () => {
      if (socket.data?.eventId) {
        handleLeave(socket, socket.data.eventId, "disconnected").catch(() => {});
      }
    });
  });

  console.log("✅ EventHub realtime engine attached (Socket.IO)");
}

/** HTTP-facing: role-scoped live state (used by GET /api/events/:id/live/state). */
async function liveStateFor(eventId, user) {
  const event = await Event.findById(eventId).select("removedAt");
  if (!event || event.removedAt) return { notFound: true };
  const isOrganizer = await canManageEvent(user, { _id: eventId });
  if (isOrganizer) return { organizer: await stateForOrganizer(eventId) };
  return { participant: await stateForParticipant(eventId, user.id) };
}

module.exports = { init, liveStateFor, roomOf, connectedCount, readyCount };
