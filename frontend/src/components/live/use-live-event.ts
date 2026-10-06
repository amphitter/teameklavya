"use client";

/**
 * useLiveEvent (Part 4, Phase 2) — the live event hook.
 *
 * Owns the socket lifecycle for a live event page: join with server
 * validation, presence updates, ready state, clock offset, connection
 * status and the RECONNECT protocol (§51): on every (re)connect the room
 * is re-joined and full state re-synced — nothing ever restarts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket";
import {
  LIVE_EVENTS,
  type LiveActivity,
  type LiveCounts,
  type LeaderboardEntry,
  type LiveParticipant,
  type QuestionState,
  type AnswerResult,
  type QuestionReveal,
  type QAState,
  type ChatState,
  type ChatMessage,
  type Announcement,
  type SocketErrorPayload,
} from "@/lib/live-protocol";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface JoinAck {
  ok: boolean;
  role?: "participant" | "organizer";
  state?: any;
  code?: string;
  message?: string;
  notStarted?: boolean;
  noMore?: boolean;
}

export interface LiveState {
  event?: { title?: string; slug?: string; liveState?: string; joinCode?: string };
  activity?: LiveActivity | null;
  question?: QuestionState | null; // organizer snapshot carries correctAnswer + answeredCount
  leaderboard?: LeaderboardEntry[] | null;
  leaderboardVisible?: boolean;
  leaderboardMode?: string;
  teamMode?: boolean;
  myRank?: number | null;
  qa?: QAState | null; // Phase 6 — present while a Q&A activity runs
  chat?: ChatState; // Phase 6 — event-scoped chat
  announcement?: Announcement | null; // Phase 7 — ephemeral organizer banner (§47)
  transition?: { activity: LiveActivity } | null; // Phase 6 §43 — presentation only
  completed?: boolean;
  finalLeaderboard?: LeaderboardEntry[];
  me?: { joined?: boolean; ready?: boolean; connected?: boolean; score?: number };
  participants?: (LiveParticipant & { state?: string; ready?: boolean; score?: number })[];
  counts?: LiveCounts;
}

export function useLiveEvent(meUserId?: string) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [offset, setOffset] = useState(0); // serverTime − clientTime (ms)
  const [state, setState] = useState<LiveState | null>(null);
  const [joinAck, setJoinAck] = useState<JoinAck | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [reveal, setReveal] = useState<QuestionReveal | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const joinedEventRef = useRef<string | null>(null);
  const roleRef = useRef<"participant" | "organizer" | null>(null);
  const meUserIdRef = useRef<string | null>(null);
  const displayRef = useRef(false); // projector sockets rejoin as displays (§46)

  useEffect(() => {
    meUserIdRef.current = meUserId || null;
  }, [meUserId]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    /* ── connection lifecycle ── */
    const onConnect = () => {
      setStatus("connected");
      // Reconnect protocol (§51): rejoin the room, full state re-sync.
      // Display sockets MUST rejoin as displays — never as participants.
      if (joinedEventRef.current) {
        socket.emit(LIVE_EVENTS.C_EVENT_JOIN, { eventId: joinedEventRef.current, display: displayRef.current });
      }
    };
    const onDisconnect = () => setStatus("reconnecting");
    const onReconnectAttempt = () => setStatus("reconnecting");

    /* ── server events ── */
    const onState = (payload: LiveState) => {
      setState((prev) => ({
        ...prev,
        ...payload,
        event: { ...(prev?.event || {}), ...(payload.event || {}) },
        counts: { ...(prev?.counts || {}), ...(payload.counts || {}) },
        activity: "activity" in payload ? payload.activity ?? null : prev?.activity ?? null,
        question: "question" in payload ? payload.question ?? null : prev?.question ?? null,
        me: "me" in payload ? payload.me : prev?.me,
      }));
    };
    const onActivityStarting = (payload: { activity: LiveActivity }) => {
      // §43 transition cue: pure presentation — the server state is already
      // authoritative; the overlay just announces what's coming, then clears.
      setState((prev) => (prev ? { ...prev, activity: payload.activity, transition: { activity: payload.activity } } : prev));
      setTimeout(() => {
        setState((prev) =>
          prev?.transition && String(prev.transition.activity.id) === String(payload.activity.id)
            ? { ...prev, transition: null }
            : prev
        );
      }, 2800);
    };
    const onActivityStarted = (payload: { activity: LiveActivity }) => {
      setState((prev) => (prev ? { ...prev, activity: payload.activity } : prev));
    };
    const onActivityPaused = (payload: { activityId: string; questionRemainingMs?: number | null }) => {
      setState((prev) => {
        if (!prev?.activity || String(prev.activity.id) !== String(payload.activityId)) return prev;
        const next: LiveState = { ...prev, activity: { ...prev.activity, state: "PAUSED" } };
        // Freeze the question clock at the server-derived remaining time (§56)
        if (prev.question && payload.questionRemainingMs != null) {
          next.question = { ...prev.question, startedAt: null, remainingMs: payload.questionRemainingMs };
        }
        return next;
      });
    };
    const onActivityEnded = (payload: { activityId: string }) => {
      setReveal(null);
      setAnswerResult(null);
      setAnsweredCount(0);
      setState((prev) =>
        prev?.activity && String(prev.activity.id) === String(payload.activityId)
          ? { ...prev, activity: null, question: null, qa: null }
          : prev
      );
    };
    const onEventCompleted = (payload: LiveState & { leaderboard?: LeaderboardEntry[] }) => {
      setReveal(null);
      setAnswerResult(null);
      setAnsweredCount(0);
      setState((prev) => ({
        ...prev,
        completed: true,
        finalLeaderboard: payload.leaderboard || [],
        event: { ...(prev?.event || {}), ...(payload.event || {}) },
        activity: null,
        question: null,
        counts: { ...(prev?.counts || {}), ...(payload.counts || {}) },
      }));
    };
    /* ── quiz engine (Phase 4 — §16–30) ── */
    const onQuestionOpened = (payload: {
      activityId: string;
      question: { id: string; type: QuestionState["type"]; text: string; media?: QuestionState["media"]; options: string[]; points?: number; correctAnswer?: QuestionState["correctAnswer"]; explanation?: string };
      index: number;
      total: number;
      startedAt: number;
      durationSec: number;
      elapsedBeforePause?: number;
      answeredCount?: number;
      serverTime: number;
    }) => {
      setReveal(null);
      setAnswerResult(null);
      setAnsweredCount(payload.answeredCount ?? 0);
      setState((prev) => (prev ? { ...prev, leaderboardVisible: false } : prev));
      setState((prev) =>
        prev
          ? {
              ...prev,
              question: {
                ...payload.question,
                index: payload.index,
                total: payload.total,
                startedAt: payload.startedAt,
                durationSec: payload.durationSec,
                elapsedBeforePause: payload.elapsedBeforePause ?? 0,
                closed: false,
                remainingMs: payload.durationSec * 1000,
              },
            }
          : prev
      );
    };
    const onQuestionClosed = (payload: {
      activityId: string;
      questionId: string;
      correctAnswer: QuestionReveal["correctAnswer"];
      explanation?: string;
      serverTime: number;
    }) => {
      // Reveal is safe: the server has stopped accepting answers (§21)
      setReveal({ questionId: payload.questionId, correctAnswer: payload.correctAnswer, explanation: payload.explanation });
      setState((prev) =>
        prev?.question && String(prev.question.id) === String(payload.questionId)
          ? { ...prev, question: { ...prev.question, closed: true, remainingMs: 0 } }
          : prev
      );
    };
    const onQuestionAnswers = (payload: { activityId: string; questionId: string; count: number }) => {
      setAnsweredCount(payload.count);
    };
    const onAnswerAccepted = (payload: AnswerResult) => {
      setAnswerResult(payload);
      setState((prev) =>
        prev ? { ...prev, me: { ...prev.me, score: payload.score } } : prev
      );
    };

    /* ── leaderboard (Phase 5 — §31–38) ── */
    const onLeaderboardUpdate = (payload: {
      visible: boolean;
      leaderboard?: LeaderboardEntry[];
    }) => {
      setState((prev) => ({
        ...prev,
        leaderboardVisible: payload.visible,
        // Participants get board data ONLY while visible (§31–33) — hidden
        // updates carry none, so drop any stale copy. Organizer sockets
        // always receive the board with every update.
        leaderboard: payload.leaderboard || (roleRef.current === "organizer" ? prev?.leaderboard ?? [] : null),
      }));
    };

    /* ── Phase 6: poll / Q&A / chat / transitions ── */
    const onPollResults = (payload: { activityId: string; questionId: string; counts: number[]; total: number }) => {
      setState((prev) =>
        prev?.question && String(prev.question.id) === String(payload.questionId)
          ? { ...prev, question: { ...prev.question, results: { counts: payload.counts, total: payload.total } } }
          : prev
      );
    };
    const onQAList = (payload: { activityId: string; closed: boolean; questions: QAState["questions"] }) => {
      setState((prev) => (prev ? { ...prev, qa: { closed: payload.closed, questions: payload.questions } } : prev));
    };
    const onChatMessage = (payload: { message: ChatMessage }) => {
      setState((prev) => {
        if (!prev?.chat) return prev;
        const messages = [...prev.chat.messages, payload.message];
        return { ...prev, chat: { ...prev.chat, messages: messages.slice(-200) } };
      });
    };
    const onChatDeleted = (payload: { messageId: string }) => {
      setState((prev) =>
        prev?.chat
          ? { ...prev, chat: { ...prev.chat, messages: prev.chat.messages.filter((m) => m.id !== payload.messageId) } }
          : prev
      );
    };
    const onChatPinned = (payload: { messageId: string; pinned: boolean; prevPinnedId?: string | null }) => {
      setState((prev) => {
        if (!prev?.chat) return prev;
        const messages = prev.chat.messages.map((m) => {
          if (m.id === payload.messageId) return { ...m, pinned: payload.pinned };
          if (payload.pinned && payload.prevPinnedId && m.id === payload.prevPinnedId) return { ...m, pinned: false };
          return m;
        });
        return { ...prev, chat: { ...prev.chat, messages } };
      });
    };
    const onChatMuted = (payload: { userId: string; muted: boolean }) => {
      setState((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        const isMe = Boolean(meUserIdRef.current) && String(payload.userId) === String(meUserIdRef.current);
        // Own mute flag (the server blocks sends anyway — this is just UX)
        if (isMe && next.chat) next.chat = { ...next.chat, muted: payload.muted };
        // Participants list flag (organizer moderation view)
        if (next.participants) {
          next.participants = next.participants.map((p: any) =>
            String(p.userId) === String(payload.userId) ? { ...p, muted: payload.muted } : p
          );
        }
        return next;
      });
    };

    /* ── Phase 7: announcements (§47) — temporary banner ── */
    const onAnnouncement = (payload: { text: string; at: number }) => {
      setState((prev) => (prev ? { ...prev, announcement: payload } : prev));
      // auto-expire locally to match the server's 10-minute freshness window
      setTimeout(() => {
        setState((prev) =>
          prev?.announcement && prev.announcement.at === payload.at ? { ...prev, announcement: null } : prev
        );
      }, 10 * 60 * 1000);
    };

    const onJoined = (payload: { participant: LiveParticipant; connected: number }) => {
      setState((prev) => {
        if (!prev) return prev;
        const participants = [...(prev.participants || [])];
        if (!participants.some((p) => p.userId === payload.participant.userId) && participants.length < 200) {
          participants.push(payload.participant);
        }
        return {
          ...prev,
          participants: participants.slice(-200),
          counts: { ...prev.counts, connected: payload.connected },
        };
      });
    };
    const onLeft = (payload: { participantId: string; connected: number }) => {
      setState((prev) =>
        prev
          ? {
              ...prev,
              participants: (prev.participants || []).filter((p) => p.userId !== payload.participantId),
              counts: { ...prev.counts, connected: payload.connected },
            }
          : prev
      );
    };
    const onReadyCount = (payload: { ready: number; total: number }) => {
      setState((prev) =>
        prev ? { ...prev, counts: { ...prev.counts, ready: payload.ready, total: payload.total } } : prev
      );
    };
    const onServerTime = (payload: { serverTime: number }) => {
      setOffset(payload.serverTime - Date.now());
    };
    const onError = (payload: SocketErrorPayload) => {
      // Structured errors only (§81) — surface, never crash the page
      if (payload?.code !== "RATE_LIMITED") {
        toast.error(payload?.message || "Live event error");
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("reconnect_attempt", onReconnectAttempt);
    socket.on(LIVE_EVENTS.S_EVENT_STATE, onState);
    socket.on(LIVE_EVENTS.S_PARTICIPANT_JOINED, onJoined);
    socket.on(LIVE_EVENTS.S_PARTICIPANT_LEFT, onLeft);
    socket.on(LIVE_EVENTS.S_READY_COUNT, onReadyCount);
    socket.on(LIVE_EVENTS.S_SERVER_TIME, onServerTime);
    socket.on(LIVE_EVENTS.S_ACTIVITY_STARTING, onActivityStarting);
    socket.on(LIVE_EVENTS.S_ACTIVITY_STARTED, onActivityStarted);
    socket.on(LIVE_EVENTS.S_ACTIVITY_PAUSED, onActivityPaused);
    socket.on(LIVE_EVENTS.S_ACTIVITY_ENDED, onActivityEnded);
    socket.on(LIVE_EVENTS.S_EVENT_COMPLETED, onEventCompleted);
    socket.on(LIVE_EVENTS.S_QUESTION_OPENED, onQuestionOpened);
    socket.on(LIVE_EVENTS.S_QUESTION_CLOSED, onQuestionClosed);
    socket.on(LIVE_EVENTS.S_QUESTION_ANSWERS, onQuestionAnswers);
    socket.on(LIVE_EVENTS.S_ANSWER_ACCEPTED, onAnswerAccepted);
    socket.on(LIVE_EVENTS.S_LEADERBOARD_UPDATE, onLeaderboardUpdate);
    socket.on(LIVE_EVENTS.S_POLL_RESULTS, onPollResults);
    socket.on(LIVE_EVENTS.S_QA_LIST, onQAList);
    socket.on(LIVE_EVENTS.S_CHAT_MESSAGE, onChatMessage);
    socket.on(LIVE_EVENTS.S_CHAT_DELETED, onChatDeleted);
    socket.on(LIVE_EVENTS.S_CHAT_PINNED, onChatPinned);
    socket.on(LIVE_EVENTS.S_CHAT_MUTED, onChatMuted);
    socket.on(LIVE_EVENTS.S_ANNOUNCEMENT_NEW, onAnnouncement);
    socket.on(LIVE_EVENTS.S_ERROR, onError);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("reconnect_attempt", onReconnectAttempt);
      socket.off(LIVE_EVENTS.S_EVENT_STATE, onState);
      socket.off(LIVE_EVENTS.S_PARTICIPANT_JOINED, onJoined);
      socket.off(LIVE_EVENTS.S_PARTICIPANT_LEFT, onLeft);
      socket.off(LIVE_EVENTS.S_READY_COUNT, onReadyCount);
      socket.off(LIVE_EVENTS.S_SERVER_TIME, onServerTime);
      socket.off(LIVE_EVENTS.S_ACTIVITY_STARTING, onActivityStarting);
      socket.off(LIVE_EVENTS.S_ACTIVITY_STARTED, onActivityStarted);
      socket.off(LIVE_EVENTS.S_ACTIVITY_PAUSED, onActivityPaused);
      socket.off(LIVE_EVENTS.S_ACTIVITY_ENDED, onActivityEnded);
      socket.off(LIVE_EVENTS.S_EVENT_COMPLETED, onEventCompleted);
      socket.off(LIVE_EVENTS.S_QUESTION_OPENED, onQuestionOpened);
      socket.off(LIVE_EVENTS.S_QUESTION_CLOSED, onQuestionClosed);
      socket.off(LIVE_EVENTS.S_QUESTION_ANSWERS, onQuestionAnswers);
      socket.off(LIVE_EVENTS.S_ANSWER_ACCEPTED, onAnswerAccepted);
      socket.off(LIVE_EVENTS.S_LEADERBOARD_UPDATE, onLeaderboardUpdate);
      socket.off(LIVE_EVENTS.S_POLL_RESULTS, onPollResults);
      socket.off(LIVE_EVENTS.S_QA_LIST, onQAList);
      socket.off(LIVE_EVENTS.S_CHAT_MESSAGE, onChatMessage);
      socket.off(LIVE_EVENTS.S_CHAT_DELETED, onChatDeleted);
      socket.off(LIVE_EVENTS.S_CHAT_PINNED, onChatPinned);
      socket.off(LIVE_EVENTS.S_CHAT_MUTED, onChatMuted);
      socket.off(LIVE_EVENTS.S_ANNOUNCEMENT_NEW, onAnnouncement);
      socket.off(LIVE_EVENTS.S_ERROR, onError);
      // Leave the room on unmount (best effort — server also cleans on disconnect)
      if (joinedEventRef.current && socket.connected) {
        socket.emit(LIVE_EVENTS.C_EVENT_LEAVE, { eventId: joinedEventRef.current });
      }
    };
  }, []);

  /* ── actions ── */
  const join = useCallback((eventId: string, opts?: { display?: boolean }): Promise<JoinAck> => {
    const socket = socketRef.current || getSocket();
    joinedEventRef.current = eventId;
    displayRef.current = Boolean(opts?.display);
    return new Promise((resolve) => {
      socket.emit(LIVE_EVENTS.C_EVENT_JOIN, { eventId, display: Boolean(opts?.display) }, (ack: JoinAck) => {
        setJoinAck(ack);
        // display sockets get participant-style data (never organizer extras)
        if (ack?.ok) roleRef.current = ack.role === "organizer" ? "organizer" : "participant";
        if (ack?.ok && ack.state) setState(ack.state);
        resolve(ack || { ok: false, message: "No response from server" });
      });
    });
  }, []);

  const setReady = useCallback((eventId: string) => {
    socketRef.current?.emit(LIVE_EVENTS.C_EVENT_READY, { eventId });
  }, []);

  const command = useCallback((event: string, payload: Record<string, unknown>): Promise<JoinAck> => {
    const socket = socketRef.current || getSocket();
    return new Promise((resolve) => {
      socket.emit(event, payload, (ack: JoinAck) => {
        resolve(ack || { ok: false, message: "No response" });
      });
    });
  }, []);

  const startEvent = useCallback(
    (eventId: string) => command(LIVE_EVENTS.O_EVENT_START, { eventId }),
    [command]
  );
  const pauseEvent = useCallback(
    (eventId: string) => command(LIVE_EVENTS.O_EVENT_PAUSE, { eventId }),
    [command]
  );
  const resumeEvent = useCallback(
    (eventId: string) => command(LIVE_EVENTS.O_EVENT_RESUME, { eventId }),
    [command]
  );
  const endEvent = useCallback(
    (eventId: string) => command(LIVE_EVENTS.O_EVENT_END, { eventId }),
    [command]
  );
  const startActivity = useCallback(
    (activityId: string, eventId: string) => command(LIVE_EVENTS.O_ACTIVITY_START, { activityId, eventId }),
    [command]
  );
  const pauseActivity = useCallback(
    (activityId: string, eventId: string) => command(LIVE_EVENTS.O_ACTIVITY_PAUSE, { activityId, eventId }),
    [command]
  );
  const resumeActivity = useCallback(
    (activityId: string, eventId: string) => command(LIVE_EVENTS.O_ACTIVITY_RESUME, { activityId, eventId }),
    [command]
  );
  const endActivity = useCallback(
    (activityId: string, eventId: string) => command(LIVE_EVENTS.O_ACTIVITY_END, { activityId, eventId }),
    [command]
  );
  const nextActivity = useCallback(
    (activityId: string, eventId: string) => command(LIVE_EVENTS.O_ACTIVITY_NEXT, { activityId, eventId }),
    [command]
  );
  const prevActivity = useCallback(
    (activityId: string, eventId: string) => command(LIVE_EVENTS.O_ACTIVITY_PREV, { activityId, eventId }),
    [command]
  );

  /* ── quiz engine actions ── */
  const answerQuestion = useCallback(
    (activityId: string, questionId: string, answer: number | number[] | string): Promise<
      JoinAck & { correct?: boolean | null; points?: number; score?: number }
    > => command(LIVE_EVENTS.C_ACTIVITY_ANSWER, { activityId, questionId, answer }),
    [command]
  );
  const nextQuestion = useCallback(
    (activityId: string) => command(LIVE_EVENTS.O_QUESTION_NEXT, { activityId }),
    [command]
  );
  const prevQuestion = useCallback(
    (activityId: string) => command(LIVE_EVENTS.O_QUESTION_PREV, { activityId }),
    [command]
  );
  const closeQuestion = useCallback(
    (activityId: string) => command(LIVE_EVENTS.O_QUESTION_CLOSE, { activityId }),
    [command]
  );
  const showLeaderboard = useCallback(
    (eventId: string) => command(LIVE_EVENTS.O_LEADERBOARD_SHOW, { eventId }),
    [command]
  );
  const hideLeaderboard = useCallback(
    (eventId: string) => command(LIVE_EVENTS.O_LEADERBOARD_HIDE, { eventId }),
    [command]
  );

  /* ── Phase 6 actions ── */
  const submitQA = useCallback(
    (activityId: string, text: string) => command(LIVE_EVENTS.C_QA_SUBMIT, { activityId, text }),
    [command]
  );
  const upvoteQA = useCallback(
    (questionId: string) => command(LIVE_EVENTS.C_QA_UPVOTE, { questionId }),
    [command]
  );
  const featureQA = useCallback(
    (questionId: string) => command(LIVE_EVENTS.O_QA_FEATURE, { questionId }),
    [command]
  );
  const answerQA = useCallback(
    (questionId: string, answerText: string) => command(LIVE_EVENTS.O_QA_ANSWER, { questionId, answerText }),
    [command]
  );
  const hideQA = useCallback(
    (questionId: string) => command(LIVE_EVENTS.O_QA_HIDE, { questionId }),
    [command]
  );
  const closeQA = useCallback(
    (activityId: string) => command(LIVE_EVENTS.O_QA_CLOSE, { activityId }),
    [command]
  );
  const sendChat = useCallback(
    (eventId: string, text: string) => command(LIVE_EVENTS.C_CHAT_SEND, { eventId, text }),
    [command]
  );
  const deleteChatMessage = useCallback(
    (messageId: string) => command(LIVE_EVENTS.O_CHAT_DELETE, { messageId }),
    [command]
  );
  const pinChatMessage = useCallback(
    (messageId: string) => command(LIVE_EVENTS.O_CHAT_PIN, { messageId }),
    [command]
  );
  const muteChatUser = useCallback(
    (eventId: string, userId: string, muted: boolean) => command(LIVE_EVENTS.O_CHAT_MUTE, { eventId, userId, muted }),
    [command]
  );
  const sendAnnouncement = useCallback(
    (eventId: string, text: string) => command(LIVE_EVENTS.O_ANNOUNCEMENT_SEND, { eventId, text }),
    [command]
  );

  return {
    status, offset, state, joinAck,
    answerResult, reveal, answeredCount,
    join, setReady,
    startEvent, pauseEvent, resumeEvent, endEvent,
    startActivity, pauseActivity, resumeActivity, endActivity, nextActivity, prevActivity,
    answerQuestion, nextQuestion, prevQuestion, closeQuestion,
    showLeaderboard, hideLeaderboard,
    submitQA, upvoteQA, featureQA, answerQA, hideQA, closeQA,
    sendChat, deleteChatMessage, pinChatMessage, muteChatUser,
    sendAnnouncement,
  };
}
