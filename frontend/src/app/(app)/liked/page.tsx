"use client";

import { Heart } from "lucide-react";
import { OwnerListPage } from "@/components/feed/owner-list-page";

/**
 * Posts you reacted to (Part 9 §11).
 *
 * Private in the sense that matters: the endpoint is viewer-scoped, so this
 * page can only ever show YOUR reactions. Liking a post is public; the list of
 * everything you have liked is not.
 */
export default function LikedPage() {
  return (
    <OwnerListPage
      title="Liked posts"
      subtitle="Posts you reacted to, newest first — private to you."
      icon={Heart}
      endpoint={({ cursor }) => `/posts/liked?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
      emptyTitle="Nothing liked yet"
      emptyDescription="Double-tap a photo, or tap the heart on any post, and it will show up here."
    />
  );
}
