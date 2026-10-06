/**
 * EventHub realtime protocol — FRONTEND MIRROR (Part 4).
 * Single source of truth: backend/config/socket-protocol.js.
 * Keep both files in sync (names are final from Phase 2 onward).
 */
export const LIVE_EVENTS = {
  // participant → server
  C_EVENT_JOIN: "event:join",
  C_EVENT_LEAVE: "event:leave",
  C_EVENT_READY: "event:ready",
  // organizer → server
  O_EVENT_START: "event:start",
  O_EVENT_PAUSE: "event:pause",
  O_EVENT_RESUME: "event:resume",
  O_EVENT_END: "event:end",
  O_ACTIVITY_START: "activity:start",
  O_ACTIVITY_PAUSE: "activity:pause",
  O_ACTIVITY_RESUME: "activity:resume",
  O_ACTIVITY_END: "activity:end",
  O_ACTIVITY_NEXT: "activity:next",
  O_ACTIVITY_PREV: "activity:prev",
  O_QUESTION_NEXT: "question:next",
  O_QUESTION_PREV: "question:prev",
  O_QUESTION_CLOSE: "question:close",
  O_LEADERBOARD_SHOW: "leaderboard:show",
  O_LEADERBOARD_HIDE: "leaderboard:hide",
  O_QA_FEATURE: "qa:feature",
  O_QA_ANSWER: "qa:answer",
  O_QA_HIDE: "qa:hide",
  O_QA_CLOSE: "qa:close",
  O_CHAT_DELETE: "chat:delete",
  O_CHAT_MUTE: "chat:mute",
  O_CHAT_PIN: "chat:pin",
  O_ANNOUNCEMENT_SEND: "announcement:send",
  // participant → server (quiz engine)
  C_ACTIVITY_ANSWER: "activity:answer",
  // participant → server (Phase 6)
  C_QA_SUBMIT: "qa:submit",
  C_QA_UPVOTE: "qa:upvote",
  C_CHAT_SEND: "chat:send",
  // server → client
  S_EVENT_STATE: "event:state",
  S_PARTICIPANT_JOINED: "participant:joined",
  S_PARTICIPANT_LEFT: "participant:left",
  S_READY_COUNT: "ready:count",
  S_ACTIVITY_STARTING: "activity:starting",
  S_ACTIVITY_STARTED: "activity:started",
  S_ACTIVITY_PAUSED: "activity:paused",
  S_ACTIVITY_ENDED: "activity:ended",
  S_EVENT_COMPLETED: "event:completed",
  S_QUESTION_OPENED: "question:opened",
  S_QUESTION_CLOSED: "question:closed",
  S_QUESTION_ANSWERS: "question:answers",
  S_ANSWER_ACCEPTED: "answer:accepted",
  S_LEADERBOARD_UPDATE: "leaderboard:update",
  S_POLL_RESULTS: "poll:results",
  S_QA_LIST: "qa:list",
  S_CHAT_MESSAGE: "chat:message",
  S_CHAT_DELETED: "chat:deleted",
  S_CHAT_PINNED: "chat:pinned",
  S_CHAT_MUTED: "chat:muted",
  S_ANNOUNCEMENT_NEW: "announcement:new",
  S_SERVER_TIME: "server:time",
  S_ERROR: "error",
} as const;

/* ── Quiz engine payloads (Phase 4 — spec §16–23, §27–30) ── */

/** Question as delivered to PARTICIPANTS — never contains correctAnswer. */
export interface LiveQuestion {
  id: string;
  type: "MULTIPLE_CHOICE" | "SINGLE_CHOICE" | "MULTI_SELECT" | "TRUE_FALSE" | "SHORT_ANSWER" | "LONG_ANSWER";
  text: string;
  media?: { url?: string; alt?: string } | null;
  options: string[];
  points?: number;
  index?: number;
  total?: number;
  answered?: boolean; // participant snapshot: already answered (reconnect)
}

/** Reveal payload — only arrives after answers are closed (§21). */
export interface QuestionReveal {
  questionId: string;
  correctAnswer: number | number[] | string | null;
  explanation?: string;
}

/** Server-clock question state (client NEVER derives truth, §17). */
export interface QuestionState extends LiveQuestion {
  startedAt: number | null; // ms epoch; null while paused
  durationSec: number;
  elapsedBeforePause: number;
  closed: boolean;
  remainingMs: number;
  results?: { counts: number[]; total: number }; // POLL distribution (§39)
  // ORGANIZER-ONLY fields (never sent to participant sockets, §21)
  correctAnswer?: number | number[] | string | null;
  explanation?: string;
  answeredCount?: number;
}

/** Organizer-side question view: answer key + answered count allowed. */
export interface OrganizerQuestionState extends QuestionState {
  correctAnswer: number | number[] | string | null;
  explanation?: string;
  answeredCount: number;
}

/** Server-authoritative answer result (§28: client only displays). */
export interface AnswerResult {
  questionId: string;
  correct: boolean | null; // null = pending review (subjective) OR poll (neutral)
  points: number;
  score: number;
  pending?: boolean;
}

/* ── Phase 6: poll / Q&A / chat payloads (spec §39–41) ── */

/** Poll distribution — counts only, NEVER who voted (§39). */
export interface PollResults {
  activityId: string;
  questionId: string;
  counts: number[];
  total: number;
}

/** Audience question — vote count + own-vote flag, never the voter list. */
export interface QAQuestionItem {
  id: string;
  text: string;
  author: { displayName: string; username?: string; avatar?: string };
  votes: number;
  voted: boolean;
  status: "open" | "featured" | "answered" | "hidden" | "closed";
  answerText: string;
  answeredAt?: string | null;
  createdAt?: string;
}

export interface QAState {
  closed: boolean;
  questions: QAQuestionItem[];
}

/** Chat message — public identity only (§41). */
export interface ChatMessage {
  id: string;
  senderId: string;
  displayName: string;
  username?: string;
  avatar?: string;
  text: string;
  pinned: boolean;
  createdAt?: string;
}

export interface ChatState {
  enabled: boolean;
  muted: boolean;
  messages: ChatMessage[];
}

/** Organizer announcement — ephemeral banner (§47), fresh for 10 min. */
export interface Announcement {
  text: string;
  at: number;
}

export interface SocketErrorPayload {
  code: string;
  message: string;
}

export interface LiveParticipant {
  userId: string;
  displayName: string;
  username?: string;
  avatar?: string;
}

export interface LiveActivity {
  id: string;
  type: string;
  title: string;
  state: string;
}

export interface LeaderboardEntry {
  rank: number;
  participantId?: string; // absent on team entries
  displayName?: string; // absent on team entries (team name instead)
  username?: string;
  avatar?: string;
  score: number;
  team?: string; // team-mode entries (Phase 5 foundation)
  memberCount?: number;
  previousRank?: number | null; // null = new on the board
  rankChange?: number | null; // +moved up / −moved down / 0 steady
  // organizer-only enrichment (never broadcast to participants)
  correctCount?: number;
  answeredCount?: number;
  avgResponseMs?: number;
}

export interface LeaderboardUpdate {
  visible: boolean;
  leaderboard?: LeaderboardEntry[]; // present only while visible
  serverTime?: number;
}

export interface LiveCounts {
  connected?: number;
  ready?: number;
  registered?: number;
  checkedIn?: number;
  total?: number;
}
