"use client";

/**
 * Shared "Report" dialog (Part 3, Phase 10 — Moderation).
 * Used for posts, comments, events and users. On open it checks the
 * user's existing reports: if this target was already reported, the
 * dialog shows the report's live status instead of the form.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Flag, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ReportTargetType = "post" | "comment" | "event" | "user";

const REASONS: { value: string; label: string; hint: string }[] = [
  { value: "spam", label: "Spam", hint: "Unwanted promotion, repetitive posting, scams" },
  { value: "harassment", label: "Harassment", hint: "Bullying, threats, targeted abuse" },
  { value: "inappropriate", label: "Inappropriate", hint: "Offensive content not suitable for the platform" },
  { value: "misinformation", label: "Misinformation", hint: "False or misleading claims" },
  { value: "other", label: "Something else", hint: "Anything that doesn't fit the above" },
];

const TARGET_LABEL: Record<ReportTargetType, string> = {
  post: "post",
  comment: "comment",
  event: "event",
  user: "person",
};

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: ReportTargetType;
  targetId: string;
}

export function ReportDialog({ open, onOpenChange, targetType, targetId }: ReportDialogProps) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [existing, setExisting] = useState<{ status: string; resolution?: string } | null>(null);

  // On open: has this user already reported this target?
  useEffect(() => {
    if (!open) {
      setReason("");
      setDetails("");
      setExisting(null);
      return;
    }
    setChecking(true);
    api
      .get("/moderation/my-reports")
      .then((r) => {
        const mine = (r.data?.reports || []).find(
          (x: any) => x.targetType === targetType && String(x.targetId) === String(targetId)
        );
        setExisting(mine ? { status: mine.status, resolution: mine.resolution } : null);
      })
      .catch(() => setExisting(null))
      .finally(() => setChecking(false));
  }, [open, targetType, targetId]);

  const submit = useCallback(async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.post("/moderation/reports", { targetType, targetId, reason, details });
      if (res.data?.success) {
        toast.success(
          res.data.alreadyReported ? "You already reported this — it's with the moderators" : "Report submitted — thank you"
        );
        onOpenChange(false);
      } else throw new Error();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Couldn't submit report");
    } finally {
      setSubmitting(false);
    }
  }, [reason, details, submitting, targetType, targetId, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-[#ba1a1a]" />
            Report this {TARGET_LABEL[targetType]}
          </DialogTitle>
          <DialogDescription>
            Reports go to the EventHub moderation team. Serious reports may remove the
            {targetType === "user" ? " person" : " content"} from the platform.
          </DialogDescription>
        </DialogHeader>

        {checking ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : existing ? (
          <div className="rounded-xl bg-muted p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-[#006C4C]" />
              You already reported this
            </p>
            <p className="mt-1 text-muted-foreground">
              Status:{" "}
              <span
                className={cn(
                  "font-bold",
                  existing.status === "open" && "text-amber-600",
                  existing.status === "actioned" && "text-[#006C4C]",
                  existing.status === "dismissed" && "text-muted-foreground"
                )}
              >
                {existing.status === "open"
                  ? "Under review"
                  : existing.status === "actioned"
                    ? "Action taken"
                    : "Reviewed — no action"}
              </span>
            </p>
            {existing.resolution ? (
              <p className="mt-1 text-xs text-muted-foreground">Moderator note: {existing.resolution}</p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors",
                    reason === r.value
                      ? "border-[#ba1a1a] bg-[#ba1a1a]/5"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <p className={cn("text-sm font-bold", reason === r.value ? "text-[#ba1a1a]" : "text-foreground")}>
                    {r.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.hint}</p>
                </button>
              ))}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Anything else the moderators should know? (optional)"
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-[#ba1a1a]/50"
            />
            <Button
              onClick={submit}
              disabled={!reason || submitting}
              className="w-full bg-[#ba1a1a] text-white hover:bg-[#9e1616]"
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit report
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
