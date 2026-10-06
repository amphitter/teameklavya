"use client";

/**
 * Question editor for the Live Event Engine Activity Builder (Part 4, Phase 1).
 * Supports all six question types (spec §20): option add/remove, mark
 * correct (per type semantics), Cloudinary image, points, time limit,
 * explanation — plus a live participant preview (mobile / desktop) that
 * renders EXACTLY what participants will see (no answer key shown).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ImagePlus, Loader2, Monitor, Plus, Smartphone, Trash2, X } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface QuestionData {
  _id?: string;
  type: string;
  text: string;
  media?: { url?: string; alt?: string };
  options: string[];
  correctAnswer: any; // number | number[] | string
  points: number;
  timeLimit: number;
  explanation?: string;
  order?: number;
}

const TYPES: { value: string; label: string; hint: string }[] = [
  { value: "SINGLE_CHOICE", label: "Single choice", hint: "One correct option" },
  { value: "MULTIPLE_CHOICE", label: "Multiple choice", hint: "One correct option (classic MCQ)" },
  { value: "MULTI_SELECT", label: "Multi-select", hint: "Several correct options" },
  { value: "TRUE_FALSE", label: "True / False", hint: "Two fixed options" },
  { value: "SHORT_ANSWER", label: "Short answer", hint: "Subjective — pending review" },
  { value: "LONG_ANSWER", label: "Long answer", hint: "Subjective — pending review" },
];

const isChoice = (t: string) => t === "SINGLE_CHOICE" || t === "MULTIPLE_CHOICE";
const isSubjective = (t: string) => t === "SHORT_ANSWER" || t === "LONG_ANSWER";

export function QuestionEditor({
  activityId,
  activityType,
  initial,
  onClose,
  onSaved,
}: {
  activityId: string;
  activityType: string; // QUIZ or POLL
  initial: QuestionData | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [q, setQ] = useState<QuestionData>(
    initial || {
      type: activityType === "POLL" ? "SINGLE_CHOICE" : "SINGLE_CHOICE",
      text: "",
      media: { url: "", alt: "" },
      options: activityType === "POLL" ? ["", ""] : ["", "", "", ""],
      correctAnswer: activityType === "POLL" ? 0 : 0,
      points: 100,
      timeLimit: activityType === "POLL" ? 60 : 30,
      explanation: "",
    }
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"mobile" | "desktop">("mobile");

  // Polls: choice question only
  useEffect(() => {
    if (activityType === "POLL" && q.type !== "SINGLE_CHOICE" && q.type !== "MULTIPLE_CHOICE") {
      setQ((p) => ({ ...p, type: "SINGLE_CHOICE" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityType]);

  const set = (patch: Partial<QuestionData>) => setQ((p) => ({ ...p, ...patch }));

  const switchType = (type: string) => {
    if (type === "TRUE_FALSE") {
      set({ type, options: ["True", "False"], correctAnswer: 0 });
    } else if (isSubjective(type)) {
      set({ type, options: [], correctAnswer: "" });
    } else if (isChoice(q.type) && (isChoice(type) || type === "MULTI_SELECT")) {
      set({ type, correctAnswer: type === "MULTI_SELECT" ? [0] : 0 });
    } else {
      set({ type, options: ["", "", "", ""], correctAnswer: type === "MULTI_SELECT" ? [0] : 0 });
    }
  };

  const setOption = (i: number, value: string) => {
    const options = [...q.options];
    options[i] = value;
    set({ options });
  };
  const addOption = () => {
    if (q.options.length >= 8) return;
    set({ options: [...q.options, ""] });
  };
  const removeOption = (i: number) => {
    if (q.options.length <= 2) return;
    const options = q.options.filter((_, idx) => idx !== i);
    let correctAnswer = q.correctAnswer;
    if (q.type === "MULTI_SELECT") {
      correctAnswer = (q.correctAnswer as number[]).filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
    } else if (Number(q.correctAnswer) === i) {
      correctAnswer = 0;
    } else if (Number(q.correctAnswer) > i) {
      correctAnswer = Number(q.correctAnswer) - 1;
    }
    set({ options, correctAnswer });
  };
  const toggleCorrect = (i: number) => {
    if (q.type === "MULTI_SELECT") {
      const cur = new Set<number>((q.correctAnswer as number[]) || []);
      if (cur.has(i)) cur.delete(i);
      else cur.add(i);
      set({ correctAnswer: Array.from(cur).sort((a, b) => a - b) });
    } else {
      set({ correctAnswer: i });
    }
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/upload/image?folder=questions", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data?.success && res.data.url) set({ media: { url: res.data.url, alt: q.media?.alt || "" } });
      else throw new Error();
    } catch {
      toast.error("Image upload failed");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        type: q.type,
        text: q.text,
        media: q.media,
        options: q.type === "TRUE_FALSE" || isSubjective(q.type) ? undefined : q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
        timeLimit: q.timeLimit,
        explanation: q.explanation,
      };
      const res = initial?._id
        ? await api.put(`/questions/${initial._id}`, body)
        : await api.post(`/activities/${activityId}/questions`, body);
      if (res.data?.success) {
        toast.success(initial?._id ? "Question updated" : "Question added");
        onSaved();
      } else {
        toast.error(res.data?.message || "Validation failed");
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Couldn't save question");
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    q.text.trim().length > 0 &&
    (isSubjective(q.type) ||
      q.type === "TRUE_FALSE" ||
      (q.options.length >= 2 && q.options.every((o) => o.trim().length > 0)));

  return (
    <div className="space-y-4">
      {/* Type picker */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Type</label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              disabled={activityType === "POLL" && !isChoice(t.value)}
              onClick={() => switchType(t.value)}
              className={cn(
                "rounded-xl border p-2 text-left transition-colors",
                q.type === t.value ? "border-primary bg-brand-light" : "border-border hover:bg-muted",
                activityType === "POLL" && !isChoice(t.value) && "opacity-40"
              )}
            >
              <p className="text-xs font-bold text-foreground">{t.label}</p>
              <p className="text-[10px] text-muted-foreground">{t.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Text */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Question</label>
        <textarea
          value={q.text}
          onChange={(e) => set({ text: e.target.value })}
          rows={2}
          maxLength={1000}
          placeholder="Type your question…"
          className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />
      </div>

      {/* Media */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Image (optional)</label>
        <div className="mt-1.5 flex items-center gap-3">
          <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {q.media?.url ? "Replace" : "Upload"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
            />
          </label>
          {q.media?.url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.media.url} alt="" className="h-9 w-14 rounded-md object-cover" />
              <button
                type="button"
                onClick={() => set({ media: { url: "", alt: "" } })}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-[#ba1a1a]"
                aria-label="Remove image"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Options */}
      {(isChoice(q.type) || q.type === "MULTI_SELECT") && (
        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Options — click the circle to mark correct {q.type === "MULTI_SELECT" && "(multiple)"}
          </label>
          <div className="mt-1.5 space-y-1.5">
            {q.options.map((opt, i) => {
              const marked =
                q.type === "MULTI_SELECT"
                  ? ((q.correctAnswer as number[]) || []).includes(i)
                  : Number(q.correctAnswer) === i;
              return (
                <div key={i} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleCorrect(i)}
                    title={marked ? "Correct — click to unmark" : "Mark correct"}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      marked ? "border-[#006C4C] bg-success-light text-[#006C4C]" : "border-border text-transparent hover:border-primary/50"
                    )}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <input
                    value={opt}
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    maxLength={200}
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary/50"
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    disabled={q.options.length <= 2}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-[#ba1a1a] disabled:opacity-30"
                    aria-label={`Remove option ${i + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addOption}
            disabled={q.options.length >= 8}
            className="mt-1.5 flex items-center gap-1 text-xs font-bold text-primary hover:underline disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add option
          </button>
        </div>
      )}

      {q.type === "TRUE_FALSE" && (
        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Correct answer</label>
          <div className="mt-1.5 flex gap-2">
            {[0, 1].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => set({ correctAnswer: i })}
                className={cn(
                  "flex-1 rounded-xl border p-2.5 text-sm font-bold transition-colors",
                  Number(q.correctAnswer) === i
                    ? "border-[#006C4C] bg-success-light text-[#006C4C]"
                    : "border-border text-foreground hover:bg-muted"
                )}
              >
                {i === 0 ? "True" : "False"}
              </button>
            ))}
          </div>
        </div>
      )}

      {isSubjective(q.type) && (
        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Model answer (optional — grading stays pending review)
          </label>
          <textarea
            value={String(q.correctAnswer || "")}
            onChange={(e) => set({ correctAnswer: e.target.value })}
            rows={2}
            maxLength={1000}
            className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
        </div>
      )}

      {/* Points / time / explanation */}
      <div className="grid grid-cols-2 gap-3">
        {activityType !== "POLL" && (
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Points</label>
            <input
              type="number"
              value={q.points}
              onChange={(e) => set({ points: Number(e.target.value) })}
              min={1}
              max={10000}
              className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary/50"
            />
          </div>
        )}
        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Time limit (sec)</label>
          <input
            type="number"
            value={q.timeLimit}
            onChange={(e) => set({ timeLimit: Number(e.target.value) })}
            min={5}
            max={600}
            className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
      </div>
      {activityType !== "POLL" && (
        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Explanation (shown after answering)
          </label>
          <input
            value={q.explanation || ""}
            onChange={(e) => set({ explanation: e.target.value })}
            maxLength={1000}
            className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setPreview(true)} className="gap-1.5">
          <Smartphone className="h-3.5 w-3.5" /> Preview
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={!canSave || saving} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {initial?._id ? "Save question" : "Add question"}
          </Button>
        </div>
      </div>

      {/* Participant preview — exactly what participants see (no answer key) */}
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 text-base">
              Participant preview
              <span className="flex rounded-full bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewDevice("mobile")}
                  className={cn("rounded-full p-1.5", previewDevice === "mobile" ? "bg-card text-primary" : "text-muted-foreground")}
                  aria-label="Mobile preview"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice("desktop")}
                  className={cn("rounded-full p-1.5", previewDevice === "desktop" ? "bg-card text-primary" : "text-muted-foreground")}
                  aria-label="Desktop preview"
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className={cn("mx-auto w-full rounded-2xl border border-border bg-background p-4", previewDevice === "mobile" ? "max-w-xs" : "max-w-md")}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Q{String((initial?.order ?? 0) + 1)} · {q.points} pts · {q.timeLimit}s
            </p>
            <p className="mt-1 text-sm font-bold text-foreground">{q.text || "Your question text…"}</p>
            {q.media?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={q.media.url} alt="" className="mt-2 max-h-44 w-full rounded-xl object-cover" />
            ) : null}
            <div className="mt-3 space-y-1.5">
              {(q.type === "TRUE_FALSE" ? ["True", "False"] : q.options).map((opt, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-[10px] font-bold text-muted-foreground">
                    {String.fromCharCode(65 + i)}
                  </span>
                  {opt || `Option ${String.fromCharCode(65 + i)}`}
                </div>
              ))}
              {isSubjective(q.type) && (
                <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  {q.type === "SHORT_ANSWER" ? "Short text input" : "Long text area"}
                </div>
              )}
            </div>
            <p className="mt-3 text-center text-[10px] text-muted-foreground">
              Participants never see the correct answer before submitting.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
