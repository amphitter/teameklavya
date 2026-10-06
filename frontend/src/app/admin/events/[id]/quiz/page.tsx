"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronLeft,
  ExternalLink,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageLoader, ErrorState, EmptyState, Skeleton } from "@/components/states";
import { EventTabs } from "@/components/admin/event-tabs";
import { Leaderboard, type LeaderboardEntry } from "@/components/quiz/leaderboard";
import { cn } from "@/lib/utils";

interface QuizListItem {
  _id: string;
  title: string;
  description: string;
  status: "draft" | "live" | "ended";
  questionCount: number;
  participantCount: number;
  startedAt?: string | null;
  endedAt?: string | null;
}

interface BuilderQuestion {
  text: string;
  options: string[];
  correctIndex: number;
  points: number;
}

const emptyQuestion = (): BuilderQuestion => ({ text: "", options: ["", "", "", ""], correctIndex: 0, points: 10 });

/** Organizer quiz console — build, go live, end, and watch the leaderboard. */
export default function AdminQuizPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // builder
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<BuilderQuestion[]>([emptyQuestion()]);
  const [saving, setSaving] = useState(false);

  // leaderboard dialog
  const [boardQuiz, setBoardQuiz] = useState<QuizListItem | null>(null);
  const [board, setBoard] = useState<{ entries: LeaderboardEntry[]; total: number } | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/events/${id}`).catch(() => null),
      api.get(`/quizzes/event/${id}`).catch(() => null),
    ]).then(([evRes, qRes]) => {
      if (evRes?.data?.event) setEvent(evRes.data.event);
      else setError(evRes?.data?.message || "Event not found");
      setQuizzes(qRes?.data?.quizzes || []);
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  /* ── builder ── */
  const openCreate = () => {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setQuestions([emptyQuestion()]);
    setBuilderOpen(true);
  };

  const openEdit = async (quizId: string) => {
    try {
      const res = await api.get(`/quizzes/${quizId}`);
      if (!res.data?.success) throw new Error();
      const q = res.data.quiz;
      setEditingId(quizId);
      setTitle(q.title);
      setDescription(q.description || "");
      setQuestions(
        q.questions.map((x: any) => ({
          text: x.text,
          options: [...x.options, "", ""].slice(0, Math.max(4, x.options.length)),
          correctIndex: x.correctIndex,
          points: x.points,
        }))
      );
      setBuilderOpen(true);
    } catch {
      toast.error("Couldn't load quiz for editing");
    }
  };

  const setQuestion = (i: number, patch: Partial<BuilderQuestion>) =>
    setQuestions((p) => p.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  const saveQuiz = async () => {
    if (!title.trim()) return toast.error("Give the quiz a title");
    for (const [i, q] of questions.entries()) {
      if (!q.text.trim()) return toast.error(`Question ${i + 1} is empty`);
      const opts = q.options.map((o) => o.trim());
      if (opts.filter(Boolean).length < 2) return toast.error(`Question ${i + 1} needs at least 2 options`);
      if (opts[q.correctIndex] === undefined || opts[q.correctIndex] === "") return toast.error(`Pick the correct answer for question ${i + 1}`);
    }
    setSaving(true);
    try {
      const payload = {
        eventId: id,
        title: title.trim(),
        description: description.trim(),
        questions: questions.map((q) => ({
          text: q.text.trim(),
          options: q.options.map((o) => o.trim()).filter(Boolean),
          correctIndex: q.correctIndex,
          points: q.points,
        })),
      };
      const res = editingId
        ? await api.put(`/quizzes/${editingId}`, payload)
        : await api.post("/quizzes", payload);
      if (res.data?.success) {
        toast.success(editingId ? "Quiz updated" : "Quiz created — publish it when you're ready");
        setBuilderOpen(false);
        load();
      } else throw new Error(res.data?.message);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Couldn't save quiz");
    } finally {
      setSaving(false);
    }
  };

  /* ── lifecycle ── */
  const publish = async (quizId: string) => {
    setBusyId(quizId);
    try {
      const res = await api.post(`/quizzes/${quizId}/publish`);
      if (res.data?.success) {
        toast.success("Quiz is LIVE — share the link with participants");
        load();
      } else throw new Error();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't publish");
    } finally {
      setBusyId(null);
    }
  };

  const end = async (quizId: string) => {
    if (!window.confirm("End this quiz? The leaderboard freezes and no more answers are accepted.")) return;
    setBusyId(quizId);
    try {
      const res = await api.post(`/quizzes/${quizId}/end`);
      if (res.data?.success) {
        toast.success("Quiz ended — final leaderboard is ready");
        load();
      } else throw new Error();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't end quiz");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (quizId: string) => {
    if (!window.confirm("Delete this quiz and all its scores?")) return;
    setBusyId(quizId);
    try {
      const res = await api.delete(`/quizzes/${quizId}`);
      if (res.data?.success) {
        toast.success("Quiz deleted");
        load();
      } else throw new Error();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't delete");
    } finally {
      setBusyId(null);
    }
  };

  const openBoard = async (quiz: QuizListItem) => {
    setBoardQuiz(quiz);
    setBoard(null);
    setBoardLoading(true);
    try {
      const res = await api.get(`/quizzes/${quiz._id}/leaderboard`);
      if (res.data?.success) setBoard({ entries: res.data.entries || [], total: res.data.total || 0 });
    } catch {
      toast.error("Couldn't load leaderboard");
    } finally {
      setBoardLoading(false);
    }
  };

  if (loading) return <PageLoader label="Loading quizzes…" />;
  if (error)
    return (
      <div className="space-y-4">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> All events
        </Link>
        <ErrorState title="Couldn't load" description={error} onRetry={load} />
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> All events
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Live quizzes</h1>
            <p className="text-sm text-muted-foreground">{event?.title}</p>
          </div>
          <Button onClick={openCreate} className="gap-1.5 font-semibold">
            <Plus className="h-4 w-4" /> New quiz
          </Button>
        </div>
      </div>

      <EventTabs active="quiz" />

      {quizzes.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No quizzes yet"
          description="Build a quiz for this event — publish it live while you're on stage and watch the leaderboard fill up."
          actionLabel="Create your first quiz"
          onAction={openCreate}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {quizzes.map((q) => (
            <div key={q._id} className={cn("rounded-xl border bg-card p-4", q.status === "live" ? "border-destructive/40" : "border-border")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold text-foreground">{q.title}</span>
                    {q.status === "live" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">
                        <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-white" /> LIVE
                      </span>
                    ) : q.status === "draft" ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">DRAFT</span>
                    ) : (
                      <span className="rounded-full bg-success-light px-2 py-0.5 text-[10px] font-bold text-success">ENDED</span>
                    )}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ListChecks className="h-3.5 w-3.5" /> {q.questionCount} questions
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {q.participantCount} played
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {q.status === "draft" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openEdit(q._id)} className="gap-1.5">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" onClick={() => publish(q._id)} disabled={busyId === q._id} className="gap-1.5 font-semibold">
                      {busyId === q._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Go live
                    </Button>
                  </>
                )}
                {q.status === "live" && (
                  <>
                    <Link href={`/quiz/${q._id}`} target="_blank">
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <ExternalLink className="h-3.5 w-3.5" /> Open live page
                      </Button>
                    </Link>
                    <Button size="sm" variant="destructive" onClick={() => end(q._id)} disabled={busyId === q._id} className="gap-1.5">
                      {busyId === q._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} End quiz
                    </Button>
                  </>
                )}
                {q.status !== "draft" && (
                  <Button size="sm" variant="outline" onClick={() => openBoard(q)} className="gap-1.5">
                    <Trophy className="h-3.5 w-3.5 text-warning" /> Leaderboard
                  </Button>
                )}
                {q.status !== "live" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(q._id)}
                    disabled={busyId === q._id}
                    className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Builder dialog ── */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit quiz (draft)" : "New live quiz"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Quiz title *</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tech Trivia — Round 1" />
              </div>
              <div className="space-y-1.5">
                <Label>Short description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            {questions.map((q, i) => (
              <div key={i} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Question {i + 1}</span>
                  {questions.length > 1 && (
                    <button type="button" onClick={() => setQuestions((p) => p.filter((_, j) => j !== i))} className="text-destructive hover:opacity-80" aria-label="Remove question">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="mt-2.5 space-y-1.5">
                  <Input
                    value={q.text}
                    onChange={(e) => setQuestion(i, { text: e.target.value })}
                    placeholder="The question…"
                  />
                </div>

                <div className="mt-3 space-y-2">
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setQuestion(i, { correctIndex: oi })}
                        title="Mark as the correct answer"
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-colors",
                          q.correctIndex === oi
                            ? "border-success bg-success text-white"
                            : "border-border text-muted-foreground hover:border-success/50"
                        )}
                      >
                        {String.fromCharCode(65 + oi)}
                      </button>
                      <Input
                        value={opt}
                        onChange={(e) =>
                          setQuestion(i, { options: q.options.map((o, j) => (j === oi ? e.target.value : o)) })
                        }
                        placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                        className="h-9"
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs font-semibold text-muted-foreground">Points</span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={q.points}
                    onChange={(e) => setQuestion(i, { points: Number(e.target.value) || 10 })}
                    className="h-8 w-20"
                  />
                  <p className="text-[11px] text-muted-foreground">Green circle = correct answer</p>
                </div>
              </div>
            ))}

            <Button type="button" variant="outline" className="w-full gap-1.5" onClick={() => setQuestions((p) => [...p, emptyQuestion()])}>
              <Plus className="h-4 w-4" /> Add question
            </Button>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" onClick={() => setBuilderOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveQuiz} disabled={saving} className="font-semibold">
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : editingId ? (
                  "Save changes"
                ) : (
                  "Create quiz"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Leaderboard dialog ── */}
      <Dialog open={Boolean(boardQuiz)} onOpenChange={(o) => !o && setBoardQuiz(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-warning" /> {boardQuiz?.title} — leaderboard
            </DialogTitle>
          </DialogHeader>
          {boardLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : board ? (
            <Leaderboard entries={board.entries} total={board.total} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No scores yet.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
