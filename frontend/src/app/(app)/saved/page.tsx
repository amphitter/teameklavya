"use client";

import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { api } from "@/utils/api";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { FeedPost } from "@/components/feed/feed-post";
import type { FeedPostData } from "@/components/feed/types";

/**
 * Saved posts — private to the signed-in user (Part 3 §19).
 * Real saved posts only; deleted/hidden originals drop out server-side.
 */
export default function SavedPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [posts, setPosts] = useState<FeedPostData[]>([]);

  const load = () => {
    setLoading(true);
    setError(false);
    api
      .get("/posts/saved")
      .then((res) => setPosts(res.data?.posts || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = (id: string) => setPosts((p) => p.filter((x) => x._id !== id));

  if (loading) return <PageLoader label="Loading saved posts…" />;
  if (error)
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <ErrorState title="Couldn't load saved posts" description="Give it another try." onRetry={load} />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-5 sm:px-6 sm:py-7">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          <Bookmark className="h-5 w-5 text-primary" /> Saved posts
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Private to you — only you can see this list.</p>
      </div>

      {posts.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="Nothing saved yet"
          description="Tap the bookmark on any post to keep it here for later."
          actionLabel="Back to feed"
          onAction={() => window.location.assign("/")}
        />
      ) : (
        posts.map((p) => <FeedPost key={p._id} post={p} onDeleted={remove} />)
      )}
    </div>
  );
}
