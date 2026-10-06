"use client";

/**
 * Participant Live Event screen (Part 4, Phase 2 — spec §5, §8–12, §45, §82).
 * Flow: not started → "Event hasn't started yet." · joinable → JOIN LIVE
 * EVENT · joined → waiting room ("You're in.", live count, animated bubbles,
 * I'm ready) · LIVE → live view (activities arrive in Phase 3+).
 * Connection state is always visible; a lost connection NEVER kicks the
 * participant out (§82) — reconnection re-syncs state (§51).
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Award, BarChart3, CheckCircle2, Loader2, Megaphone, Pause, Radio, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/states";
import { useSessionUser } from "@/components/shell/use-session-user";
import { ParticipantBubbles } from "@/components/live/participant-bubbles";
import { QuizQuestionView } from "@/components/live/quiz-question";
import { LiveLeaderboard } from "@/components/live/leaderboard";
import { QAPanel } from "@/components/live/qa-panel";
import { ChatPanel } from "@/components/live/chat-panel";
import { useLiveEvent } from "@/components/live/use-live-event";
import { cn } from "@/lib/utils";

const PRE_LIVE = ["DRAFT", "PUBLISHED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"];
const JOINABLE = ["CHECK_IN", "WAITING", "LIVE", "PAUSED"];

export default function LiveEventPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl px-3 py-10"><Skeleton className="h-40" /></div>}>
      <LiveEventView />
    </Suspense>
  );
}

function LiveEventView() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user, ready } = useSessionUser();
  const {
    status, offset, state, join, setReady,
    answerQuestion, answerResult, reveal,
    submitQA, upvoteQA, sendChat,
  } = useLiveEvent(user?._id);

  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<any>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [readySent, setReadySent] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState("");
  const [results, setResults] = useState<any>(null);
  const joinedRef = useRef(false);

  /* Load event (public data incl. liveState) */
  useEffect(() => {
    api
      .get(`/events/slug/${slug}`)
      .then((r) => setEvent(r.data?.event || null))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false));
  }, [slug]);

  /* Pre-flight join eligibility (server-side truth) */
  const checkEligibility = useCallback(() => {
    if (!event?._id || !user) return;
    api
      .get(`/events/${event._id}/live/eligibility`)
      .then((r) => {
        if (r.data?.success) {
          setEligibility(r.data);
          if (r.data.blockedReason === "registration") {
            setBlockedMessage("You need to register for this event before joining the live room.");
          } else if (r.data.blockedReason === "check_in") {
            setBlockedMessage("Check-in is required — get your ticket scanned at the venue first.");
          } else {
            setBlockedMessage("");
          }
        }
      })
      .catch(() => {});
  }, [event?._id, user]);

  useEffect(() => {
    checkEligibility();
  }, [checkEligibility]);

  /* Phase 8 (§58): once completed, load the immutable EventResult snapshot
     for the full final-results view (accuracy, rank, podium). */
  useEffect(() => {
    if (!event?._id) return;
    const completed = state?.completed || state?.event?.liveState === "COMPLETED";
    if (!completed) return;
    api
      .get(`/events/${event._id}/results`)
      .then((r) => setResults(r.data?.success ? r.data : null))
      .catch(() => setResults(null));
  }, [event?._id, state?.completed, state?.event?.liveState]);

  /* Auto-join organizers straight into the room (they never press JOIN) */
  useEffect(() => {
    if (!event?._id || !user || eligibility?.isOrganizer === undefined) return;
    if (eligibility.isOrganizer && JOINABLE.includes(event.liveState)) {
      router.replace(`/admin/events/${event._id}/live`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?._id, eligibility?.isOrganizer]);

  const doJoin = async () => {
    if (!event?._id || joining) return;
    setJoining(true);
    try {
      const ack = await join(event._id);
      if (ack.ok) {
        setJoined(true);
        joinedRef.current = true;
        if (ack.state?.me?.ready) setReadySent(true);
        toast.success("You're in!");
      } else {
        toast.error(ack.message || "Couldn't join the live event");
        if (ack.notStarted) {
          setEvent((p: any) => (p ? { ...p, liveState: "PUBLISHED" } : p));
        }
      }
    } finally {
      setJoining(false);
    }
  };

  const doReady = () => {
    if (!event?._id || readySent) return;
    setReady(event._id);
    setReadySent(true);
  };

  /* §82: while disconnected NOTHING is blindly submitted — the answer is
     not sent, the user is told why, and state re-syncs on reconnect. */
  const guardedAnswer = useCallback(
    (activityId: string, questionId: string, answer: number | number[] | string) => {
      if (status !== "connected") {
        toast.error("Reconnecting — your answer wasn't sent. The question re-syncs when the connection returns.");
        return Promise.resolve({ ok: false });
      }
      return answerQuestion(activityId, questionId, answer);
    },
    [status, answerQuestion]
  );
  const guardedSubmitQA = useCallback(
    (activityId: string, text: string) => {
      if (status !== "connected") {
        toast.error("Reconnecting — try again when the connection returns.");
        return Promise.resolve({ ok: false });
      }
      return submitQA(activityId, text);
    },
    [status, submitQA]
  );
  const guardedSendChat = useCallback(
    (eventId: string, text: string) => {
      if (status !== "connected") {
        toast.error("Reconnecting — try again when the connection returns.");
        return Promise.resolve({ ok: false });
      }
      return sendChat(eventId, text);
    },
    [status, sendChat]
  );

  /* ── auth gate ── */
  if (ready && !user) {
    return (
      <div className="mx-auto max-w-xl px-3 py-16">
        <EmptyState
          icon={Radio}
          title="Sign in to join the live event"
          description="Live quizzes, polls and Q&A happen in the EventHub live room."
        />
        <div className="mt-4 flex justify-center gap-2">
          <Button asChild>
            <Link href={`/login?returnUrl=/events/${slug}/live`}>Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-3 py-10">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="mt-3 h-40" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-xl px-3 py-16">
        <EmptyState icon={Radio} title="Event not found" description="This live room doesn't exist." />
      </div>
    );
  }

  const liveState = state?.event?.liveState || event.liveState;
  const connected = state?.counts?.connected ?? 0;
  const readyCount = state?.counts?.ready ?? 0;

  /* ── Pre-live (spec §5) ── */
  if (PRE_LIVE.includes(liveState)) {
    return (
      <Shell title={event.title} status={status}>
        <div className="py-14 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Radio className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="mt-4 text-lg font-extrabold text-foreground">Event hasn&apos;t started yet.</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            The live room opens when the organizer starts the event. Come back closer to the start time.
          </p>
          <Button asChild variant="outline" className="mt-5">
            <Link href={`/events/${slug}`}>View event page</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  /* ── Blocked (registration / check-in) ── */
  if (!joined && blockedMessage) {
    return (
      <Shell title={event.title} status={status}>
        <div className="py-14 text-center">
          <h2 className="text-lg font-extrabold text-foreground">You can&apos;t join yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{blockedMessage}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/events/${slug}`}>Event page</Link>
            </Button>
            <Button variant="outline" onClick={checkEligibility} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Recheck
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ── Join gate (spec §5: JOIN LIVE EVENT) ── */
  if (!joined) {
    return (
      <Shell title={event.title} status={status}>
        <div className="py-16 text-center">
          <div className="mx-auto flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-brand-light">
            <Radio className="h-9 w-9 text-primary" />
          </div>
          <h2 className="mt-5 text-xl font-extrabold tracking-tight text-foreground">
            {liveState === "LIVE" || liveState === "PAUSED" ? "This event is live" : "The live room is open"}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {connected > 0 ? `${connected} ${connected === 1 ? "participant is" : "participants are"} already in the room. ` : ""}
            Join to take part in quizzes, polls and Q&A.
          </p>
          <Button size="lg" onClick={doJoin} disabled={joining} className="mt-6 h-12 px-8 text-base">
            {joining ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
            JOIN LIVE EVENT
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">Live state: {liveState.toLowerCase().replace("_", " ")}</p>
        </div>
      </Shell>
    );
  }

  /* ── COMPLETED — final results from the immutable snapshot (spec §58) ── */
  if (state?.completed || liveState === "COMPLETED") {
    const data = results;
    const board = data?.leaderboard || state?.finalLeaderboard || [];
    const me = data?.me || board.find((e: any) => e.participantId === user?._id) || null;
    const summary = data?.summary || null;
    return (
      <Shell title={event.title} status={status}>
        <div className="py-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-[#006C4C]" />
          <h2 className="mt-3 text-xl font-extrabold tracking-tight text-foreground">Event completed</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You were part of {event.title}.
            {summary ? ` ${summary.totalParticipants} participants · ${summary.totalAnswers} answers.` : ""}
          </p>

          {/* Own result cards — score, rank, accuracy (§58) */}
          <div className="mx-auto mt-5 grid max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-2xl font-extrabold tabular-nums text-foreground">{me?.score ?? state?.me?.score ?? 0}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Score</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-2xl font-extrabold tabular-nums text-foreground">{me ? `#${me.rank}` : "—"}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Rank</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-2xl font-extrabold tabular-nums text-foreground">
                {me ? `${me.accuracy ?? 0}%` : "—"}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Accuracy</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-2xl font-extrabold tabular-nums text-foreground">{me?.answered ?? 0}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Answered</p>
            </div>
          </div>

          {/* Podium + full board, current participant highlighted (§58) */}
          {board.length > 0 ? (
            <div className="mx-auto mt-6 max-w-md text-left">
              <LiveLeaderboard entries={board} meUserId={user?._id} />
            </div>
          ) : null}

          {/* Phase 9 (§61–63): achievements earned here + certificate status */}
          {results?.achievements?.length ? (
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Achievements from this event</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {results.achievements.map((code: string) => (
                  <span key={code} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-brand-light px-3 py-1 text-xs font-bold text-primary">
                    <Award className="h-3 w-3" aria-hidden="true" />
                    {code.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {results?.certificate?.available ? (
            <p className="mt-3 text-xs text-muted-foreground">
              <Award className="mr-1 inline h-3.5 w-3.5 text-[#006C4C]" aria-hidden="true" />
              <span className="font-bold capitalize text-foreground">{results.certificate.kind} certificate</span> requested — generation comes in a future update.
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href={`/events/${slug}/memory`}>View your event memory</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/events/${slug}`}>Back to event page</Link>
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ── LIVE state: question view / activity panel / paused / idle (spec §45, §56, §93) ── */
  if (liveState === "LIVE" || liveState === "PAUSED") {
    const activity = state?.activity || null;
    const question = state?.question || null;

    /* TRANSITION (Phase 6 — §43): animated "Next activity starting…" cue.
       Pure presentation — state is already authoritative underneath. */
    if (state?.transition) {
      const t = state.transition.activity;
      return (
        <Shell title={event.title} status={status} connected={connected}>
          <div className="flex min-h-[280px] flex-col items-center justify-center py-8 text-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={String(t.id)}
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Next activity starting…</p>
                <motion.h2
                  className="mt-3 text-2xl font-extrabold tracking-tight text-foreground"
                  initial={{ letterSpacing: "0.02em" }}
                  animate={{ letterSpacing: "0em" }}
                  transition={{ duration: 0.5 }}
                >
                  {t.title}
                </motion.h2>
                <p className="mt-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">{t.type.replace(/_/g, " ")}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </Shell>
      );
    }

    /* LEADERBOARD screen (Phase 5 — §31–38, §45): the organizer (or the
       visibility config) put the board on participant screens. */
    if (state?.leaderboardVisible && state?.leaderboard) {
      return (
        <Shell title={event.title} status={status} connected={connected}>
          <div className="py-2">
            <div className="mb-3 flex items-center justify-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Live leaderboard</p>
            </div>
            <LiveLeaderboard entries={state.leaderboard} meUserId={user?._id} />
            {state?.myRank ? (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                You&apos;re <span className="font-extrabold text-foreground">#{state.myRank}</span> with{" "}
                <span className="font-bold text-foreground">{state?.me?.score ?? 0} pts</span>
              </p>
            ) : null}
            <p className="mt-2 text-center text-[11px] text-muted-foreground">The board hides automatically when the next question opens.</p>
          </div>
        </Shell>
      );
    }

    /* Quiz/poll question surface (Phase 4 — §16–30). The question card
       renders even while the EVENT is paused mid-question: the hook has
       frozen the timer at the server-derived remaining time. */
    if (question && activity && (activity.type === "QUIZ" || activity.type === "POLL") && String(question.id)) {
      return (
        <Shell
          title={event.title}
          status={status}
          connected={connected}
          footer={
            state?.chat ? (
              <ChatPanel chat={state.chat} eventId={event._id} meUserId={user?._id} variant="participant" onSend={guardedSendChat} className="max-h-72" />
            ) : null
          }
          announcement={state?.announcement || null}
        >
          {liveState === "PAUSED" ? (
            <div className="mb-3 flex items-center justify-center gap-2 rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-xs font-bold text-warning">
              <Pause className="h-3.5 w-3.5" /> EVENT PAUSED — the clock is frozen
            </div>
          ) : null}
          <div className="py-2">
            <p className="mb-2 truncate text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              {activity.title}
            </p>
            <QuizQuestionView
              activityId={activity.id}
              question={question}
              reveal={reveal}
              answerResult={answerResult}
              offset={offset}
              paused={liveState === "PAUSED" || activity.state === "PAUSED"}
              isPoll={activity.type === "POLL"}
              onAnswer={guardedAnswer}
            />
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Your score: <span className="font-bold text-foreground">{state?.me?.score ?? 0}</span>
            {state?.myRank ? (
              <>
                {" "}· Rank <span className="font-bold text-foreground">#{state.myRank}</span>
              </>
            ) : null}
          </p>
        </Shell>
      );
    }

    const chatFooter = state?.chat ? (
      <ChatPanel chat={state.chat} eventId={event._id} meUserId={user?._id} variant="participant" onSend={guardedSendChat} className="max-h-72" />
    ) : null;

    return (
      <Shell
        title={event.title}
        status={status}
        connected={connected}
        footer={chatFooter}
        announcement={state?.announcement || null}
      >
        <div className="py-10 text-center">
          {liveState === "PAUSED" ? (
            <>
              <span className="inline-flex items-center gap-2 rounded-full bg-warning-light px-4 py-1.5 text-sm font-bold text-warning">
                <Pause className="h-4 w-4" /> EVENT PAUSED
              </span>
              <h2 className="mt-4 text-lg font-extrabold text-foreground">The organizer paused the event</h2>
              <p className="mt-1 text-sm text-muted-foreground">Hold on — everything resumes automatically.</p>
            </>
          ) : activity ? (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold",
                  activity.state === "LIVE" ? "bg-[#ba1a1a] text-white" : "bg-warning-light text-warning"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", activity.state === "LIVE" ? "animate-pulse bg-white" : "bg-warning")} />
                {activity.state === "LIVE" ? "LIVE" : "ACTIVITY PAUSED"}
              </span>
              <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{activity.type}</p>
              <h2 className="mt-1 text-xl font-extrabold tracking-tight text-foreground">{activity.title}</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                {activity.state === "PAUSED"
                  ? "Activity paused by organizer."
                  : activity.type === "QUIZ"
                    ? "Get ready — questions land here the moment they open."
                    : activity.type === "POLL"
                      ? "Voting opens here shortly."
                      : activity.type === "QA"
                        ? "Ask your questions below — upvote the good ones."
                        : "Activity running."}
              </p>
              {activity.type === "QA" && state?.qa ? (
                <div className="mx-auto mt-4 max-w-lg text-left">
                  <QAPanel
                    qa={state.qa}
                    activityId={activity.id}
                    variant="participant"
                    onSubmit={guardedSubmitQA}
                    onUpvote={upvoteQA}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#ba1a1a] px-4 py-1.5 text-sm font-bold text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> LIVE
              </span>
              <h2 className="mt-4 text-lg font-extrabold text-foreground">You&apos;re in the live room</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Activities run here as the organizer starts them. {connected} connected.
              </p>
            </>
          )}
          <p className="mt-6 text-xs text-muted-foreground">
            Your score: <span className="font-bold text-foreground">{state?.me?.score ?? 0}</span>
            {state?.myRank ? (
              <>
                {" "}· Rank <span className="font-bold text-foreground">#{state.myRank}</span>
              </>
            ) : null}
          </p>
        </div>
      </Shell>
    );
  }

  /* ── Waiting room (spec §8–12) ── */
  return (
    <Shell
      title={event.title}
      status={status}
      connected={connected}
      footer={
        state?.chat ? (
          <ChatPanel chat={state.chat} eventId={event._id} meUserId={user?._id} variant="participant" onSend={guardedSendChat} className="max-h-72" />
        ) : null
      }
      announcement={state?.announcement || null}
    >
      <div className="py-6 text-center">
        <h2 className="text-2xl font-extrabold tracking-tight text-foreground">You&apos;re in.</h2>
        <p className="mt-1 text-sm text-muted-foreground">Waiting for the organizer to start.</p>

        <p className="mt-6 text-3xl font-extrabold tabular-nums text-foreground">
          {connected}
          <span className="ml-1.5 text-sm font-semibold text-muted-foreground">
            {connected === 1 ? "participant" : "participants"} joined
          </span>
        </p>

        <ParticipantBubbles participants={state?.participants || []} meUserId={user?._id} />

        {readyCount > 0 && (
          <p className="text-xs text-muted-foreground">{readyCount} ready to go</p>
        )}

        <div className="mt-6">
          {readySent ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-success-light px-5 py-2.5 text-sm font-bold text-[#006C4C]">
              <CheckCircle2 className="h-4 w-4" /> You&apos;re ready
            </span>
          ) : (
            <Button size="lg" variant="outline" onClick={doReady} className="h-12 px-8">
              I&apos;m ready
            </Button>
          )}
        </div>

        <p className="mt-8 text-[11px] text-muted-foreground">
          Keep this page open — the event starts here automatically. Clock sync offset:{" "}
          <span className="tabular-nums">{Math.round(offset / 100) / 10}s</span>
        </p>
      </div>
    </Shell>
  );
}

/* ── Shared shell: header + connection status banner (spec §82) ── */
function Shell({
  title,
  status,
  connected,
  footer,
  announcement,
  children,
}: {
  title: string;
  status: string;
  connected?: number;
  footer?: React.ReactNode;
  announcement?: { text: string; at: number } | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-6 sm:py-7">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">EventHub Live</p>
          <h1 className="truncate text-lg font-extrabold tracking-tight text-foreground sm:text-xl">{title}</h1>
        </div>
        {typeof connected === "number" && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
            <Wifi className="h-3.5 w-3.5" /> {connected}
          </span>
        )}
      </div>

      {status === "reconnecting" || status === "disconnected" ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-xs font-semibold text-warning">
          <WifiOff className="h-4 w-4 shrink-0 animate-pulse" />
          Connection lost. Reconnecting… you&apos;re still in the event.
        </div>
      ) : null}

      {/* Organizer announcement (§47) — temporary broadcast banner */}
      {announcement ? (
        <div
          className="mt-3 flex items-center gap-2.5 rounded-xl border border-primary/40 bg-brand-light px-3.5 py-2.5 text-sm font-bold text-foreground"
          role="status"
        >
          <Megaphone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">{announcement.text}</span>
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-border bg-card p-4 sm:p-6">{children}</div>
      {footer ? <div className="mt-4 rounded-2xl border border-border bg-card p-4">{footer}</div> : null}
    </div>
  );
}
