"use client";

/**
 * Q&A panel (Part 4, Phase 6 — spec §40).
 *
 * Participants submit questions and upvote others (one vote per user,
 * toggleable, server-idempotent). The organizer moderates: Feature (pin),
 * Answer, Hide, and Close/Reopen submissions. Vote counts are public;
 * voter identities are NEVER sent (§39/§40 privacy).
 */
import { useState } from "react";
import { CheckCircle2, ChevronUp, EyeOff, Loader2, MessageCircleQuestion, Pin, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QAState } from "@/lib/live-protocol";
import { cn } from "@/lib/utils";

export function QAPanel({
  qa,
  activityId,
  variant,
  onSubmit,
  onUpvote,
  onFeature,
  onAnswer,
  onHide,
  onClose,
  busy,
}: {
  qa: QAState;
  activityId: string;
  variant: "participant" | "organizer";
  onSubmit?: (activityId: string, text: string) => Promise<any>;
  onUpvote?: (questionId: string) => Promise<any>;
  onFeature?: (questionId: string) => Promise<any>;
  onAnswer?: (questionId: string, answerText: string) => Promise<any>;
  onHide?: (questionId: string) => Promise<any>;
  onClose?: (activityId: string) => Promise<any>;
  busy?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const isOrganizer = variant === "organizer";

  const doSubmit = async () => {
    if (!onSubmit || sending || !text.trim()) return;
    setSending(true);
    try {
      const ack = await onSubmit(activityId, text.trim());
      if (ack?.ok) setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <MessageCircleQuestion className="h-3.5 w-3.5" /> Audience Q&A
          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase", qa.closed ? "bg-muted text-muted-foreground" : "bg-[#006C4C] text-white")}>
            {qa.closed ? "Closed" : "Open"}
          </span>
        </p>
        {isOrganizer && onClose ? (
          <Button size="sm" variant="outline" disabled={busy === "qa-close"} onClick={() => onClose(activityId)} className="h-7 gap-1 text-xs">
            {qa.closed ? "Reopen submissions" : "Close submissions"}
          </Button>
        ) : null}
      </div>

      {/* Submit box — participants only, while open */}
      {!isOrganizer && !qa.closed && onSubmit ? (
        <div className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                doSubmit();
              }
            }}
            placeholder="Ask a question…"
            aria-label="Ask a question"
            className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary/50"
          />
          <Button onClick={doSubmit} disabled={sending || !text.trim()} className="gap-1.5">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ask
          </Button>
        </div>
      ) : null}
      {!isOrganizer && qa.closed ? (
        <p className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          The organizer closed submissions — upvotes still count.
        </p>
      ) : null}

      {/* Question list */}
      {qa.questions.length === 0 ? (
        <p className="mt-4 py-4 text-center text-sm text-muted-foreground">
          {isOrganizer ? "No audience questions yet." : "No questions yet — be the first to ask."}
        </p>
      ) : (
        <ul className="mt-3 max-h-[340px] space-y-1.5 overflow-y-auto">
          {qa.questions.map((q) => (
            <li
              key={q.id}
              className={cn(
                "rounded-xl border px-3 py-2.5",
                q.status === "featured"
                  ? "border-primary/50 bg-brand-light"
                  : q.status === "hidden"
                    ? "border-[#ba1a1a]/30 bg-[#ba1a1a]/5"
                    : q.status === "answered"
                      ? "border-[#006C4C]/30 bg-success-light/50"
                      : "border-border bg-background"
              )}
            >
              <div className="flex items-start gap-2.5">
                {/* Upvote — participants, one toggleable vote */}
                {!isOrganizer && onUpvote ? (
                  <button
                    type="button"
                    onClick={() => onUpvote(q.id)}
                    aria-label={q.voted ? `Remove upvote (currently ${q.votes})` : `Upvote (currently ${q.votes})`}
                    className={cn(
                      "flex w-10 shrink-0 flex-col items-center rounded-lg border py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                      q.voted ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/50 text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    <span className="text-xs font-extrabold tabular-nums">{q.votes}</span>
                  </button>
                ) : (
                  <span className="flex w-10 shrink-0 flex-col items-center rounded-lg border border-border bg-muted/50 py-1 text-muted-foreground">
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    <span className="text-xs font-extrabold tabular-nums">{q.votes}</span>
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-foreground">{q.text}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="truncate">by {q.author.displayName}</span>
                    {q.status === "featured" ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 font-extrabold uppercase text-primary">
                        <Pin className="h-2.5 w-2.5" /> Featured
                      </span>
                    ) : null}
                    {q.status === "hidden" ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-[#ba1a1a]/10 px-1.5 py-0.5 font-extrabold uppercase text-[#ba1a1a]">
                        <EyeOff className="h-2.5 w-2.5" /> Hidden
                      </span>
                    ) : null}
                    {q.status === "answered" ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-[#006C4C]/10 px-1.5 py-0.5 font-extrabold uppercase text-[#006C4C]">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Answered
                      </span>
                    ) : null}
                  </p>

                  {q.answerText ? (
                    <p className="mt-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs leading-relaxed text-foreground">
                      <span className="font-extrabold text-[#006C4C]">Answer: </span>
                      {q.answerText}
                    </p>
                  ) : null}

                  {/* Inline answer composer (organizer) */}
                  {isOrganizer && answeringId === q.id && onAnswer ? (
                    <div className="mt-2 flex gap-1.5">
                      <input
                        value={answerText}
                        onChange={(e) => setAnswerText(e.target.value.slice(0, 1000))}
                        placeholder="Type the answer…"
                        aria-label="Answer text"
                        autoFocus
                        className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                      />
                      <Button
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        disabled={!answerText.trim()}
                        onClick={async () => {
                          await onAnswer(q.id, answerText.trim());
                          setAnsweringId(null);
                          setAnswerText("");
                        }}
                      >
                        <Send className="h-3 w-3" /> Send
                      </Button>
                    </div>
                  ) : null}

                  {/* Organizer moderation row */}
                  {isOrganizer ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {onFeature && (q.status === "open" || q.status === "featured") ? (
                        <button type="button" onClick={() => onFeature(q.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                          <Pin className="h-3 w-3" /> {q.status === "featured" ? "Unfeature" : "Feature"}
                        </button>
                      ) : null}
                      {onAnswer && q.status !== "answered" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAnsweringId(answeringId === q.id ? null : q.id);
                            setAnswerText("");
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Answer
                        </button>
                      ) : null}
                      {onHide && q.status !== "hidden" ? (
                        <button type="button" onClick={() => onHide(q.id)} className="inline-flex items-center gap-1 rounded-lg border border-[#ba1a1a]/40 px-2 py-0.5 text-[10px] font-bold text-[#ba1a1a] hover:bg-[#ba1a1a]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                          <XCircle className="h-3 w-3" /> Hide
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
