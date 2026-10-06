"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Flag, Loader2, SendHorizontal, Trash2 } from "lucide-react";
import { api } from "@/utils/api";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { RichContent } from "@/components/feed/rich-content";
import Link from "next/link";
import { profilePathOf } from "@/lib/social";
import { Button } from "@/components/ui/button";
import { handleOf, timeAgo } from "@/lib/social";
import { useSessionUser } from "@/components/shell/use-session-user";
import type { CommentData } from "@/components/feed/types";

/**
 * Comment list + composer. Used inside the comment dialog
 * and on the single-post page.
 */
export function Comments({ postId, onCountChange }: { postId: string; onCountChange?: (n: number) => void }) {
  const { user } = useSessionUser();
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api
      .get(`/posts/${postId}/comments`)
      .then((res) => {
        if (cancelled) return;
        setComments(res.data?.comments || []);
        onCountChange?.(res.data?.comments?.length || 0);
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const res = await api.post(`/posts/${postId}/comments`, { content });
      if (res.data?.success && res.data.comment) {
        setComments((p) => [...p, res.data.comment]);
        setText("");
        onCountChange?.(comments.length + 1);
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to comment");
    } finally {
      setSending(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!window.confirm("Delete this comment?")) return;
    setComments((p) => {
      const next = p.filter((c) => c._id !== commentId);
      onCountChange?.(next.length);
      return next;
    });
    try {
      const res = await api.delete(`/posts/${postId}/comments/${commentId}`);
      if (!res.data?.success) throw new Error();
    } catch {
      toast.error("Couldn't delete comment");
      api.get(`/posts/${postId}/comments`).then((r) => {
        setComments(r.data?.comments || []);
        onCountChange?.(r.data?.comments?.length || 0);
      }).catch(() => {});
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-1">
        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading comments…</p>}
        {failed && <p className="py-6 text-center text-sm text-muted-foreground">Couldn&apos;t load comments.</p>}
        {!loading && !failed && comments.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No comments yet — be the first.</p>
        )}
        {comments.map((c) => (
          <div key={c._id} className="group flex gap-2.5">
            <UserAvatar user={c.author} size={32} />
            <div className="min-w-0 flex-1 rounded-xl bg-muted/60 px-3.5 py-2.5">
              <p className="text-xs">
                <Link href={profilePathOf(c.author)} className="font-bold text-foreground hover:underline">
                  {c.author?.firstName} {c.author?.lastName}
                </Link>{" "}
                <span className="text-muted-foreground">@{handleOf(c.author)} · {timeAgo(c.createdAt)}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                <RichContent text={c.content} />
              </p>
            </div>
            {user && c.author?._id === user._id ? (
              <button
                type="button"
                onClick={() => deleteComment(c._id)}
                aria-label="Delete comment"
                className="self-start rounded-lg p-1.5 text-muted-foreground/0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : user ? (
              <button
                type="button"
                onClick={() => setReportTarget(c._id)}
                aria-label="Report comment"
                className="self-start rounded-lg p-1.5 text-muted-foreground/0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:text-muted-foreground"
              >
                <Flag className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {user ? (
        <form onSubmit={submit} className="mt-3 flex items-end gap-2 border-t border-border pt-3">
          <UserAvatar user={user} size={32} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            rows={1}
            maxLength={500}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="max-h-24 min-h-[38px] flex-1 resize-none rounded-full border border-input bg-background px-4 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
          />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0 rounded-full" disabled={!text.trim() || sending} aria-label="Send comment">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </Button>
        </form>
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-center text-xs text-muted-foreground">
          Sign in to join the conversation.
        </p>
      )}
      <ReportDialog
        open={Boolean(reportTarget)}
        onOpenChange={(o) => !o && setReportTarget(null)}
        targetType="comment"
        targetId={reportTarget || ""}
      />
    </div>
  );
}
