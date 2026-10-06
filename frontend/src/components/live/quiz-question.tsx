"use client";

/**
 * QuizQuestionView (Part 4, Phase 4 — spec §16–18, §27–30, §53, §55, §67, §69, §84).
 *
 * The participant's question surface: synced timer, media, options grid,
 * multi-select toggles, subjective textarea. Everything authoritative comes
 * from the server — this component only renders and submits; it never
 * decides correctness, never scores, never keeps the answer key.
 *
 * Accessibility (§84): every option is a real <button>, keyboard shortcuts
 * A–D / 1–n select options, feedback states use icon + text — never color
 * alone (§18). Timer states are restrained: no flashing, no shaking.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Hourglass, ImageOff, Loader2, Lock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuestionTimer } from "@/components/live/timer";
import type { AnswerResult, QuestionReveal, QuestionState } from "@/lib/live-protocol";
import { cn } from "@/lib/utils";

const OPTION_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function QuizQuestionView({
  activityId,
  question,
  reveal,
  answerResult,
  offset,
  paused,
  isPoll = false,
  onAnswer,
}: {
  activityId: string;
  question: QuestionState;
  reveal: QuestionReveal | null;
  answerResult: AnswerResult | null;
  offset: number;
  paused: boolean;
  isPoll?: boolean;
  onAnswer: (activityId: string, questionId: string, answer: number | number[] | string) => Promise<any>;
}) {
  const isSubjective = question.type === "SHORT_ANSWER" || question.type === "LONG_ANSWER";
  const isMulti = question.type === "MULTI_SELECT";
  const locked = Boolean(answerResult) || question.answered || question.closed;
  const [selected, setSelected] = useState<number[]>([]);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);

  // Reset local draft state when a NEW question opens
  useEffect(() => {
    setSelected([]);
    setText("");
    setSubmitting(false);
  }, [question.id]);

  const submit = useCallback(
    async (answer: number | number[] | string) => {
      if (submitting || locked) return;
      setSubmitting(true);
      try {
        await onAnswer(activityId, question.id, answer);
      } finally {
        setSubmitting(false);
      }
    },
    [activityId, question.id, submitting, locked, onAnswer]
  );

  const chooseOption = useCallback(
    (idx: number) => {
      if (locked || submitting) return;
      if (isMulti) {
        setSelected((prev) => (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx].sort((a, b) => a - b)));
      } else {
        // Single choice / TF: pick and submit — fast-paced quiz UX (§67)
        submit(idx);
      }
    },
    [isMulti, locked, submitting, submit]
  );

  submitRef.current = isMulti
    ? selected.length
      ? () => submit(selected)
      : null
    : isSubjective
      ? text.trim()
        ? () => submit(text.trim())
        : null
      : null;

  /* Keyboard shortcuts (§84): A–D / 1–n pick options; Enter submits drafts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSubjective || locked || submitting) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      let idx = -1;
      if (/^[a-h]$/.test(k)) idx = k.charCodeAt(0) - 97;
      else if (/^[1-8]$/.test(k)) idx = Number(k) - 1;
      if (idx >= 0 && idx < question.options.length) {
        e.preventDefault();
        chooseOption(idx);
      } else if (e.key === "Enter" && submitRef.current) {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [question.options.length, isSubjective, locked, submitting, chooseOption]);

  const myReveal =
    reveal && String(reveal.questionId) === String(question.id) ? reveal : null;

  return (
    <div className="text-left">
      {/* Header: index + synced timer */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {question.type.replace(/_/g, " ")}
          {typeof question.index === "number" && typeof question.total === "number"
            ? ` · Question ${question.index + 1} of ${question.total}`
            : ""}
          {question.points ? ` · ${question.points} pts` : ""}
        </p>
        <QuestionTimer
          startedAt={paused ? null : question.startedAt}
          durationSec={question.durationSec}
          elapsedBeforePause={question.elapsedBeforePause}
          remainingMs={question.remainingMs}
          offset={offset}
        />
      </div>

      {/* Question text + media */}
      <h2 className="mt-3 text-lg font-extrabold leading-snug tracking-tight text-foreground sm:text-xl">
        {question.text}
      </h2>
      {question.media?.url ? (
        <img
          src={question.media.url}
          alt={question.media.alt || "Question media"}
          className="mt-3 max-h-56 w-full rounded-xl border border-border object-contain"
        />
      ) : null}

      {/* Subjective: textarea */}
      {isSubjective ? (
        question.closed || answerResult || question.answered ? (
          <SubjectiveLocked answered={Boolean(answerResult) || Boolean(question.answered)} />
        ) : (
          <div className="mt-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 1000))}
              placeholder="Type your answer…"
              rows={4}
              disabled={submitting || paused}
              className="w-full resize-none rounded-xl border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
              aria-label="Your answer"
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{text.length}/1000 · reviewed after the event</p>
              <Button onClick={() => submit(text.trim())} disabled={submitting || paused || !text.trim()} className="gap-1.5">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit answer
              </Button>
            </div>
          </div>
        )
      ) : (
        <>
          {/* Options grid */}
          <div
            className={cn(
              "mt-4 grid gap-2",
              question.options.length > 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2"
            )}
            role="listbox"
            aria-label="Answer options"
          >
            {question.options.map((opt, idx) => {
              const picked = isMulti ? selected.includes(idx) : false;
              const isCorrectReveal =
                myReveal &&
                (Array.isArray(myReveal.correctAnswer)
                  ? myReveal.correctAnswer.includes(idx)
                  : Number(myReveal.correctAnswer) === idx);
              return (
                <button
                  key={idx}
                  type="button"
                  role="option"
                  aria-selected={picked}
                  disabled={locked || submitting || paused}
                  onClick={() => chooseOption(idx)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm font-semibold transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    "disabled:cursor-not-allowed",
                    isCorrectReveal
                      ? "border-[#006C4C] bg-success-light text-[#006C4C]"
                      : picked
                        ? "border-primary bg-brand-light text-foreground"
                        : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted/40"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-extrabold",
                      isCorrectReveal
                        ? "border-[#006C4C] bg-[#006C4C] text-white"
                        : picked
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-muted text-muted-foreground"
                    )}
                    aria-hidden="true"
                  >
                    {OPTION_KEYS[idx] ?? idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    {opt}
                    {/* Poll distribution (§39): counts only, live as votes land */}
                    {isPoll && question.results && question.results.counts[idx] !== undefined ? (
                      <span className="mt-1 block">
                        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${question.results.total ? Math.round((question.results.counts[idx] / question.results.total) * 100) : 0}%` }}
                          />
                        </span>
                        <span className="mt-0.5 block text-[10px] font-bold tabular-nums text-muted-foreground">
                          {question.results.total ? Math.round((question.results.counts[idx] / question.results.total) * 100) : 0}% · {question.results.counts[idx]} vote{question.results.counts[idx] === 1 ? "" : "s"}
                        </span>
                      </span>
                    ) : null}
                  </span>
                  {isCorrectReveal ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          {/* Multi-select submit */}
          {isMulti && !locked ? (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {paused ? "Paused — answer when the organizer resumes" : "Pick all that apply, then submit"}
              </p>
              <Button
                onClick={() => submit(selected)}
                disabled={submitting || paused || selected.length === 0}
                className="gap-1.5"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit {selected.length > 0 ? `(${selected.length})` : ""}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </>
      )}

      {/* Answer feedback — icon + text, never color alone (§18, §28) */}
      {answerResult && String(answerResult.questionId) === String(question.id) ? (
        <div
          className={cn(
            "mt-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-bold",
            answerResult.pending
              ? "border-border bg-muted/60 text-muted-foreground"
              : answerResult.correct
                ? "border-[#006C4C] bg-success-light text-[#006C4C]"
                : "border-[#ba1a1a] bg-[#ba1a1a]/10 text-[#ba1a1a]"
          )}
          role="status"
        >
          {answerResult.pending ? (
            <Hourglass className="h-5 w-5 shrink-0" aria-hidden="true" />
          ) : answerResult.correct === null ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          ) : answerResult.correct ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          {answerResult.pending ? (
            <span>Answer submitted — pending review by the organizer.</span>
          ) : answerResult.correct === null ? (
            // Poll vote (§39): neutral — no grading, no score display
            <span>{isPoll ? "Vote recorded — live results below." : "Answer recorded."}</span>
          ) : answerResult.correct ? (
            <span>Correct! +{answerResult.points} pts · Total {answerResult.score}</span>
          ) : (
            <span>Incorrect. {answerResult.points < 0 ? `${answerResult.points} pts` : "No points"} · Total {answerResult.score}</span>
          )}
        </div>
      ) : question.answered && !question.closed ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-muted/60 px-3.5 py-3 text-sm font-bold text-muted-foreground" role="status">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Answer locked in. Waiting for the question to close…</span>
        </div>
      ) : null}

      {/* Closed + reveal (§21): answer key arrives only now */}
      {question.closed ? (
        <div className="mt-4 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
          <div className="flex items-center gap-2 text-sm font-extrabold text-foreground">
            <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {answerResult || question.answered ? "Question closed" : "Time's up — answers are in"}
          </div>
          {myReveal ? (
            <>
              {myReveal.correctAnswer !== null && myReveal.correctAnswer !== undefined && !isSubjective ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Correct answer:{" "}
                  <span className="font-bold text-[#006C4C]">
                    {Array.isArray(myReveal.correctAnswer)
                      ? myReveal.correctAnswer.map((i) => OPTION_KEYS[i] ?? String(i + 1)).join(", ")
                      : typeof myReveal.correctAnswer === "number"
                        ? `${OPTION_KEYS[myReveal.correctAnswer] ?? String(myReveal.correctAnswer + 1)} — ${question.options[myReveal.correctAnswer] ?? ""}`
                        : String(myReveal.correctAnswer)}
                  </span>
                </p>
              ) : isSubjective ? (
                <p className="mt-1.5 text-xs text-muted-foreground">Subjective question — the organizer reviews answers after the event.</p>
              ) : null}
              {myReveal.explanation ? (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{myReveal.explanation}</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {!question.media?.url && question.options.length === 0 && !isSubjective ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" /> No options for this question.
        </div>
      ) : null}
    </div>
  );
}

function SubjectiveLocked({ answered }: { answered: boolean }) {
  return (
    <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-muted/60 px-3.5 py-3 text-sm font-bold text-muted-foreground" role="status">
      {answered ? <Lock className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{answered ? "Answer submitted — pending review by the organizer." : "Question closed — answers are in."}</span>
    </div>
  );
}
