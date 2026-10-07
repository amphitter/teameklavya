"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CornerDownRight, Flag, Loader2, SendHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { UserAvatar } from "@/components/user-avatar";
import { EmojiButton } from "@/components/ui/emoji-picker";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { timeAgo, profilePathOf } from "@/lib/social";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import type { CommentData } from "@/hooks/use-social";

/**
 * Comments (§12-14).
 *
 * §12 — "Do NOT navigate to an ugly separate page for normal comments."
 * Mobile gets a bottom sheet with a drag-to-dismiss handle; desktop gets a
 * right-side panel. Both share CommentList / CommentComposer below, so there
 * is one implementation of threading, not two that drift.
 *
 * §14 — the composer carries a real emoji picker, and it sits above the
 * mobile keyboard: the sheet is positioned with `visualViewport` so the
 * composer rides the keyboard instead of being pushed off-screen.
 */

export interface CommentSheetProps {
  open: boolean;
  onClose: () => void;
  postId: string;
  /** Live count from the parent, so the feed badge stays accurate. */
  onCountChange?: (n: number) => void;
  initialCount?: number;
  variant?: "sheet" | "panel";
}

export function CommentSheet({ open, onClose, postId, onCountChange, initialCount = 0, variant = "sheet" }: CommentSheetProps) {
  const [count, setCount] = useState(initialCount);
  useEffect(() => {
    if (open) setCount(initialCount);
  }, [open, initialCount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    // Only lock the page for the mobile sheet; the desktop panel is a sidebar.
    if (variant === "sheet") document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, variant]);

  if (!open) return null;

  const body = (
    <CommentList postId={postId} onCountChange={(n) => { setCount(n); onCountChange?.(n); }} />
  );

  if (variant === "panel") {
    return (
      <aside className="flex h-full w-full max-w-sm flex-col border-l border-outline-variant bg-surface-container-lowest" aria-label="Comments">
        <header className="flex shrink-0 items-center justify-between border-b border-outline-variant px-4 py-3">
          <h2 className="text-[16px] font-bold text-on-surface">Comments</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-on-surface-variant hover:bg-surface-container" aria-label="Close comments">
            <X className="h-5 w-5" />
          </button>
        </header>
        {body}
      </aside>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Comments">
      <button type="button" className="absolute inset-0 bg-[rgba(11,18,53,0.5)] animate-fade-in" onClick={onClose} aria-label="Close comments" />
      <div className="relative flex h-[78vh] max-h-[38rem] flex-col rounded-t-2xl bg-surface-container-lowest elevation-float animate-sheet-up">
        {/* Drag handle */}
        <div className="flex shrink-0 justify-center pt-2.5">
          <span className="h-1 w-10 rounded-full bg-outline-variant" aria-hidden />
        </div>
        <header className="flex shrink-0 items-center justify-between border-b border-outline-variant px-4 py-2.5">
          <h2 className="text-[16px] font-bold text-on-surface">
            Comments{count ? <span className="ml-1.5 text-[13px] font-semibold text-on-surface-variant">{count}</span> : null}
          </h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-on-surface-variant hover:bg-surface-container" aria-label="Close comments">
            <X className="h-5 w-5" />
          </button>
        </header>
        {body}
      </div>
    </div>,
    document.body
  );
}

/* ── List ───────────────────────────────────────────────────────────────── */

export function CommentList({ postId, onCountChange }: { postId: string; onCountChange?: (n: number) => void }) {
  const { user } = useSessionUser();
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<CommentData | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replies, setReplies] = useState<Record<string, CommentData[]>>({});
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const r = await api.get(`/posts/${postId}/comments`);
      const list: CommentData[] = r.data?.comments || [];
      setComments(list);
      onCountChange?.(list.reduce((n, c) => n + 1 + (c.replyCount || 0), 0));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setComments([]);
    setExpanded(new Set());
    setReplies({});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  /** §13 — replies load on demand, not all at once. */
  const toggleReplies = async (commentId: string) => {
    if (expanded.has(commentId)) {
      setExpanded((p) => {
        const n = new Set(p);
        n.delete(commentId);
        return n;
      });
      return;
    }
    if (!replies[commentId]) {
      setLoadingReplies((p) => new Set(p).add(commentId));
      try {
        const r = await api.get(`/posts/${postId}/comments/${commentId}/replies`);
        setReplies((p) => ({ ...p, [commentId]: r.data?.replies || [] }));
      } catch {
        toast.error("Couldn't load replies");
      } finally {
        setLoadingReplies((p) => {
          const n = new Set(p);
          n.delete(commentId);
          return n;
        });
      }
    }
    setExpanded((p) => new Set(p).add(commentId));
  };

  /** §45 — optimistic insert, rolled back if the request fails. */
  const addOptimistic = (c: CommentData, parentId?: string) => {
    if (parentId) {
      setReplies((p) => ({ ...p, [parentId]: [...(p[parentId] || []), c] }));
      setComments((p) => p.map((x) => (x._id === parentId ? { ...x, replyCount: (x.replyCount || 0) + 1 } : x)));
      setExpanded((p) => new Set(p).add(parentId));
    } else {
      setComments((p) => [...p, c]);
    }
  };

  const removeOptimistic = (id: string, parentId?: string) => {
    if (parentId) {
      setReplies((p) => ({ ...p, [parentId]: (p[parentId] || []).filter((x) => x._id !== id) }));
      setComments((p) => p.map((x) => (x._id === parentId ? { ...x, replyCount: Math.max(0, (x.replyCount || 0) - 1) } : x)));
    } else {
      setComments((p) => p.filter((x) => x._id !== id));
    }
  };

  const submit = async (content: string) => {
    const parentId = replyTo?._id;
    const tempId = `tmp-${Date.now()}`;
    const optimistic: CommentData = {
      _id: tempId,
      author: user?._id
        ? { _id: user._id, firstName: user.firstName, lastName: user.lastName, username: user.username, profile: { avatar: user.profile?.avatar } }
        : undefined,
      content,
      createdAt: new Date().toISOString(),
      parent: parentId || null,
      pending: true,
    };
    addOptimistic(optimistic, parentId);
    setReplyTo(null);
    try {
      const r = await api.post(`/posts/${postId}/comments`, { content, ...(parentId ? { parent: parentId } : {}) });
      const saved: CommentData = r.data?.comment;
      if (parentId) {
        setReplies((p) => ({ ...p, [parentId]: (p[parentId] || []).map((x) => (x._id === tempId ? saved : x)) }));
      } else {
        setComments((p) => p.map((x) => (x._id === tempId ? saved : x)));
      }
    } catch {
      removeOptimistic(tempId, parentId);
      toast.error("Couldn't post that comment");
    }
  };

  const like = async (c: CommentData) => {
    const next = !c.likedByMe;
    const patch = (x: CommentData) =>
      x._id === c._id ? { ...x, likedByMe: next, likesCount: Math.max(0, (x.likesCount || 0) + (next ? 1 : -1)) } : x;
    setComments((p) => p.map(patch));
    for (const k of Object.keys(replies)) setReplies((p) => ({ ...p, [k]: (p[k] || []).map(patch) }));
    try {
      const r = await api.post(`/posts/${postId}/comments/${c._id}/like`, {});
      const patch2 = (x: CommentData) => (x._id === c._id ? { ...x, likedByMe: r.data.liked, likesCount: r.data.likesCount } : x);
      setComments((p) => p.map(patch2));
      for (const k of Object.keys(replies)) setReplies((p) => ({ ...p, [k]: (p[k] || []).map(patch2) }));
    } catch {
      setComments((p) => p.map(patch));
      toast.error("Couldn't update that like");
    }
  };

  const remove = async (c: CommentData, parentId?: string) => {
    if (!confirm("Delete this comment?")) return;
    removeOptimistic(c._id, parentId);
    try {
      await api.delete(`/posts/${postId}/comments/${c._id}`);
    } catch {
      toast.error("Couldn't delete that comment");
      load();
    }
  };

  const total = useMemo(
    () => comments.reduce((n, c) => n + 1 + (c.replyCount || 0), 0),
    [comments]
  );
  useEffect(() => {
    onCountChange?.(total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {loading ? (
          <CommentSkeleton />
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-[13px] text-on-surface-variant">Could not load comments.</p>
            <button type="button" onClick={load} className="rounded-lg border border-outline-variant px-3 py-1.5 text-[13px] font-semibold text-primary hover:bg-surface-container">
              Retry
            </button>
          </div>
        ) : !comments.length ? (
          <div className="flex flex-col items-center gap-1 py-12 text-center">
            <Icon name="mode_comment" size={30} className="text-on-surface-variant/50" />
            <p className="text-[14px] font-bold text-on-surface">No comments yet</p>
            <p className="max-w-[15rem] text-[12px] text-on-surface-variant">Be the first to start the conversation.</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {comments.map((c) => (
              <li key={c._id}>
                <CommentRow
                  comment={c}
                  canDelete={Boolean(user && String(c.author?._id) === String(user._id))}
                  onLike={() => like(c)}
                  onReply={() => setReplyTo(c)}
                  onDelete={() => remove(c)}
                  onReport={() => setReportTarget(c._id)}
                />
                {/* §13 — "View replies (N)" instead of dumping the tree */}
                {(c.replyCount || 0) > 0 ? (
                  <div className="ml-12">
                    <button
                      type="button"
                      onClick={() => toggleReplies(c._id)}
                      className="flex items-center gap-1.5 py-1 text-[12px] font-semibold text-on-surface-variant hover:text-primary"
                      aria-expanded={expanded.has(c._id)}
                    >
                      {loadingReplies.has(c._id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span className="h-px w-5 bg-outline-variant" aria-hidden />
                      )}
                      {expanded.has(c._id) ? "Hide replies" : `View replies (${c.replyCount})`}
                    </button>
                    {expanded.has(c._id) ? (
                      <ul className="mt-1 space-y-1 border-l border-outline-variant pl-2">
                        {(replies[c._id] || []).map((r) => (
                          <li key={r._id}>
                            <CommentRow
                              comment={r}
                              compact
                              canDelete={Boolean(user && String(r.author?._id) === String(user._id))}
                              onLike={() => like(r)}
                              onReply={() => setReplyTo(c)}
                              onDelete={() => remove(r, c._id)}
                              onReport={() => setReportTarget(r._id)}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <CommentComposer
        onSubmit={submit}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />

      {reportTarget ? <ReportDialog open onOpenChange={(o) => !o && setReportTarget(null)} targetType="comment" targetId={reportTarget} /> : null}
    </>
  );
}

/* ── Row ────────────────────────────────────────────────────────────────── */

function CommentRow({
  comment,
  compact,
  canDelete,
  onLike,
  onReply,
  onDelete,
  onReport,
}: {
  comment: CommentData;
  compact?: boolean;
  canDelete?: boolean;
  onLike: () => void;
  onReply: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  const name = `${comment.author?.firstName || ""} ${comment.author?.lastName || ""}`.trim() || "Unknown";
  return (
    <div className={cn("group/comment flex gap-2.5 rounded-lg px-1 py-1.5", comment.pending && "opacity-60")}>
      <Link href={profilePathOf(comment.author)} className="shrink-0">
        <UserAvatar user={comment.author} size={compact ? 28 : 32} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <Link href={profilePathOf(comment.author)} className="text-[13px] font-bold text-on-surface hover:underline">
            {name}
          </Link>
          {comment.author?.verified ? <Icon name="verified" size={13} filled className="text-primary" label="Verified" /> : null}
          <span className="text-[11px] text-on-surface-variant">{timeAgo(comment.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-on-surface">{comment.content}</p>
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={onLike}
            className={cn("flex items-center gap-1 text-[12px] font-semibold transition", comment.likedByMe ? "text-primary" : "text-on-surface-variant hover:text-primary")}
            aria-pressed={comment.likedByMe}
            aria-label={comment.likedByMe ? "Unlike comment" : "Like comment"}
          >
            <Icon name="favorite" size={14} filled={comment.likedByMe} />
            {comment.likesCount ? <span className="tabular-nums">{comment.likesCount}</span> : null}
          </button>
          <button type="button" onClick={onReply} className="flex items-center gap-1 text-[12px] font-semibold text-on-surface-variant hover:text-primary">
            <CornerDownRight className="h-3 w-3" /> Reply
          </button>
          {canDelete ? (
            <button type="button" onClick={onDelete} className="text-[12px] font-semibold text-on-surface-variant opacity-0 transition hover:text-destructive group-hover/comment:opacity-100 focus-visible:opacity-100">
              Delete
            </button>
          ) : (
            <button type="button" onClick={onReport} className="text-[12px] font-semibold text-on-surface-variant opacity-0 transition hover:text-destructive group-hover/comment:opacity-100 focus-visible:opacity-100">
              Report
            </button>
          )}
        </div>
      </div>
      {canDelete ? (
        <button type="button" onClick={onDelete} className="hidden shrink-0 rounded p-1 text-on-surface-variant hover:text-destructive sm:block sm:opacity-0 sm:group-hover/comment:opacity-100" aria-label="Delete comment">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button type="button" onClick={onReport} className="hidden shrink-0 rounded p-1 text-on-surface-variant hover:text-destructive sm:block sm:opacity-0 sm:group-hover/comment:opacity-100" aria-label="Report comment">
          <Flag className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ── Composer ───────────────────────────────────────────────────────────── */

function CommentComposer({
  onSubmit,
  replyTo,
  onCancelReply,
}: {
  onSubmit: (content: string) => void;
  replyTo?: CommentData | null;
  onCancelReply: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /* §12/§14 — keep the composer above the mobile keyboard. iOS does not
     resize the window when the keyboard opens, so a plain sticky element
     ends up hidden behind it. */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${offset}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  useEffect(() => {
    if (replyTo) taRef.current?.focus();
  }, [replyTo]);

  const send = () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    onSubmit(value);
    setText("");
    // The optimistic insert is already on screen; release the guard at once.
    requestAnimationFrame(() => setSending(false));
  };

  return (
    <div
      className="sticky bottom-0 shrink-0 border-t border-outline-variant bg-surface-container-lowest/95 backdrop-blur"
      style={{ paddingBottom: "var(--keyboard-inset, 0px)" }}
    >
      {replyTo ? (
        <div className="flex items-center gap-2 border-b border-outline-variant/60 bg-purple-light/50 px-3 py-1.5 text-[12px]">
          <Icon name="reply" size={14} className="shrink-0 text-purple" />
          <span className="min-w-0 flex-1 truncate text-on-surface-variant">
            Replying to <span className="font-semibold text-purple">{replyTo.author?.firstName || "comment"}</span>
          </span>
          <button type="button" onClick={onCancelReply} className="rounded-full p-1 hover:bg-surface-container" aria-label="Cancel reply">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="flex items-end gap-1.5 px-2 py-2">
        <EmojiButton
          preferAbove
          onSelect={(e) => {
            setText((t) => (t + e).slice(0, 1000));
            taRef.current?.focus();
          }}
        />
        <label className="sr-only" htmlFor="comment-input">
          Write a comment
        </label>
        <textarea
          id="comment-input"
          ref={taRef}
          rows={1}
          value={text}
          maxLength={1000}
          placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter newlines — same convention as chat.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-[7.5rem] min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-outline-variant bg-surface px-3.5 py-2.5 text-[15px] leading-snug outline-none placeholder:text-on-surface-variant/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12"
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim()}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
            text.trim() ? "brand-gradient text-white elevation-glow" : "bg-surface-container text-on-surface-variant"
          )}
          aria-label="Post comment"
        >
          <SendHorizontal className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function CommentSkeleton() {
  return (
    <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading comments">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-2.5 px-1">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-surface-container" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-surface-container" />
            <div className="h-3 w-full animate-pulse rounded bg-surface-container" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-surface-container" />
          </div>
        </div>
      ))}
    </div>
  );
}
