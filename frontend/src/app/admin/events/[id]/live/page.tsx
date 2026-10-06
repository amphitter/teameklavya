"use client";

/**
 * ORGANIZER LIVE COMMAND CENTER (Part 4, Phase 3 — spec §44).
 * TOP: event, LIVE badge, participant count, End Event.
 * LEFT: activity sequence (start any, current highlighted).
 * CENTER: current activity + controls context.
 * RIGHT: participants (+ chat arrives Phase 6).
 * BOTTOM: Previous · Pause · Next · Leaderboard (Phase 5) · End Activity.
 * Every command is authorized server-side (§92) — this UI only sends.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  EyeOff,
  Loader2,
  Megaphone,
  MessageSquare,
  Monitor,
  Pause,
  Play,
  Search,
  Square,
  Users,
  VolumeOff,
  Volume2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api } from "@/utils/api";
import { EventTabs } from "@/components/admin/event-tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useLiveEvent } from "@/components/live/use-live-event";
import { QuestionTimer } from "@/components/live/timer";
import { LiveLeaderboard } from "@/components/live/leaderboard";
import { QAPanel } from "@/components/live/qa-panel";
import { ChatPanel } from "@/components/live/chat-panel";
import type { LiveCounts } from "@/lib/live-protocol";
import { cn } from "@/lib/utils";

const TYPE_TINT: Record<string, string> = {
  WELCOME: "bg-brand-light text-primary",
  QUIZ: "bg-purple-light text-purple",
  POLL: "bg-cyan/10 text-cyan",
  QA: "bg-warning-light text-warning",
  LEADERBOARD: "bg-success-light text-success",
  CUSTOM: "bg-muted text-muted-foreground",
};

export default function OrganizerLivePage() {
  const { id } = useParams<{ id: string }>();
  const {
    status, state, offset, answeredCount,
    join, startEvent, pauseEvent, resumeEvent, endEvent,
    startActivity, pauseActivity, resumeActivity, endActivity, nextActivity, prevActivity,
    nextQuestion, prevQuestion, closeQuestion,
    showLeaderboard, hideLeaderboard,
    featureQA, answerQA, hideQA, closeQA,
    sendChat, deleteChatMessage, pinChatMessage, muteChatUser,
    sendAnnouncement,
  } = useLiveEvent();

  const [event, setEvent] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [boardSearch, setBoardSearch] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [results, setResults] = useState<any>(null);
  const [joinedRoom, setJoinedRoom] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/events/${id}`)
      .then((r) => setEvent(r.data?.event || null))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    api
      .get(`/events/${id}/activities`)
      .then((r) => setActivities(r.data?.activities || []))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /* Reload the activity list whenever one starts/ends (states changed) */
  useEffect(() => {
    if (state?.activity !== undefined) {
      api
        .get(`/events/${id}/activities`)
        .then((r) => setActivities(r.data?.activities || []))
        .catch(() => {});
    }
  }, [state?.activity?.id, state?.activity?.state, id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Phase 8 (§59, §64–66): load the immutable snapshot when completed.
     (liveState is derived below — inline it here to avoid TDZ on the const) */
  const completedNow = state?.event?.liveState === "COMPLETED" || event?.liveState === "COMPLETED";
  useEffect(() => {
    if (!event?._id || !completedNow) return;
    api
      .get(`/events/${event._id}/results`)
      .then((r) => setResults(r.data?.success ? r.data : null))
      .catch(() => setResults(null));
  }, [event?._id, completedNow]);

  useEffect(() => {
    if (!event?._id || joinedRoom) return;
    join(event._id).then((ack) => {
      if (!ack.ok && ack.code !== "NOT_JOINABLE") {
        toast.error(ack.message || "Couldn't open the live console");
      }
    });
    setJoinedRoom(true);
  }, [event?._id, joinedRoom, join]);

  const liveState = state?.event?.liveState || event?.liveState || "PUBLISHED";
  const counts: LiveCounts = state?.counts || {};
  const participants = state?.participants || [];
  const current = state?.activity || null;
  const question = state?.question || null; // organizer snapshot: carries correctAnswer
  const qa = state?.qa || null;
  const chat = state?.chat || null;
  const board = state?.leaderboard || null;
  const boardVisible = Boolean(state?.leaderboardVisible);
  const boardMode = state?.leaderboardMode || "after_activity";
  const boardToggleable = boardMode !== "never" && boardMode !== "final";
  const joinCode = state?.event?.joinCode || event?.joinCode || "";
  const slug = event?.slug || state?.event?.slug || "";
  const joinUrl = typeof window !== "undefined" && slug ? `${window.location.origin}/events/${slug}/live` : "";
  const isLive = liveState === "LIVE";
  const isEventPaused = liveState === "PAUSED";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter(
      (p: any) =>
        String(p.displayName || "").toLowerCase().includes(q) ||
        String(p.username || "").toLowerCase().includes(q)
    );
  }, [participants, search]);

  const filteredBoard = useMemo(() => {
    const q = boardSearch.trim().toLowerCase();
    if (!board || !q) return board || [];
    return board.filter(
      (e: any) =>
        String(e.displayName || "").toLowerCase().includes(q) ||
        String(e.username || "").toLowerCase().includes(q) ||
        String(e.team || "").toLowerCase().includes(q)
    );
  }, [board, boardSearch]);

  /* ── command wrappers (confirmations where spec requires) ── */
  const run = async (key: string, fn: () => Promise<any>, successMsg?: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const ack = await fn();
      if (ack && ack.ok === false) toast.error(ack.message || "Command failed");
      else if (successMsg) toast.success(successMsg);
    } catch {
      toast.error("Command failed");
    } finally {
      setBusy("");
    }
  };

  /* Export CSV from the real snapshot — client-side blob, no server render */
  const exportCsv = (name: string, rows: (string | number)[][]) => {
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event?.title || "event"}-${name}.csv`.replace(/[^\w.-]+/g, "_");
    a.click();
    URL.revokeObjectURL(url);
  };

  const doStartEvent = () => {
    if (!window.confirm("Start the live event? Participants move from the waiting room to the live stage.")) return;
    run("start-event", () => startEvent(event._id), "Event is LIVE");
  };
  const doEndEvent = () => {
    if (!window.confirm("END EVENT? This stops all activities, finalizes scores and completes the event. This cannot be undone.")) return;
    run("end-event", () => endEvent(event._id), "Event completed — results finalized");
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <EventTabs active="live" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !event) {
    return (
      <div className="space-y-4">
        <EventTabs active="live" />
        <ErrorState title="Couldn't load event" onRetry={load} />
      </div>
    );
  }

  /* ── COMPLETED: final results + analytics from the immutable snapshot
         (Phase 8 — §59, §64–66). Real data only, straight from EventResult. ── */
  if (liveState === "COMPLETED") {
    const summary = results?.summary || {};
    const board = results?.leaderboard || state?.finalLeaderboard || [];
    const acts = results?.activities || [];
    const questions = results?.questions || [];
    return (
      <div className="space-y-5">
        <EventTabs active="live" />
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Event completed — final results</p>
              <h1 className="mt-1 text-xl font-extrabold tracking-tight text-foreground">{event.title}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary.totalParticipants ?? board.length} participants · {summary.totalAnswers ?? 0} answers ·
                correct rate {summary.correctRate ?? 0}% · snapshot finalized
                {results?.finalizedAt ? ` ${new Date(results.finalizedAt).toLocaleString()}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!board.length}
                onClick={() =>
                  exportCsv("leaderboard", [
                    ["Rank", "Participant", "Username", "Team", "Score", "Answered", "Correct", "Accuracy %"],
                    ...board.map((e: any) => [e.rank, e.displayName, e.username || "", e.team || "", e.score, e.answered ?? "", e.correctAnswers ?? "", e.accuracy ?? ""]),
                  ])
                }
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> Leaderboard CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!questions.length}
                onClick={() =>
                  exportCsv("questions", [
                    ["Activity", "Type", "Question", "Answers", "Correct", "Correct %", "Avg response (s)", "Distribution"],
                    ...questions.map((q: any) => [
                      acts.find((a: any) => String(a.activityId) === String(q.activityId))?.title || "",
                      q.type,
                      q.text,
                      q.totalAnswers,
                      q.correctCount,
                      q.correctPct ?? "",
                      q.avgResponseMs ? (q.avgResponseMs / 1000).toFixed(1) : "",
                      q.distribution ? q.distribution.join(" / ") : "",
                    ]),
                  ])
                }
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> Questions CSV
              </Button>
            </div>
          </div>

          {/* Summary cards (§59) */}
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Participants", value: summary.totalParticipants ?? "—" },
              { label: "Engagement", value: summary.engagementRate != null ? `${summary.engagementRate}%` : "—" },
              { label: "Avg score", value: summary.averageScore ?? "—" },
              { label: "Top score", value: summary.topScore ?? "—" },
              { label: "Answers", value: summary.totalAnswers ?? "—" },
              { label: "Correct rate", value: summary.correctRate != null ? `${summary.correctRate}%` : "—" },
            ].map((c) => (
              <div key={c.label} className="rounded-xl bg-muted/60 p-3 text-center">
                <p className="text-xl font-extrabold tabular-nums text-foreground">{c.value}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Podium + full board (snapshot rows carry accuracy stats — map
              them onto the live-board field names so the stats column shows) */}
          {board.length > 0 ? (
            <div className="mt-6">
              <LiveLeaderboard
                entries={board.map((e: any) => ({
                  ...e,
                  correctCount: e.correctCount ?? e.correctAnswers,
                  answeredCount: e.answeredCount ?? e.answered,
                }))}
                variant="organizer"
              />
            </div>
          ) : (
            <p className="mt-6 text-center text-sm text-muted-foreground">No participant scores.</p>
          )}
        </div>

        {/* Activity analytics (§65) */}
        {acts.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Activity analytics</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Activity</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 text-right">Questions</th>
                    <th className="py-2 pr-3 text-right">Participants</th>
                    <th className="py-2 pr-3 text-right">Completion</th>
                    <th className="py-2 text-right">Avg score</th>
                  </tr>
                </thead>
                <tbody>
                  {acts.map((a: any) => (
                    <tr key={a.activityId} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-bold text-foreground">{a.title}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{a.type}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.questions}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.participants}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.completion}%</td>
                      <td className="py-2 text-right tabular-nums">{a.averageScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Question analytics (§65): distribution, correct %, response time */}
        {questions.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Question analytics</p>
            <ul className="mt-3 space-y-3">
              {questions.map((q: any) => (
                <li key={q.questionId} className="rounded-xl border border-border bg-background p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 text-sm font-bold text-foreground">
                      <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-muted-foreground">{q.type.replace(/_/g, " ")}</span>
                      {q.text}
                    </p>
                    <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {q.totalAnswers} answers
                      {q.correctPct != null ? ` · ${q.correctPct}% correct` : ""}
                      {q.avgResponseMs ? ` · ${(q.avgResponseMs / 1000).toFixed(1)}s avg` : ""}
                    </p>
                  </div>
                  {q.distribution ? (
                    <div className="mt-2 space-y-1">
                      {q.distribution.map((count: number, i: number) => {
                        const pct = q.totalAnswers ? Math.round((count / q.totalAnswers) * 100) : 0;
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <span className="w-5 shrink-0 text-[10px] font-extrabold text-muted-foreground">{String.fromCharCode(65 + i)}</span>
                            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                              <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="w-14 shrink-0 text-right text-[10px] font-bold tabular-nums text-muted-foreground">{pct}% · {count}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted-foreground">Subjective — answers pending review.</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!results && (
          <p className="text-center text-xs text-muted-foreground">Loading the results snapshot…</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EventTabs active="live" />

      {status !== "connected" && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-xs font-semibold text-warning">
          <WifiOff className="h-4 w-4 animate-pulse" /> Reconnecting… commands will resume automatically.
        </div>
      )}

      {/* ── TOP BAR (spec §44) ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Command center</p>
          <h1 className="truncate text-lg font-extrabold tracking-tight text-foreground sm:text-xl">{event.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                isLive ? "bg-[#ba1a1a] text-white" : isEventPaused ? "bg-warning-light text-warning" : "bg-muted text-muted-foreground"
              )}
            >
              {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
              {liveState.toLowerCase().replace("_", " ")}
            </span>
            <span className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> {counts.connected ?? 0} connected
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            asChild
            className="gap-1.5"
            title="Open the big-screen projector view (read-only, no secrets)"
          >
            <a href={`/events/${slug}/live/display`} target="_blank" rel="noopener noreferrer">
              <Monitor className="h-4 w-4" /> Display
            </a>
          </Button>
          {!isLive && !isEventPaused && (
            <Button size="lg" onClick={doStartEvent} disabled={busy === "start-event"} className="h-12 gap-2 px-8 text-base">
              {busy === "start-event" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
              Start Event
            </Button>
          )}
          {isEventPaused && (
            <Button size="lg" variant="outline" onClick={() => run("resume-event", () => resumeEvent(event._id), "Event resumed")} className="h-12 gap-2 px-6">
              <Play className="h-5 w-5" /> Resume Event
            </Button>
          )}
          {isLive && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => run("pause-event", () => pauseEvent(event._id), "Event paused")}
                className="gap-1.5"
              >
                <Pause className="h-4 w-4" /> Pause
              </Button>
              <Button size="sm" variant="outline" onClick={doEndEvent} disabled={busy === "end-event"} className="gap-1.5 border-[#ba1a1a]/40 text-[#ba1a1a] hover:bg-[#ba1a1a]/10">
                {busy === "end-event" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                End Event
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr_280px]">
        {/* ── LEFT: activity sequence (spec §44) ── */}
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="px-1 pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Activities</p>
          {activities.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              No activities — build the sequence in the Activities tab.
            </p>
          ) : (
            <ul className="space-y-1">
              {activities.map((a: any, i: number) => {
                const isCurrent = current && String(current.id) === String(a._id);
                return (
                  <li key={a._id}>
                    <button
                      type="button"
                      disabled={!isLive || busy === "act-" + a._id || a.state === "COMPLETED"}
                      onClick={() => run("act-" + a._id, () => startActivity(a._id, event._id), `Started: ${a.title}`)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                        isCurrent ? "bg-brand-light" : "hover:bg-muted",
                        (!isLive || a.state === "COMPLETED") && "opacity-60"
                      )}
                      title={a.state === "COMPLETED" ? "Completed — cannot restart (data integrity)" : isLive ? "Start this activity" : "Start the event first"}
                    >
                      <span className="text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase", TYPE_TINT[a.type] || TYPE_TINT.CUSTOM)}>
                        {a.type}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-foreground">{a.title}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {isCurrent ? current.state.toLowerCase() : a.state.toLowerCase()}
                        </span>
                      </span>
                      {busy === "act-" + a._id ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : (
                        !isCurrent && a.state !== "COMPLETED" && <Play className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!isLive && joinUrl && (
            <div className="mt-3 rounded-xl border border-border bg-background p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Scan to join</p>
              <div className="mx-auto mt-2 w-fit rounded-xl border border-border p-2">
                <QRCodeSVG value={joinUrl} size={120} level="M" />
              </div>
              <p className="mt-2 font-mono text-sm font-extrabold tracking-[0.3em] text-foreground">{joinCode}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {counts.registered ?? "—"} registered · {counts.checkedIn ?? "—"} checked in
              </p>
            </div>
          )}
        </div>

        {/* ── CENTER: current activity (spec §44) ── */}
        <div className="flex flex-col gap-4">
          <div className="min-h-[240px] rounded-2xl border border-border bg-card p-5">
            {current ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", TYPE_TINT[current.type] || TYPE_TINT.CUSTOM)}>
                    {current.type}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                      current.state === "LIVE" ? "bg-[#ba1a1a] text-white" : "bg-warning-light text-warning"
                    )}
                  >
                    {current.state}
                  </span>
                </div>
                <h2 className="mt-2 text-xl font-extrabold tracking-tight text-foreground">{current.title}</h2>

                {/* ── QUIZ/POLL question panel (Phase 4 — §16–30) ── */}
                {question && (current.type === "QUIZ" || current.type === "POLL") ? (
                  <div className="mt-4 rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-muted-foreground">
                        {question.closed
                          ? "Question closed — answer revealed"
                          : typeof question.index === "number" && typeof question.total === "number"
                            ? `Question ${question.index + 1} of ${question.total}`
                            : "Question open"}
                        {typeof question.points === "number" ? ` · ${question.points} pts` : ""}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-bold text-primary tabular-nums">
                          <Users className="mr-1 inline h-3 w-3" />
                          {answeredCount ?? question.answeredCount ?? 0} answered
                        </span>
                        <QuestionTimer
                          startedAt={current.state === "PAUSED" || isEventPaused ? null : question.startedAt}
                          durationSec={question.durationSec}
                          elapsedBeforePause={question.elapsedBeforePause}
                          remainingMs={question.remainingMs}
                          offset={offset}
                          size="sm"
                        />
                      </div>
                    </div>

                    <p className="mt-3 text-sm font-extrabold leading-snug text-foreground">{question.text}</p>
                    {question.media?.url ? (
                      <img src={question.media.url} alt={question.media.alt || "Question media"} className="mt-2 max-h-40 w-full rounded-lg border border-border object-contain" />
                    ) : null}

                    <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                      {(question.options || []).map((opt: string, idx: number) => {
                        // Organizer sees the key live (it's their own event)
                        const key = question.correctAnswer;
                        const isCorrect = Array.isArray(key) ? key.includes(idx) : Number(key) === idx;
                        return (
                          <li
                            key={idx}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold",
                              isCorrect ? "border-[#006C4C] bg-success-light text-[#006C4C]" : "border-border bg-card text-foreground"
                            )}
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] font-extrabold text-muted-foreground">
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {opt}
                              {current.type === "POLL" && question.results?.counts?.[idx] !== undefined ? (
                                <span className="ml-1.5 font-bold tabular-nums text-primary">
                                  {question.results.total ? Math.round((question.results.counts[idx] / question.results.total) * 100) : 0}%
                                </span>
                              ) : null}
                            </span>
                            {isCorrect ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-label="Correct answer" /> : null}
                          </li>
                        );
                      })}
                    </ul>
                    {question.explanation ? (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{question.explanation}</p>
                    ) : null}
                    {question.type === "SHORT_ANSWER" || question.type === "LONG_ANSWER" ? (
                      <p className="mt-2 text-xs text-muted-foreground">Subjective — answers go to review, not auto-scored.</p>
                    ) : null}

                    {/* Question controls (§97) */}
                    {current.state === "LIVE" ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === "q-prev" || !question.index}
                          onClick={() => run("q-prev", () => prevQuestion(current.id))}
                          className="gap-1.5"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" /> Prev Q
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === "q-close" || question.closed}
                          onClick={() => run("q-close", () => closeQuestion(current.id), "Question closed — answer revealed")}
                          className="gap-1.5"
                        >
                          <Square className="h-3.5 w-3.5" /> Close Q (reveal)
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy === "q-next"}
                          onClick={async () => {
                            if (busy) return;
                            setBusy("q-next");
                            try {
                              const ack = await nextQuestion(current.id);
                              if (ack && ack.ok === false) toast.error(ack.message || "Command failed");
                              else if (ack?.noMore) toast.info("That was the last question — End Activity when ready.");
                            } catch {
                              toast.error("Command failed");
                            } finally {
                              setBusy("");
                            }
                          }}
                          className="gap-1.5"
                        >
                          {busy === "q-next" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Next Q <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">Resume the activity to control questions.</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {current.type === "QUIZ"
                      ? "Quiz running — the first question opens with the activity; use Next Q to advance."
                      : current.type === "POLL"
                        ? "Poll running — live percentages arrive in Phase 6."
                        : current.type === "QA"
                          ? "Q&A running — question queue arrives in Phase 6."
                          : current.type === "LEADERBOARD"
                            ? "Leaderboard checkpoint — the live board is on participant screens."
                            : "Activity running."}
                  </p>
                )}
                {/* ── Organizer leaderboard view (Phase 5 — §31–38, §69) ──
                    Shown while a LEADERBOARD checkpoint runs or whenever the
                    board is on participant screens. Search + per-participant
                    correct count + avg response time (organizer-only data). */}
                {(current.type === "LEADERBOARD" || boardVisible) && board ? (
                  <div className="mt-4 rounded-xl border border-border bg-background p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        <BarChart3 className="h-3.5 w-3.5" /> Leaderboard
                        <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase", boardVisible ? "bg-[#006C4C] text-white" : "bg-muted text-muted-foreground")}>
                          {boardVisible ? "On participant screens" : "Hidden"}
                        </span>
                      </p>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={boardSearch}
                          onChange={(e) => setBoardSearch(e.target.value)}
                          placeholder="Search board…"
                          className="h-8 w-44 rounded-lg border border-input bg-background pl-7 pr-2 text-xs outline-none focus:border-primary/50"
                          aria-label="Search leaderboard"
                        />
                      </div>
                    </div>
                    <LiveLeaderboard entries={filteredBoard} variant="organizer" />
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Mode: {boardMode.replace(/_/g, " ")} · correct answers + avg response time are organizer-only.
                    </p>
                  </div>
                ) : null}
                {/* ── Q&A moderation (Phase 6 — §40): feature / answer / hide / close ── */}
                {current.type === "QA" && qa ? (
                  <div className="mt-4 rounded-xl border border-border bg-background p-4">
                    <QAPanel
                      qa={qa}
                      activityId={current.id}
                      variant="organizer"
                      onFeature={(qid) => run("qa-feature", () => featureQA(qid))}
                      onAnswer={(qid, text) => run("qa-answer", () => answerQA(qid, text), "Answer posted")}
                      onHide={(qid) => run("qa-hide", () => hideQA(qid), "Question hidden")}
                      onClose={(aid) => run("qa-close", () => closeQA(aid))}
                      busy={busy}
                    />
                  </div>
                ) : null}
                <p className="mt-6 text-xs text-muted-foreground">
                  {counts.connected ?? 0} connected participants receive this activity in realtime.
                </p>
              </>
            ) : (
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center">
                <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {isLive ? "No activity running" : "Event not live yet"}
                </p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  {isLive
                    ? "Start an activity from the list on the left — participants get it instantly."
                    : "Press Start Event, then pick the first activity."}
                </p>
              </div>
            )}
          </div>

          {/* ── BOTTOM: control bar (spec §44) ── */}
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-card p-3">
            <Button
              size="sm"
              variant="outline"
              disabled={!current}
              onClick={() => current && run("prev", () => prevActivity(current.id, event._id))}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            {current?.state === "LIVE" ? (
              <Button size="sm" variant="outline" onClick={() => run("pause-act", () => pauseActivity(current.id, event._id), "Activity paused")} className="gap-1.5">
                <Pause className="h-4 w-4" /> Pause
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={!current || current.state !== "PAUSED"}
                onClick={() => current && run("resume-act", () => resumeActivity(current.id, event._id), "Activity resumed")}
                className="gap-1.5"
              >
                <Play className="h-4 w-4" /> Resume
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!current}
              onClick={() => current && run("next", () => nextActivity(current.id, event._id))}
              className="gap-1.5"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
            {boardVisible ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => run("board-hide", () => hideLeaderboard(event._id), "Leaderboard hidden")}
                className="gap-1.5"
              >
                <EyeOff className="h-4 w-4" /> Hide Leaderboard
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={!boardToggleable || !isLive || busy === "board-show"}
                onClick={() => run("board-show", () => showLeaderboard(event._id), "Leaderboard is on participant screens")}
                className="gap-1.5"
                title={
                  !boardToggleable
                    ? `Visibility is "${boardMode}" — change it in event live settings`
                    : isLive
                      ? "Put the leaderboard on participant screens"
                      : "Start the event first"
                }
              >
                {busy === "board-show" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                Leaderboard
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!current}
              onClick={() => current && run("end-act", () => endActivity(current.id, event._id), "Activity ended")}
              className="gap-1.5 border-[#ba1a1a]/40 text-[#ba1a1a] hover:bg-[#ba1a1a]/10"
            >
              <Square className="h-4 w-4" /> End activity
            </Button>
          </div>
        </div>

        {/* ── RIGHT: participants (+ chat in Phase 6) ── */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Participants
            </p>
            <p className="text-xs font-bold text-foreground">
              {counts.ready ?? 0}/{counts.total ?? participants.length} ready
            </p>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary/50"
            />
          </div>
          {participants.length === 0 ? (
            <div className="py-6">
              <EmptyState icon={Wifi} title="Nobody yet" description="Share the QR — joins appear here live." />
            </div>
          ) : (
            <ul className="mt-3 max-h-[380px] space-y-1.5 overflow-y-auto">
              {filtered.map((p: any) => (
                <li key={p.userId} className="flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2">
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", p.state === "disconnected" ? "bg-muted-foreground/40" : "bg-[#006C4C]")}
                    title={p.state}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">{p.displayName}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {p.state}
                      {p.ready ? " · ready" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{p.score || 0}</span>
                  {isLive || isEventPaused ? (
                    <button
                      type="button"
                      onClick={() => run("mute-" + p.userId, () => muteChatUser(event._id, p.userId, !p.muted), p.muted ? "Unmuted" : "Muted")}
                      aria-label={p.muted ? `Unmute ${p.displayName}` : `Mute ${p.displayName} in chat`}
                      title={p.muted ? "Unmute in chat" : "Mute in chat"}
                      className={cn("shrink-0 rounded p-1", p.muted ? "bg-[#ba1a1a]/10 text-[#ba1a1a]" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                    >
                      {p.muted ? <VolumeOff className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                  ) : null}
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="py-4 text-center text-xs text-muted-foreground">No match.</li>
              )}
            </ul>
          )}
          {/* ── Announcements (Phase 7 — §47): temporary broadcast banner ── */}
          <div className="mt-3">
            <div className="flex gap-1.5">
              <input
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value.slice(0, 300))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && announcement.trim()) {
                    run("announce", () => sendAnnouncement(event._id, announcement.trim()), "Announcement sent");
                    setAnnouncement("");
                  }
                }}
                placeholder="Broadcast an announcement…"
                aria-label="Broadcast an announcement"
                disabled={!isLive && !isEventPaused}
                className="h-9 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-xs outline-none focus:border-primary/50 disabled:opacity-60"
              />
              <Button
                size="sm"
                className="h-9 gap-1 text-xs"
                disabled={(!isLive && !isEventPaused) || !announcement.trim() || busy === "announce"}
                onClick={() => {
                  run("announce", () => sendAnnouncement(event._id, announcement.trim()), "Announcement sent");
                  setAnnouncement("");
                }}
              >
                <Megaphone className="h-3.5 w-3.5" /> Send
              </Button>
            </div>
            {state?.announcement ? (
              <p className="mt-1.5 rounded-lg bg-brand-light px-2 py-1 text-[10px] font-semibold text-foreground" role="status">
                Live banner: “{state.announcement.text}”
              </p>
            ) : null}
          </div>

          {/* ── Live chat with moderation (Phase 6 — §41) ── */}
          {chat ? (
            <ChatPanel
              chat={chat}
              eventId={event._id}
              variant="organizer"
              onSend={(eid, text) => run("chat-send", () => sendChat(eid, text))}
              onDelete={(mid) => run("chat-del", () => deleteChatMessage(mid), "Message deleted")}
              onPin={(mid) => run("chat-pin", () => pinChatMessage(mid))}
              onMute={(eid, uid, muted) => run("chat-mute", () => muteChatUser(eid, uid, muted), muted ? "Participant muted" : "Participant unmuted")}
              className="mt-3 max-h-72"
            />
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-center">
              <MessageSquare className="mx-auto h-4 w-4 text-muted-foreground/50" />
              <p className="mt-1 text-[10px] text-muted-foreground">Chat connects when the room is live.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
