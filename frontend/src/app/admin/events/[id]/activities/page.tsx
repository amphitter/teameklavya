"use client";

/**
 * Activity Builder (Part 4, Phase 1) — the organizer's live-event studio.
 * Left: activity sequence (reorder, add, delete) + live settings card.
 * Right: per-type editor (Quiz questions / Poll / Q&A / Leaderboard / …)
 * with validation report (spec §26) and the AI generation boundary button.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Vote,
} from "lucide-react";
import { api } from "@/utils/api";
import { EventTabs } from "@/components/admin/event-tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { QuestionEditor, type QuestionData } from "@/components/admin/activities/question-editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ActivityData {
  _id: string;
  type: string;
  title: string;
  description: string;
  order: number;
  state: string;
  config: any;
  questionCount?: number;
}

const TYPE_META: Record<string, { label: string; icon: any; tint: string }> = {
  WELCOME: { label: "Welcome", icon: MessageSquarePlus, tint: "bg-brand-light text-primary" },
  QUIZ: { label: "Quiz", icon: ShieldAlert, tint: "bg-purple-light text-purple" },
  POLL: { label: "Poll", icon: Vote, tint: "bg-cyan/10 text-cyan" },
  QA: { label: "Q&A", icon: MessageSquarePlus, tint: "bg-warning-light text-warning" },
  LEADERBOARD: { label: "Leaderboard", icon: BarChart3, tint: "bg-success-light text-success" },
  CUSTOM: { label: "Custom", icon: Sparkles, tint: "bg-muted text-muted-foreground" },
};

export default function ActivitiesPage() {
  const { id } = useParams<{ id: string }>();

  const [activities, setActivities] = useState<ActivityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionData | null | undefined>(undefined); // undefined = closed
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [liveSettings, setLiveSettings] = useState<any>(null);
  const [joinCode, setJoinCode] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    api
      .get(`/events/${id}/activities`)
      .then((r) => {
        const list = r.data?.activities || [];
        setActivities(list);
        setSelectedId((prev) => (prev && list.some((a: ActivityData) => a._id === prev) ? prev : list[0]?._id || null));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
    api
      .get(`/events/${id}/live-settings`)
      .then((r) => {
        if (r.data?.success) {
          setLiveSettings(r.data.liveSettings);
          setJoinCode(r.data.joinCode || "");
        }
      })
      .catch(() => {});
  }, [id, load]);

  const selected = activities.find((a) => a._id === selectedId) || null;

  /* Load questions of the selected activity (organizer view incl. answer key) */
  useEffect(() => {
    if (!selectedId || !selected) return;
    if (!["QUIZ", "POLL"].includes(selected.type)) {
      setQuestions([]);
      return;
    }
    setQuestionsLoading(true);
    api
      .get(`/activities/${selectedId}/questions`)
      .then((r) => setQuestions(r.data?.questions || []))
      .catch(() => setQuestions([]))
      .finally(() => setQuestionsLoading(false));
  }, [selectedId, selected?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── activity actions ── */
  const addActivity = (type: string) => {
    setBusy("add-" + type);
    api
      .post(`/events/${id}/activities`, { type, title: `${TYPE_META[type]?.label || type} activity` })
      .then((r) => {
        if (r.data?.success) {
          toast.success("Activity added");
          load();
          setSelectedId(r.data.activity?._id || null);
        } else toast.error(r.data?.message || "Couldn't add");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Couldn't add"))
      .finally(() => setBusy(""));
  };

  const moveActivity = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= activities.length) return;
    const ids = activities.map((a) => a._id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setActivities((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    api
      .put(`/events/${id}/activities/order`, { activityIds: ids })
      .then(() => load())
      .catch(() => {
        toast.error("Reorder failed");
        load();
      });
  };

  const deleteActivity = (a: ActivityData) => {
    if (!window.confirm(`Delete "${a.title}"${a.questionCount ? ` and its ${a.questionCount} questions` : ""}?`)) return;
    setBusy("del-" + a._id);
    api
      .delete(`/activities/${a._id}`)
      .then((r) => {
        if (r.data?.success) {
          toast.success("Activity deleted");
          load();
        }
      })
      .catch(() => toast.error("Couldn't delete"))
      .finally(() => setBusy(""));
  };

  const saveActivityMeta = (a: ActivityData, patch: Partial<ActivityData>) => {
    api
      .put(`/activities/${a._id}`, patch)
      .then((r) => {
        if (r.data?.success) {
          setActivities((prev) => prev.map((x) => (x._id === a._id ? { ...x, ...patch } : x)));
        }
      })
      .catch(() => toast.error("Couldn't save"));
  };

  const runValidation = () => {
    if (!selectedId) return;
    setBusy("validate");
    setValidation(null);
    api
      .post(`/activities/${selectedId}/validate`)
      .then((r) => {
        if (r.data?.success) {
          setValidation({ valid: Boolean(r.data.valid), errors: r.data.errors || [] });
          if (r.data.valid) toast.success("Activity is valid — ready to go live");
        }
      })
      .catch(() => toast.error("Validation failed"))
      .finally(() => setBusy(""));
  };

  const generateQuiz = () => {
    if (!selectedId) return;
    setBusy("generate");
    api
      .post(`/activities/${selectedId}/generate-quiz`, { topic: "python", difficulty: "medium", questionCount: 10 })
      .catch((e: any) => {
        const msg = e.response?.data?.message || "Generation unavailable";
        toast(e.response?.status === 501 ? `Boundary ready — ${msg}` : msg, {
          description: e.response?.status === 501 ? "The AI provider gets plugged into QuizGeneratorService later." : undefined,
        });
      })
      .finally(() => setBusy(""));
  };

  /* ── question actions ── */
  const moveQuestion = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= questions.length) return;
    const ids = questions.map((q) => q._id!);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    api
      .put(`/activities/${selectedId}/questions/order`, { questionIds: ids })
      .then(() => loadQuestions())
      .catch(() => toast.error("Reorder failed"));
  };

  const loadQuestions = useCallback(() => {
    if (!selectedId) return;
    api
      .get(`/activities/${selectedId}/questions`)
      .then((r) => setQuestions(r.data?.questions || []))
      .catch(() => {});
  }, [selectedId]);

  const duplicateQuestion = (qid: string) => {
    setBusy("dup-" + qid);
    api
      .post(`/questions/${qid}/duplicate`)
      .then((r) => {
        if (r.data?.success) {
          toast.success("Question duplicated");
          loadQuestions();
          load();
        }
      })
      .catch(() => toast.error("Couldn't duplicate"))
      .finally(() => setBusy(""));
  };

  const deleteQuestion = (qid: string) => {
    if (!window.confirm("Delete this question?")) return;
    setBusy("delq-" + qid);
    api
      .delete(`/questions/${qid}`)
      .then((r) => {
        if (r.data?.success) {
          toast.success("Question deleted");
          loadQuestions();
          load();
        }
      })
      .catch(() => toast.error("Couldn't delete"))
      .finally(() => setBusy(""));
  };

  /* ── live settings ── */
  const saveSettings = (patch: any) => {
    api
      .put(`/events/${id}/live-settings`, patch)
      .then((r) => {
        if (r.data?.success) {
          setLiveSettings(r.data.liveSettings);
          toast.success("Live settings saved");
        }
      })
      .catch(() => toast.error("Couldn't save settings"));
  };

  const regenerateCode = () => {
    api
      .post(`/events/${id}/join-code/regenerate`)
      .then((r) => {
        if (r.data?.success) {
          setJoinCode(r.data.joinCode);
          toast.success("New join code generated");
        }
      })
      .catch(() => toast.error("Couldn't regenerate"));
  };

  const Toggle = ({ label, field }: { label: string; field: string }) => (
    <button
      type="button"
      onClick={() => saveSettings({ [field]: !liveSettings?.[field] })}
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors",
        liveSettings?.[field] ? "border-primary/40 bg-brand-light text-foreground" : "border-border text-muted-foreground hover:bg-muted"
      )}
    >
      {label}
      <span
        className={cn(
          "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
          liveSettings?.[field] ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "h-3 w-3 rounded-full bg-white transition-transform",
            liveSettings?.[field] && "translate-x-3"
          )}
        />
      </span>
    </button>
  );

  return (
    <div className="space-y-5">
      <EventTabs active="activities" />

      {loading && activities.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn't load activities" onRetry={load} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          {/* ── LEFT: sequence + settings ── */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-3">
              <p className="px-1 pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Activity sequence
              </p>
              {activities.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                  No activities yet — add the first one below.
                </p>
              ) : (
                <ul className="space-y-1">
                  {activities.map((a, i) => {
                    const meta = TYPE_META[a.type] || TYPE_META.CUSTOM;
                    const Icon = meta.icon;
                    return (
                      <li key={a._id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(a._id);
                            setValidation(null);
                            setEditingQuestion(undefined);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                            a._id === selectedId ? "bg-brand-light" : "hover:bg-muted"
                          )}
                        >
                          <span className="text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                          <span className={cn("rounded-lg p-1.5", meta.tint)}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-foreground">{a.title}</span>
                            <span className="block text-[10px] text-muted-foreground">
                              {meta.label}
                              {a.questionCount ? ` · ${a.questionCount} Q` : ""} · {a.state.toLowerCase()}
                            </span>
                          </span>
                          <span className="flex flex-col">
                            <ArrowUp
                              className={cn("h-3 w-3 text-muted-foreground hover:text-foreground", i === 0 && "opacity-30")}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveActivity(i, -1);
                              }}
                            />
                            <ArrowDown
                              className={cn("h-3 w-3 text-muted-foreground hover:text-foreground", i === activities.length - 1 && "opacity-30")}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveActivity(i, 1);
                              }}
                            />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
                {Object.keys(TYPE_META).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addActivity(t)}
                    disabled={busy === "add-" + t}
                    className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {busy === "add-" + t ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    {TYPE_META[t].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Live settings */}
            {liveSettings && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Live settings</p>
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                  <span className="flex-1 text-xs text-muted-foreground">Join code</span>
                  <span className="font-mono text-sm font-bold tracking-widest text-foreground">{joinCode}</span>
                  <button
                    type="button"
                    onClick={regenerateCode}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Regenerate join code"
                    title="Regenerate join code"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1.5">
                  <Toggle label="Allow late join" field="allowLateJoin" />
                  <Toggle label="Require registration" field="requireRegistration" />
                  <Toggle label="Require check-in" field="requireCheckIn" />
                  <Toggle label="Team mode" field="teamMode" />
                  <Toggle label="Chat" field="chatEnabled" />
                  <Toggle label="Q&A" field="qaEnabled" />
                  <Toggle label="Polls" field="pollsEnabled" />
                  <Toggle label="Allow answer changes" field="allowAnswerChanges" />
                </div>
                <div className="mt-3 border-t border-border pt-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Scoring</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {(["basePoints", "speedBonus", "negativeMarking"] as const).map((f) => (
                      <div key={f}>
                        <label className="text-[10px] text-muted-foreground">
                          {f === "basePoints" ? "Base" : f === "speedBonus" ? "Speed" : "Negative"}
                        </label>
                        <input
                          type="number"
                          defaultValue={liveSettings.scoring?.[f] ?? 0}
                          min={0}
                          max={10000}
                          onBlur={(e) =>
                            saveSettings({ scoring: { ...liveSettings.scoring, [f]: Number(e.target.value) } })
                          }
                          className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary/50"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5">
                    <label className="text-[10px] text-muted-foreground">Leaderboard shown</label>
                    <select
                      value={liveSettings.leaderboardVisibility || "after_activity"}
                      onChange={(e) => saveSettings({ leaderboardVisibility: e.target.value })}
                      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary/50"
                    >
                      <option value="never">Never</option>
                      <option value="every_question">After every question</option>
                      <option value="every_n">Every N questions</option>
                      <option value="after_activity">After each activity</option>
                      <option value="checkpoints">At checkpoints</option>
                      <option value="final">Final only</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: editor ── */}
          {selected ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      TYPE_META[selected.type]?.tint
                    )}
                  >
                    {TYPE_META[selected.type]?.label || selected.type}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={runValidation} disabled={busy === "validate"} className="gap-1.5">
                      {busy === "validate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Validate
                    </Button>
                    {selected.type === "QUIZ" && (
                      <Button size="sm" variant="outline" onClick={generateQuiz} disabled={busy === "generate"} className="gap-1.5">
                        {busy === "generate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        Generate (AI)
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteActivity(selected)}
                      disabled={busy === "del-" + selected._id}
                      className="gap-1.5 text-[#ba1a1a]"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </div>
                <input
                  value={selected.title}
                  onChange={(e) => setActivities((p) => p.map((x) => (x._id === selected._id ? { ...x, title: e.target.value } : x)))}
                  onBlur={(e) => saveActivityMeta(selected, { title: e.target.value })}
                  className="mt-2 w-full rounded-xl border border-transparent bg-transparent px-1 py-1 text-lg font-extrabold tracking-tight text-foreground outline-none hover:border-border focus:border-primary/50"
                  placeholder="Activity title"
                  maxLength={120}
                />
                <textarea
                  defaultValue={selected.description}
                  onBlur={(e) => saveActivityMeta(selected, { description: e.target.value })}
                  rows={2}
                  maxLength={500}
                  placeholder="Description (optional)…"
                  className="mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
                />

                {validation && (
                  <div
                    className={cn(
                      "mt-3 rounded-xl border px-3 py-2 text-xs",
                      validation.valid
                        ? "border-[#006C4C]/30 bg-success-light text-[#006C4C]"
                        : "border-[#ba1a1a]/30 bg-[#ba1a1a]/5 text-[#ba1a1a]"
                    )}
                  >
                    {validation.valid ? (
                      <p className="font-bold">Valid — this activity can go live.</p>
                    ) : (
                      <>
                        <p className="font-bold">Not ready to go live:</p>
                        <ul className="mt-1 list-inside list-disc">
                          {validation.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Questions (QUIZ + POLL) */}
              {["QUIZ", "POLL"].includes(selected.type) && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {selected.type === "POLL" ? "Poll question" : `Questions (${questions.length})`}
                    </p>
                    {(selected.type !== "POLL" || questions.length === 0) && (
                      <Button size="sm" onClick={() => setEditingQuestion(null)} className="gap-1.5">
                        <Plus className="h-3.5 w-3.5" /> {selected.type === "POLL" ? "Set question" : "Add question"}
                      </Button>
                    )}
                  </div>

                  {questionsLoading ? (
                    <div className="py-4 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : questions.length === 0 ? (
                    <div className="py-4">
                      <EmptyState
                        icon={ShieldAlert}
                        title={selected.type === "POLL" ? "No poll question yet" : "No questions yet"}
                        description={
                          selected.type === "POLL"
                            ? "A poll is exactly one choice question."
                            : "Add your first question — or try the AI generation boundary."
                        }
                      />
                    </div>
                  ) : (
                    <ul className="mt-3 space-y-1.5">
                      {questions.map((q, i) => (
                        <li
                          key={q._id}
                          className="flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2"
                        >
                          <span className="text-[10px] font-bold text-muted-foreground">Q{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">{q.text}</span>
                            <span className="block text-[10px] text-muted-foreground">
                              {q.type.replace("_", " ").toLowerCase()} · {q.points} pts · {q.timeLimit}s ·{" "}
                              {selected.type === "POLL"
                                ? "live percentages"
                                : q.type.includes("ANSWER")
                                  ? "pending review"
                                  : `correct: ${typeof q.correctAnswer === "object" && q.correctAnswer ? (q.correctAnswer as number[]).map((c) => String.fromCharCode(65 + c)).join(",") : String.fromCharCode(65 + Number(q.correctAnswer || 0))}`}
                            </span>
                          </span>
                          <span className="flex items-center gap-0.5">
                            {selected.type !== "POLL" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => moveQuestion(i, -1)}
                                  disabled={i === 0}
                                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                  aria-label="Move up"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveQuestion(i, 1)}
                                  disabled={i === questions.length - 1}
                                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                  aria-label="Move down"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => duplicateQuestion(q._id!)}
                                  disabled={busy === "dup-" + q._id}
                                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                                  aria-label="Duplicate"
                                  title="Duplicate question"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditingQuestion(q)}
                              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {selected.type !== "POLL" && (
                              <button
                                type="button"
                                onClick={() => deleteQuestion(q._id!)}
                                disabled={busy === "delq-" + q._id}
                                className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-[#ba1a1a]"
                                aria-label="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Non-question activities */}
              {!["QUIZ", "POLL"].includes(selected.type) && (
                <div className="rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center">
                  <BarChart3 className="mx-auto h-6 w-6 text-muted-foreground/50" />
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {TYPE_META[selected.type]?.label} activity
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                    {selected.type === "QA"
                      ? "Participants submit questions during the live event; you feature, answer, hide or close them."
                      : selected.type === "LEADERBOARD"
                        ? "A leaderboard checkpoint in the activity sequence — visibility follows the live settings."
                        : selected.type === "WELCOME"
                          ? "The opening moment of your event — participants see it in the waiting room flow."
                          : "Custom activity — title and description above, realtime behaviour in Phase 2."}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-8">
              <EmptyState
                icon={ShieldAlert}
                title="No activity selected"
                description="Pick an activity on the left, or add the first one to build your live event sequence."
              />
            </div>
          )}
        </div>
      )}

      {/* Question editor dialog */}
      {editingQuestion !== undefined && selected && (
        <QuestionEditorDialog
          activityId={selected._id}
          activityType={selected.type}
          initial={editingQuestion}
          onClose={() => setEditingQuestion(undefined)}
          onSaved={() => {
            setEditingQuestion(undefined);
            loadQuestions();
            load();
          }}
        />
      )}
    </div>
  );
}

/** Wrap QuestionEditor in a dialog (kept separate for clarity). */
function QuestionEditorDialog({
  activityId,
  activityType,
  initial,
  onClose,
  onSaved,
}: {
  activityId: string;
  activityType: string;
  initial: QuestionData | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{initial?._id ? "Edit question" : "New question"}</DialogTitle>
        </DialogHeader>
        <QuestionEditor
          activityId={activityId}
          activityType={activityType}
          initial={initial}
          onClose={onClose}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}
