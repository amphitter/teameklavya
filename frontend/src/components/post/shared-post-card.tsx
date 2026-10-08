"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { api } from "@/utils/api";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

/**
 * A post that was shared into a conversation (Part 13 §19–§21).
 *
 * The message stores only a post id. This card fetches the post and renders it,
 * which is the only way the three things the brief asks for can all be true at
 * once:
 *
 *   · an edited post shows its current text, not the text as it was at share
 *     time (nothing was copied into the message);
 *   · a post the reader is not allowed to see is refused by the API — the
 *     visibility rules are applied to the person reading the conversation, at
 *     read time, by the same endpoint the permalink uses;
 *   · a deleted post renders "Post unavailable" instead of an empty hole, and
 *     the rest of the conversation keeps working.
 *
 * The response is cached per post id for the life of the page, so a thread with
 * five shares of the same post fetches it once.
 */

type Cached =
  | { state: "ok"; post: any }
  | { state: "gone" }
  | { state: "error" };

const cache = new Map<string, Promise<Cached>>();

function loadPost(postId: string): Promise<Cached> {
  if (!cache.has(postId)) {
    const p = api
      .get(`/posts/${postId}`)
      .then((res): Cached => {
        if (res.data?.success && res.data.post) return { state: "ok", post: res.data.post };
        return { state: "gone" };
      })
      .catch((e): Cached => {
        // 404 (deleted) and 403 (no longer visible to me) are the same thing to
        // a reader: the post is not available. Anything else is a real error.
        const status = e?.response?.status;
        return status === 404 || status === 403 ? { state: "gone" } : { state: "error" };
      });
    cache.set(postId, p);
  }
  return cache.get(postId)!;
}

export function SharedPostCard({ postId, mine }: { postId: string; mine?: boolean }) {
  const [result, setResult] = useState<Cached | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPost(postId).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const shell = cn(
    "mt-1.5 block w-full max-w-[19rem] overflow-hidden rounded-xl border text-left",
    mine ? "border-white/25 bg-black/10" : "border-border bg-background"
  );

  if (!result) {
    return (
      <div className={shell}>
        <div className="animate-pulse space-y-2 p-2.5">
          <div className="h-3 w-1/2 rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (result.state !== "ok") {
    return (
      <div className={shell} data-testid="shared-post-unavailable">
        <div className="flex items-center gap-2 p-2.5">
          <ImageOff className="h-4 w-4 shrink-0 opacity-70" />
          <span className={cn("text-xs", mine ? "text-white/80" : "text-muted-foreground")}>
            Post unavailable
          </span>
        </div>
      </div>
    );
  }

  const post = result.post;

  /* The API lets an author read their OWN post after deleting it (that is what
     makes the archive list work), so "did the request succeed" is not the same
     question as "does this post still exist". A deleted, hidden or draft post is
     unavailable HERE regardless of who is looking: the message is about a post
     that is gone, and the sender — who is usually the author — is the person
     most likely to see this card. */
  if (post.status && post.status !== "published") {
    return (
      <div className={shell} data-testid="shared-post-unavailable">
        <div className="flex items-center gap-2 p-2.5">
          <ImageOff className="h-4 w-4 shrink-0 opacity-70" />
          <span className={cn("text-xs", mine ? "text-white/80" : "text-muted-foreground")}>Post unavailable</span>
        </div>
      </div>
    );
  }
  const author = post.author;
  const name = author ? `${author.firstName || ""} ${author.lastName || ""}`.trim() || author.username : "EventHub";
  const text = String(post.content || "").trim();
  const image = post.images?.[0] || post.memory?.image || null;

  return (
    <Link
      href={`/post/${post._id}`}
      className={cn(shell, "transition-colors", mine ? "hover:bg-black/20" : "hover:border-primary/40")}
      data-testid="shared-post-card"
    >
      <div className="flex items-center gap-2 px-2.5 pt-2.5">
        <UserAvatar user={author || {}} size={24} />
        <span className={cn("min-w-0 flex-1 truncate text-xs font-bold", mine ? "text-white" : "text-foreground")}>
          {name}
        </span>
      </div>
      {text ? (
        <p className={cn("line-clamp-3 px-2.5 pb-2 pt-1 text-xs", mine ? "text-white/90" : "text-foreground/90")}>
          {text}
        </p>
      ) : null}
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="max-h-40 w-full object-cover" loading="lazy" />
      ) : null}
    </Link>
  );
}
