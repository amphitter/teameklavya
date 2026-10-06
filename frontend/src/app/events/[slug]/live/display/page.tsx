"use client";

/**
 * PROJECTOR MODE (Part 4, Phase 7 — spec §46, §93).
 * `/events/[slug]/live/display` — a big-screen, read-only mirror of the
 * live event: huge typography, high contrast, minimal UI.
 *
 * Connects as a DISPLAY socket: no participant session, no presence count,
 * no controls, no private info — and it only ever receives participant-
 * sanitized broadcasts (never the answer key before close). What the room
 * sees, the screen sees — nothing more.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Megaphone, Pause, Radio, Wifi, WifiOff } from "lucide-react";
import { api } from "@/utils/api";
import { EmptyState, Skeleton } from "@/components/states";
import { useLiveEvent } from "@/components/live/use-live-event";
import { LiveLeaderboard } from "@/components/live/leaderboard";
import { QuestionTimer } from "@/components/live/timer";
import { cn } from "@/lib/utils";

const OPTION_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export default function DisplayPage() {
  return (
    <Suspense fallback={<div className="p-10"><Skeleton className="h-24" /></div>}>
      <DisplayView />
    </Suspense>
  );
}

function DisplayView() {
  const { slug } = useParams<{ slug: string }>();
  const { status, offset, state, reveal, join } = useLiveEvent();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const joinedRef = useRef(false);

  /* Public event data (title, join code) */
  useEffect(() => {
    api
      .get(`/events/slug/${slug}`)
      .then((r) => setEvent(r.data?.event || null))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false));
  }, [slug]);

  /* Display join — read-only socket (§46) */
  useEffect(() => {
    if (!event?._id || joinedRef.current) return;
    joinedRef.current = true;
    join(event._id, { display: true });
  }, [event?._id, join]);

  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/events/${slug}/live` : "";
  const joinCode = state?.event?.joinCode || event?.joinCode || "";
  const liveState = state?.event?.liveState || event?.liveState || "PUBLISHED";
  const activity = state?.activity || null;
  const question = state?.question || null;
  const announcement = state?.announcement || null;
  // Reveal arrives via question:closed (§21) — the display question payload
  // itself is sanitized and never carries the answer key.
  const revealQ = question?.closed ? reveal : null;

  const view = useMemo(() => {
    /* ── COMPLETED ── */
    if (liveState === "COMPLETED") {
      return (
        <Center>
          <p className="text-sm font-bold uppercase tracking-[0.35em] text-zinc-500">Event completed</p>
          <h1 className="mt-4 text-5xl font-black tracking-tight text-white">{event?.title}</h1>
          {state?.leaderboard?.length ? (
            <div className="mx-auto mt-8 max-w-2xl">
              <LiveLeaderboard entries={state.leaderboard} />
            </div>
          ) : state?.finalLeaderboard?.length ? (
            <div className="mx-auto mt-8 max-w-2xl">
              <LiveLeaderboard entries={state.finalLeaderboard} />
            </div>
          ) : null}
        </Center>
      );
    }

    /* ── PAUSED ── */
    if (liveState === "PAUSED" && !question) {
      return (
        <Center>
          <Pause className="h-16 w-16 text-amber-400" aria-hidden="true" />
          <h1 className="mt-6 text-5xl font-black tracking-tight text-white">Event paused</h1>
          <p className="mt-3 text-xl text-zinc-400">Hold on — everything resumes automatically.</p>
          <QrBlock joinUrl={joinUrl} joinCode={joinCode} />
        </Center>
      );
    }

    /* ── TRANSITION (§43) ── */
    if (state?.transition) {
      const t = state.transition.activity;
      return (
        <Center>
          <p className="text-sm font-bold uppercase tracking-[0.35em] text-emerald-400">Next activity starting…</p>
          <h1 className="mt-5 text-6xl font-black tracking-tight text-white">{t.title}</h1>
          <p className="mt-4 text-2xl font-bold uppercase tracking-widest text-zinc-500">{t.type.replace(/_/g, " ")}</p>
        </Center>
      );
    }

    /* ── LEADERBOARD on screen ── */
    if (state?.leaderboardVisible && state?.leaderboard) {
      return (
        <div className="flex h-full flex-col px-6 py-6">
          <p className="text-center text-sm font-bold uppercase tracking-[0.35em] text-emerald-400">Leaderboard</p>
          <div className="mx-auto mt-4 w-full max-w-3xl flex-1 overflow-y-auto">
            <LiveLeaderboard entries={state.leaderboard} />
          </div>
        </div>
      );
    }

    /* ── QUESTION (quiz / poll) — huge type, zero controls ── */
    if (question && activity && (activity.type === "QUIZ" || activity.type === "POLL")) {
      const isPoll = activity.type === "POLL";
      const results = question.results;
      return (
        <div className="flex h-full flex-col px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <p className="truncate text-lg font-bold uppercase tracking-widest text-zinc-400">
              {activity.title}
              {typeof question.index === "number" && typeof question.total === "number"
                ? ` · Q${question.index + 1}/${question.total}`
                : ""}
            </p>
            <QuestionTimer
              startedAt={activity.state === "PAUSED" ? null : question.startedAt}
              durationSec={question.durationSec}
              elapsedBeforePause={question.elapsedBeforePause}
              remainingMs={question.remainingMs}
              offset={offset}
              size="lg"
            />
          </div>
          <h1 className="mt-4 text-center text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            {question.text}
          </h1>
          {question.media?.url ? (
            <img src={question.media.url} alt={question.media.alt || "Question media"} className="mx-auto mt-4 max-h-60 rounded-2xl object-contain" />
          ) : null}
          <div className="mx-auto mt-6 grid w-full max-w-4xl flex-1 content-start gap-3 sm:grid-cols-2">
            {question.options.map((opt: string, idx: number) => {
              const pct = results && results.total ? Math.round((results.counts[idx] / results.total) * 100) : 0;
              const isCorrect =
                revealQ && !isPoll
                  ? Array.isArray((revealQ as any).correctAnswer)
                    ? (revealQ as any).correctAnswer.includes(idx)
                    : Number((revealQ as any).correctAnswer) === idx
                  : false;
              return (
                <div
                  key={idx}
                  className={cn(
                    "relative overflow-hidden rounded-2xl border-2 px-5 py-4",
                    isCorrect ? "border-emerald-500 bg-emerald-500/15" : "border-zinc-800 bg-zinc-900/80"
                  )}
                >
                  {isPoll && results ? (
                    <div className="absolute inset-y-0 left-0 bg-emerald-500/15 transition-all duration-500" style={{ width: `${pct}%` }} aria-hidden="true" />
                  ) : null}
                  <div className="relative flex items-center gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-zinc-700 text-lg font-black text-zinc-300">
                      {OPTION_KEYS[idx] ?? idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-2xl font-bold text-white">{opt}</span>
                    {isCorrect ? <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-400" aria-label="Correct answer" /> : null}
                    {isPoll && results ? (
                      <span className="shrink-0 text-xl font-black tabular-nums text-emerald-400">{pct}%</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {revealQ && !isPoll && (revealQ as any).explanation ? (
            <p className="mx-auto mt-4 max-w-3xl text-center text-lg text-zinc-400">{(revealQ as any).explanation}</p>
          ) : null}
        </div>
      );
    }

    /* ── Q&A — top-voted questions, read-only ── */
    if (activity?.type === "QA" && state?.qa) {
      const top = state.qa.questions.slice(0, 5);
      return (
        <div className="flex h-full flex-col px-6 py-6">
          <p className="text-center text-sm font-bold uppercase tracking-[0.35em] text-emerald-400">Audience Q&A</p>
          <h1 className="mt-2 text-center text-4xl font-black tracking-tight text-white">{activity.title}</h1>
          <ul className="mx-auto mt-6 w-full max-w-3xl space-y-3">
            {top.length === 0 ? (
              <li className="text-center text-xl text-zinc-500">Questions appear here as the audience submits them.</li>
            ) : (
              top.map((q, i) => (
                <li key={q.id} className={cn("flex items-start gap-4 rounded-2xl border-2 px-5 py-4", q.status === "featured" ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900/80")}>
                  <span className="text-2xl font-black text-zinc-600">{i + 1}</span>
                  <p className="min-w-0 flex-1 text-2xl font-bold leading-snug text-white">{q.text}</p>
                  <span className="shrink-0 rounded-xl bg-zinc-800 px-3 py-1 text-lg font-black tabular-nums text-emerald-400">▲ {q.votes}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      );
    }

    /* ── LIVE, no question ── */
    if (liveState === "LIVE" || liveState === "PAUSED") {
      return (
        <Center>
          <span className="inline-flex items-center gap-3 rounded-full bg-red-600 px-6 py-2 text-lg font-black uppercase tracking-widest text-white">
            <span className="h-3 w-3 animate-pulse rounded-full bg-white" aria-hidden="true" /> Live
          </span>
          <h1 className="mt-6 text-5xl font-black tracking-tight text-white">{activity?.title || event?.title}</h1>
          <p className="mt-3 text-xl text-zinc-400">
            {activity ? activity.type.replace(/_/g, " ") : "Activities appear here as the organizer starts them."}
          </p>
          <QrBlock joinUrl={joinUrl} joinCode={joinCode} />
        </Center>
      );
    }

    /* ── PRE-LIVE / WAITING (spec §5, §8) ── */
    return (
      <Center>
        <Radio className="h-14 w-14 text-emerald-400" aria-hidden="true" />
        <p className="mt-5 text-sm font-bold uppercase tracking-[0.35em] text-zinc-500">Starting soon</p>
        <h1 className="mt-4 text-6xl font-black tracking-tight text-white">{event?.title}</h1>
        <QrBlock joinUrl={joinUrl} joinCode={joinCode} />
        <p className="mt-4 text-xl text-zinc-500">
          {state?.counts?.connected ? `${state.counts.connected} in the room` : "Join and get ready — the event starts here."}
        </p>
      </Center>
    );
  }, [liveState, state, activity, question, event, joinUrl, joinCode, offset, revealQ]);

  if (loading) {
    return <div className="p-10"><Skeleton className="h-24" /></div>;
  }
  if (!event) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <EmptyState icon={Radio} title="Event not found" description="This display room doesn't exist." />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-white">
      {/* Announcement banner (§47) — big, temporary */}
      {announcement ? (
        <div className="flex items-center justify-center gap-3 bg-emerald-600 px-6 py-3 text-center" role="status">
          <Megaphone className="h-6 w-6 shrink-0" aria-hidden="true" />
          <p className="text-xl font-bold">{announcement.text}</p>
        </div>
      ) : null}

      <main className="flex flex-1 flex-col overflow-hidden">{view}</main>

      {/* Minimal status strip — no controls, no private info */}
      <footer className="flex items-center justify-between border-t border-zinc-800 px-5 py-2 text-xs font-bold uppercase tracking-widest text-zinc-600">
        <span className="truncate">{event?.title} · EventHub Live</span>
        <span className="flex items-center gap-2">
          {status === "connected" ? (
            <>
              <Wifi className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              <span className="text-zinc-500">{state?.counts?.connected ?? 0} in room</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 animate-pulse text-amber-400" aria-hidden="true" />
              <span className="text-amber-400">Reconnecting…</span>
            </>
          )}
        </span>
      </footer>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">{children}</div>;
}

/** QR + join code — shown before and during the event (per §46). */
function QrBlock({ joinUrl, joinCode }: { joinUrl: string; joinCode: string }) {
  if (!joinUrl) return null;
  return (
    <div className="mt-8 flex flex-col items-center">
      <div className="rounded-3xl border-4 border-zinc-800 bg-white p-4">
        <QRCodeSVG value={joinUrl} size={180} level="M" />
      </div>
      {joinCode ? <p className="mt-4 font-mono text-4xl font-black tracking-[0.35em] text-white">{joinCode}</p> : null}
      <p className="mt-2 text-lg text-zinc-500">Scan or enter the code to join</p>
    </div>
  );
}
