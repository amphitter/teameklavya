"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, Radio, Target, Trophy, XCircle } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { Leaderboard, type LeaderboardEntry } from "@/components/quiz/leaderboard";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cn } from "@/lib/utils";

interface PublicQuestion {
  text: string;
  options: string[];
  points: number;
}

interface QuizData {
  _id: string;
  title: string;
  description: string;
  status: "draft" | "live" | "ended";
  questionCount: number;
  questions: PublicQuestion[];
  event?: { _id: string; title: string; slug: string } | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

interface MyParticipation {
  score: number;
  answers: { questionIndex: number; optionIndex: number; correct: boolean; points: number }[];
}

/** Live quiz play page — join, answer with instant feedback, see your rank. */
export default function QuizPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSessionUser();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [mine, setMine] = useState<MyParticipation | null>(null);
  const [board, setBoard] = useState<{ entries: LeaderboardEntry[]; me: { rank: number; score: number } | null; total: number } | null>(null);

  // play state
  const [current, setCurrent] = useState(0); // first unanswered question index
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correctIndex: number; points: number; score: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/quizzes/${id}`).catch(() => null),
      api.get(`/quizzes/${id}/leaderboard`).catch(() => null),
    ]).then(([qRes, lbRes]) => {
      if (qRes?.data?.success) {
        setQuiz(qRes.data.quiz);
        setMine(qRes.data.myParticipation || null);
        const answered = new Set((qRes.data.myParticipation?.answers || []).map((a: any) => a.questionIndex));
        const next = (qRes.data.quiz.questions || []).findIndex((_: any, i: number) => !answered.has(i));
        setCurrent(next === -1 ? (qRes.data.quiz.questions || []).length : next);
        setFinished(next === -1 && Boolean(qRes.data.myParticipation));
      } else {
        setError(qRes?.data?.message || "Quiz not found");
      }
      if (lbRes?.data?.success) {
        setBoard({ entries: lbRes.data.entries || [], me: lbRes.data.me, total: lbRes.data.total || 0 });
      }
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  // Live leaderboard refresh while the quiz is live
  useEffect(() => {
    if (quiz?.status !== "live") return;
    const t = setInterval(() => {
      api
        .get(`/quizzes/${id}/leaderboard`)
        .then((r) => r.data?.success && setBoard({ entries: r.data.entries || [], me: r.data.me, total: r.data.total || 0 }))
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(t);
  }, [quiz?.status, id]);

  const submit = async () => {
    if (selected === null || submitting || !quiz) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/quizzes/${id}/answer`, { questionIndex: current, optionIndex: selected });
      if (res.data?.success) {
        setResult({ correct: res.data.correct, correctIndex: res.data.correctIndex, points: res.data.points, score: res.data.score });
      } else {
        toast.error(res.data?.message || "Couldn't submit");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't submit answer");
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    setResult(null);
    setSelected(null);
    if (current + 1 >= quiz!.questions.length) {
      setFinished(true);
      load(); // refresh participation + leaderboard
    } else {
      setCurrent((c) => c + 1);
    }
  };

  if (loading) return <PageLoader label="Loading quiz…" />;
  if (error || !quiz)
    return (
      <div className="mx-auto max-w-2xl px-3 py-8">
        <ErrorState title="Couldn't load quiz" description={error || undefined} onRetry={load} />
      </div>
    );

  const answeredCount = mine?.answers?.length || 0;
  const correctCount = mine?.answers?.filter((a) => a.correct).length || 0;
  const q = quiz.questions[current];

  /* ── Not live yet ── */
  if (quiz.status === "draft") {
    return (
      <div className="mx-auto max-w-2xl px-3 py-10">
        <EmptyState
          icon={Target}
          title="This quiz isn't live yet"
          description="The organizer hasn't started it. Check back when the event begins!"
        />
        {quiz.event?.slug && (
          <div className="mt-4 text-center">
            <Button asChild variant="outline" size="sm">
              <Link href={`/events/${quiz.event.slug}`}>← Back to event</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-3 py-5 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {quiz.event?.slug && (
          <Link href={`/events/${quiz.event.slug}`} className="inline-flex items-center gap-1 font-semibold hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> {quiz.event.title}
          </Link>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{quiz.title}</h1>
        {quiz.status === "live" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 text-[11px] font-bold text-white">
            <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-white" /> LIVE
          </span>
        ) : (
          <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-bold text-muted-foreground">ENDED</span>
        )}
      </div>
      {quiz.description && <p className="mt-1 text-sm text-muted-foreground">{quiz.description}</p>}

      {/* ── Results screen (finished or ended) ── */}
      {(finished || quiz.status === "ended") && (
        <div className="mt-5 space-y-5">
          {mine && (
            <div className="rounded-2xl border border-border bg-gradient-to-br from-brand-light/80 to-purple-light/50 p-5 text-center">
              <Trophy className="mx-auto h-8 w-8 text-purple" />
              <p className="mt-2 text-sm font-semibold text-muted-foreground">
                {quiz.status === "live" ? "You're done — holding your spot" : "Final result"}
              </p>
              <p className="mt-1 text-4xl font-extrabold text-foreground">{mine.score}<span className="text-base font-bold text-muted-foreground"> pts</span></p>
              <p className="mt-1 text-sm text-muted-foreground">
                {correctCount}/{mine.answers.length} correct
                {board?.me?.rank ? ` · Rank #${board.me.rank} of ${board.total}` : ""}
              </p>
            </div>
          )}
          {!mine && quiz.status === "ended" && (
            <EmptyState icon={Target} title="You didn't play this one" description="The quiz has ended — catch the next event!" />
          )}
          {board && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-foreground">
                <Trophy className="h-4 w-4 text-warning" /> Leaderboard
              </h2>
              <Leaderboard entries={board.entries} myUserId={user?._id} total={board.total} />
            </section>
          )}
        </div>
      )}

      {/* ── Play (live, not finished) ── */}
      {quiz.status === "live" && !finished && q && (
        <div className="mt-5">
          {/* progress */}
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>
              Question {current + 1} of {quiz.questions.length}
            </span>
            <span className="inline-flex items-center gap-1">
              <Radio className="h-3.5 w-3.5 animate-live-pulse text-destructive" /> Live now
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#0070f0] to-[#5030f0] transition-all"
              style={{ width: `${(answeredCount / Math.max(1, quiz.questions.length)) * 100}%` }}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold leading-snug text-foreground">{q.text}</h2>
              <span className="shrink-0 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold text-primary">{q.points} pts</span>
            </div>

            <div className="mt-4 grid gap-2.5">
              {q.options.map((opt, i) => {
                const isSelected = selected === i;
                const isCorrect = result && i === result.correctIndex;
                const isWrongPick = result && isSelected && !result.correct;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={Boolean(result) || submitting}
                    onClick={() => setSelected(i)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors",
                      !result && isSelected && "border-primary bg-brand-light text-primary",
                      !result && !isSelected && "border-border text-foreground hover:border-primary/40",
                      result && isCorrect && "border-success bg-success-light text-success",
                      result && isWrongPick && "border-destructive bg-destructive/10 text-destructive",
                      result && !isCorrect && !isWrongPick && "border-border text-muted-foreground opacity-60"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
                        !result && isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1">{opt}</span>
                    {result && isCorrect && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                    {result && isWrongPick && <XCircle className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {!user ? (
              <div className="mt-5 flex flex-col items-center gap-2 border-t border-border pt-4 text-center">
                <p className="text-sm text-muted-foreground">Sign in to play and get on the leaderboard.</p>
                <Button asChild size="sm">
                  <Link href={`/login?returnUrl=%2Fquiz%2F${id}`}>Sign in</Link>
                </Button>
              </div>
            ) : !result ? (
              <Button className="mt-5 w-full font-bold" disabled={selected === null || submitting} onClick={submit}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Locking in…
                  </>
                ) : (
                  "Lock in answer"
                )}
              </Button>
            ) : (
              <div className="mt-5 border-t border-border pt-4">
                <p className={cn("text-sm font-bold", result.correct ? "text-success" : "text-destructive")}>
                  {result.correct ? `Correct! +${result.points} points` : "Not quite — the answer is highlighted"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Score so far: {result.score} pts</p>
                <Button className="mt-3 w-full font-bold" onClick={next}>
                  {current + 1 >= quiz.questions.length ? "See my results" : "Next question →"}
                </Button>
              </div>
            )}
          </div>

          {/* Live mini leaderboard while playing */}
          {board && board.entries.length > 0 && (
            <details className="mt-5 rounded-xl border border-border bg-card p-4">
              <summary className="cursor-pointer text-sm font-bold text-foreground">
                <Trophy className="mr-1.5 inline h-4 w-4 text-warning" />
                Live leaderboard <span className="font-normal text-muted-foreground">({board.total} playing)</span>
              </summary>
              <div className="mt-3">
                <Leaderboard entries={board.entries.slice(0, 10)} myUserId={user?._id} compact />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
