/**
 * EventHub Realtime Protocol (Part 4) — THE central event definition.
 * ─────────────────────────────────────────────────────────────────────
 * No module may invent socket event names: every client→server,
 * organizer→server and server→client event lives HERE (spec §79).
 *
 * Handlers are wired phase by phase; names are final from day one so the
 * protocol never drifts.
 */

const EVENTS = {
  /* ── participant → server ── */
  C_EVENT_JOIN: "event:join", // { eventId } — full server-side validation
  C_EVENT_LEAVE: "event:leave", // { eventId }
  C_EVENT_READY: "event:ready", // { eventId } — "I'm ready"
  C_ACTIVITY_ANSWER: "activity:answer", // Phase 4 { activityId, questionId, answer }
  C_ACTIVITY_VOTE: "activity:vote", // RESERVED — never wired: polls vote through activity:answer (generic engine)
  C_QA_SUBMIT: "qa:submit", // Phase 6 { activityId, text }
  C_QA_UPVOTE: "qa:upvote", // Phase 6 { questionId } — toggle, one vote per user
  C_CHAT_SEND: "chat:send", // Phase 6 { eventId, text }

  /* ── organizer → server (authorized: owner/admin/moderator only) ── */
  O_EVENT_START: "event:start", // { eventId }
  O_EVENT_PAUSE: "event:pause", // Phase 3
  O_EVENT_RESUME: "event:resume", // Phase 3
  O_EVENT_END: "event:end", // Phase 3
  O_ACTIVITY_START: "activity:start", // Phase 3 { activityId }
  O_ACTIVITY_PAUSE: "activity:pause", // Phase 3
  O_ACTIVITY_RESUME: "activity:resume", // Phase 3
  O_ACTIVITY_END: "activity:end", // Phase 3
  O_ACTIVITY_NEXT: "activity:next", // Phase 3
  O_ACTIVITY_PREV: "activity:prev", // Phase 3
  O_QUESTION_NEXT: "question:next", // Phase 4 { activityId }
  O_QUESTION_PREV: "question:prev", // Phase 4 { activityId }
  O_QUESTION_CLOSE: "question:close", // Phase 4 { activityId } — close + reveal
  O_LEADERBOARD_SHOW: "leaderboard:show", // Phase 5 { eventId } — participant screen shows the board (config permitting)
  O_LEADERBOARD_HIDE: "leaderboard:hide", // Phase 5 { eventId } — hide the participant board
  O_ANNOUNCEMENT_SEND: "announcement:send", // Phase 7 { eventId, text }
  O_CHAT_DELETE: "chat:delete", // Phase 6 { messageId } — soft delete + broadcast
  O_CHAT_MUTE: "chat:mute", // Phase 6 { eventId, userId, muted } — moderation, persisted on the session
  O_CHAT_PIN: "chat:pin", // Phase 6 { messageId } — toggle pin
  O_QA_FEATURE: "qa:feature", // Phase 6 { questionId } — toggle featured (pinned to top)
  O_QA_ANSWER: "qa:answer", // Phase 6 { questionId, answerText }
  O_QA_HIDE: "qa:hide", // Phase 6 { questionId } — hide from the public list
  O_QA_CLOSE: "qa:close", // Phase 6 { activityId } — stop accepting submissions

  /* ── server → client ── */
  S_EVENT_STATE: "event:state", // role-scoped full state (join/reconnect/every major change)
  S_PARTICIPANT_JOINED: "participant:joined", // { participant, connected }
  S_PARTICIPANT_LEFT: "participant:left", // { participantId, connected }
  S_READY_COUNT: "ready:count", // { ready, total }
  S_SERVER_TIME: "server:time", // { serverTime } — clock sync (spec §17)
  S_QUESTION_OPENED: "question:opened", // Phase 4 { activityId, question(sanitized), index, total, startedAt, durationSec, serverTime }
  S_QUESTION_CLOSED: "question:closed", // Phase 4 { activityId, questionId, correctAnswer, explanation, serverTime } — reveal is safe: answers closed
  S_QUESTION_ANSWERS: "question:answers", // Phase 4 { activityId, questionId, count } — count only, no identities
  S_ANSWER_ACCEPTED: "answer:accepted", // Phase 4 (per participant) { questionId, correct, points, score, pending? }
  S_LEADERBOARD_UPDATE: "leaderboard:update", // Phase 5 { leaderboard, visible, serverTime } — board data only when visible; organizer sockets get stats
  S_POLL_RESULTS: "poll:results", // Phase 6 { activityId, questionId, counts, total } — distribution only, NEVER who voted (§39)
  S_QA_LIST: "qa:list", // Phase 6 { activityId, questions } — vote counts only, voter identities never sent (§40)
  S_ACTIVITY_STARTING: "activity:starting", // Phase 6 { activity }
  S_ACTIVITY_STARTED: "activity:started", // Phase 4 { activity, question, timer }
  S_ACTIVITY_PAUSED: "activity:paused", // Phase 3
  S_ACTIVITY_ENDED: "activity:ended", // Phase 3
  S_ANNOUNCEMENT_NEW: "announcement:new", // Phase 7 { text, at }
  S_CHAT_MESSAGE: "chat:message", // Phase 6 { message } — one message, public identity only
  S_CHAT_DELETED: "chat:deleted", // Phase 6 { messageId } — moderator removal
  S_CHAT_PINNED: "chat:pinned", // Phase 6 { messageId, pinned }
  S_CHAT_MUTED: "chat:muted", // Phase 6 { userId, muted } — public moderation signal
  S_EVENT_COMPLETED: "event:completed", // Phase 3 { result }
  S_ERROR: "error", // { code, message } — structured, never stack traces (§81)
};

/** Structured socket error (spec §81). */
function socketError(code, message) {
  return { code, message };
}

const ERROR_CODES = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  AUTH_FAILED: "AUTH_FAILED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_JOINABLE: "NOT_JOINABLE",
  EVENT_ENDED: "EVENT_ENDED",
  REGISTRATION_REQUIRED: "REGISTRATION_REQUIRED",
  CHECK_IN_REQUIRED: "CHECK_IN_REQUIRED",
  RATE_LIMITED: "RATE_LIMITED",
  /* Phase 6 (§43) — concurrency caps, distinct from RATE_LIMITED so a client
   * can tell "you are going too fast" from "you have too many tabs open" and
   * show the right message instead of a generic slow-down. */
  TOO_MANY_CONNECTIONS: "TOO_MANY_CONNECTIONS",
  ROOM_FULL: "ROOM_FULL",
  ALREADY_ANSWERED: "ALREADY_ANSWERED",
  NOT_LIVE: "NOT_LIVE",
  QUESTION_CLOSED: "QUESTION_CLOSED",
  TIME_UP: "TIME_UP",
  MUTED: "MUTED",
  CHAT_DISABLED: "CHAT_DISABLED",
  QA_CLOSED: "QA_CLOSED",
  INTERNAL: "INTERNAL",
};

module.exports = { EVENTS, ERROR_CODES, socketError };
