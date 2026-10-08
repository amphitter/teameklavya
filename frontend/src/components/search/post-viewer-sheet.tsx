"use client";

/**
 * Post viewer (§6) — the sheet the Search grid and Search results open when a
 * post is tapped.
 *
 * It renders the FEED's own `FeedPost`, so like, double-tap like, comment,
 * save, share, open profile and open event all behave exactly as they do in the
 * feed. There is no second post implementation to drift out of sync, and no
 * navigation: closing the sheet puts the user back at the exact scroll position
 * they left, because the page never went anywhere.
 *
 * Two ways in, because the two callers hold different things:
 *   · the Trending grid already has a complete post, so it passes `post`;
 *   · a search result is a lightweight row, so it passes `postId` and the sheet
 *     hydrates it through `GET /posts/:id` — the same endpoint the post
 *     permalink and the shared-post card use, which means like counts, images,
 *     event context and the viewer's own like/save state are the server's
 *     answer, not a guess from a search projection.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/utils/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FeedPost } from "@/components/feed/feed-post";
import type { FeedPostData } from "@/components/feed/types";

export function PostViewerSheet({
  post,
  postId,
  onClose,
  onDeleted,
}: {
  post?: FeedPostData | null;
  postId?: string | null;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  const [fetched, setFetched] = useState<FeedPostData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const id = post?._id || postId || null;

  useEffect(() => {
    if (post || !postId) return;
    let alive = true;
    setFetched(null);
    setFailed(false);
    setLoading(true);
    api
      .get(`/posts/${postId}`)
      .then((r) => {
        if (alive && r.data?.post) setFetched(r.data.post);
        else if (alive) setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [post, postId]);

  const shown = post || fetched;

  return (
    <Sheet open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto overscroll-contain rounded-t-2xl p-3 sm:mx-auto sm:mb-4 sm:max-w-[620px] sm:rounded-2xl sm:p-4"
      >
        {/* Radix requires a title for the dialog; it is for screen readers. */}
        <SheetHeader className="sr-only">
          <SheetTitle>Post</SheetTitle>
        </SheetHeader>
        {loading && !shown ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading post…
          </div>
        ) : failed && !shown ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            This post is no longer available.
          </p>
        ) : shown ? (
          <FeedPost
            post={shown}
            onDeleted={() => {
              onDeleted?.(shown._id);
              onClose();
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
