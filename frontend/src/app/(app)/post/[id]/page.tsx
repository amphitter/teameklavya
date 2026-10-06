"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/utils/api";
import { FeedPost } from "@/components/feed/feed-post";
import { Comments } from "@/components/feed/comments";
import { PageLoader, ErrorState } from "@/components/states";
import { PostPermalinkNotice } from "@/components/feed/feed-post";
import type { FeedPostData } from "@/components/feed/types";

/** Single post — the share/copy-link target. */
export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<FeedPostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentCount, setCommentCount] = useState(0);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .get(`/posts/${id}`)
      .then((res) => {
        if (res.data?.success && res.data.post) {
          setPost(res.data.post);
          setCommentCount(res.data.post.commentCount || 0);
        } else {
          setError("Post not found");
        }
      })
      .catch(() => setError("This post may have been deleted"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-5 sm:px-6">
      <PostPermalinkNotice />
      <div className="mt-3 space-y-4">
        {loading ? (
          <PageLoader label="Loading post…" />
        ) : error || !post ? (
          <ErrorState title="Couldn't load post" description={error || "Unknown error"} onRetry={load} />
        ) : (
          <>
            <FeedPost post={post} onDeleted={() => window.history.back()} />
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-bold text-foreground">
                Comments {commentCount > 0 && <span className="font-normal text-muted-foreground">· {commentCount}</span>}
              </h2>
              <Comments postId={post._id} onCountChange={setCommentCount} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
