"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Bookmark,
  Building2,
  Flag,
  Heart,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Share2,
  Trash2,
  Trophy,
  Users,
} from "lucide-react";
import { api } from "@/utils/api";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { UserAvatar } from "@/components/user-avatar";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { RichContent } from "@/components/feed/rich-content";
import { profilePathOf } from "@/lib/social";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EventPostCard } from "@/components/feed/event-post-card";
import { FollowAuthorButton } from "@/components/feed/follow-author-button";
import { Comments } from "@/components/feed/comments";
import { compactCount, handleOf, timeAgo } from "@/lib/social";
import { useSessionUser } from "@/components/shell/use-session-user";
import type { FeedPostData } from "@/components/feed/types";
import { cn } from "@/lib/utils";

export function FeedPost({
  post,
  onDeleted,
}: {
  post: FeedPostData;
  onDeleted?: (id: string) => void;
}) {
  const { user, role } = useSessionUser();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [saved, setSaved] = useState(post.savedByMe);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);

  const isOwn = user && post.author?._id === user._id;
  const canDelete = isOwn || role === "admin";

  const toggleLike = async () => {
    if (!user) {
      toast.info("Sign in to like posts");
      return;
    }
    // optimistic
    setLiked((p) => !p);
    setLikeCount((p) => p + (liked ? -1 : 1));
    try {
      const res = await api.post(`/posts/${post._id}/like`);
      if (res.data?.success) {
        setLiked(res.data.liked);
        setLikeCount(res.data.likeCount);
      }
    } catch {
      // rollback
      setLiked(post.likedByMe);
      setLikeCount(post.likeCount);
      toast.error("Couldn't update like");
    }
  };

  const toggleSave = async () => {
    if (!user) {
      toast.info("Sign in to save posts");
      return;
    }
    setSaved((p) => !p);
    try {
      const res = await api.post(`/posts/${post._id}/save`);
      if (res.data?.success) {
        setSaved(res.data.saved);
        toast.success(res.data.saved ? "Saved" : "Removed from saved");
      }
    } catch {
      setSaved(post.savedByMe);
      toast.error("Couldn't update saved posts");
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/post/${post._id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.info(url);
    }
  };

  const deletePost = async () => {
    setDeleting(true);
    try {
      const res = await api.delete(`/posts/${post._id}`);
      if (res.data?.success) {
        toast.success("Post deleted");
        onDeleted?.(post._id);
      }
    } catch {
      toast.error("Failed to delete post");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
    <article className="rounded-xl border border-border bg-card p-4 sm:p-5">
      {/* Header */}
      <header className="flex items-center gap-3">
        <Link href={profilePathOf(post.author)} aria-label={`View ${post.author?.firstName}'s profile`}>
          <UserAvatar user={post.author} size={40} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-foreground">
            <Link href={profilePathOf(post.author)} className="truncate hover:underline">
              {post.author?.firstName} {post.author?.lastName}
            </Link>
            {post.organization && (
              <>
                <span className="text-muted-foreground">·</span>
                <Link
                  href={`/organizations/${post.organization.slug}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-purple-light px-2 py-0.5 text-[10px] font-bold text-purple hover:opacity-85"
                >
                  <Building2 className="h-3 w-3" />
                  {post.organization.name}
                </Link>
              </>
            )}
            {post.community && (
              <>
                <span className="text-muted-foreground">·</span>
                <Link
                  href={`/communities/${post.community.slug}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-purple-light px-2 py-0.5 text-[10px] font-bold text-purple hover:opacity-85"
                >
                  <Users className="h-3 w-3" />
                  {post.community.name}
                </Link>
              </>
            )}
          </p>
          <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span className="truncate">@{handleOf(post.author)} · {timeAgo(post.createdAt)}</span>
            {post.visibility === "followers" && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground" title="Visible to followers only">
                Followers
              </span>
            )}
            {post.visibility === "event_participants" && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground" title="Visible to event participants only">
                Participants
              </span>
            )}
          </p>
        </div>
        {!isOwn && user && (
          <FollowAuthorButton userId={post.author?._id} initialFollowing={Boolean(post.authorFollowing)} />
        )}
        {(canDelete || (!isOwn && user)) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Post menu"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canDelete && (
                <DropdownMenuItem onClick={deletePost} disabled={deleting} className="gap-2 text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4" /> Delete post
                </DropdownMenuItem>
              )}
              {!isOwn && user && (
                <DropdownMenuItem onClick={() => setReporting(true)} className="gap-2">
                  <Flag className="h-4 w-4" /> Report post
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {/* Content */}
      {post.content && (
        <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">
          <RichContent text={post.content} />
        </p>
      )}

      {/* Images */}
      {post.images?.length > 0 && (
        <div
          className={cn(
            "mt-3 grid gap-1.5 overflow-hidden rounded-xl",
            post.images.length === 1 ? "grid-cols-1" : "grid-cols-2"
          )}
        >
          {post.images.map((img, i) => {
            const single = post.images.length === 1;
            return (
              /* §19 — feed photos now get a responsive srcset (320/640/1024/1400)
                 instead of one fixed 800px (or 500px) request, so a mid-range
                 phone on 4G pulls the smallest variant that fills its screen. */
              <OptimizedImage
                key={i}
                src={img}
                alt={`Photo ${i + 1} by ${post.author?.firstName || "user"}`}
                preset="post"
                size={single ? "medium" : "small"}
                aspectRatio={single ? undefined : "1 / 1"}
                sizes={single ? "(max-width: 640px) 100vw, 600px" : "(max-width: 640px) 50vw, 300px"}
                className={cn(
                  "w-full object-cover",
                  single ? "max-h-[520px] rounded-xl" : "aspect-square rounded-lg"
                )}
              />
            );
          })}
        </div>
      )}

      {/* Structured event-memory share (Phase 9 — §63): rank/score/
          accuracy/achievements frozen server-side from EventResult */}
      {post.memory ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/30 bg-brand-light px-3 py-2">
          <Trophy className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-xs font-bold text-primary">
            {post.memory.rank ? `Ranked #${post.memory.rank}` : "Finished"} · {post.memory.score ?? 0} pts
            {post.memory.accuracy != null ? ` · ${post.memory.accuracy}% accuracy` : ""}
          </span>
          {(post.memory.achievements || []).slice(0, 3).map((c) => (
            <span key={c} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {c.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      ) : null}

      {/* Event card */}
      {post.event && <EventPostCard event={post.event} />}

      {/* Actions */}
      <div className="mt-3.5 flex items-center gap-1 border-t border-border pt-2.5">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={liked}
          aria-label={liked ? "Unlike" : "Like"}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
            liked ? "text-destructive" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <motion.span whileTap={{ scale: 1.35 }} transition={{ type: "spring", stiffness: 500, damping: 15 }}>
            <Heart className={cn("h-[18px] w-[18px]", liked && "fill-destructive")} />
          </motion.span>
          {likeCount > 0 && compactCount(likeCount)}
        </button>

        <button
          type="button"
          onClick={() => setCommentsOpen(true)}
          aria-label="Comments"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MessageCircle className="h-[18px] w-[18px]" />
          {commentCount > 0 && compactCount(commentCount)}
        </button>

        <button
          type="button"
          onClick={share}
          aria-label="Copy link"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Share2 className="h-[18px] w-[18px]" />
        </button>

        <button
          type="button"
          onClick={toggleSave}
          aria-pressed={saved}
          aria-label={saved ? "Unsave" : "Save"}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
            saved ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Bookmark className={cn("h-[18px] w-[18px]", saved && "fill-primary")} />
        </button>
      </div>

      {/* Comments dialog */}
      <Dialog open={commentsOpen} onOpenChange={setCommentsOpen}>
        <DialogContent className="flex max-h-[80vh] max-w-lg flex-col sm:max-h-[85vh]">
          <DialogHeader className="border-b border-border pb-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4 text-primary" /> Comments
              <span className="text-sm font-normal text-muted-foreground">· {compactCount(commentCount)}</span>
            </DialogTitle>
          </DialogHeader>
          <Comments postId={post._id} onCountChange={setCommentCount} />
        </DialogContent>
      </Dialog>
    </article>
      <ReportDialog open={reporting} onOpenChange={setReporting} targetType="post" targetId={post._id} />
    </>
  );
}

/** Compact linked teaser for the single-post page header. */
export function PostPermalinkNotice() {
  return (
    <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
      <Link2 className="h-3.5 w-3.5" /> Back to feed
    </Link>
  );
}
