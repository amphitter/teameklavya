"use client";

import { Bookmark } from "lucide-react";
import { OwnerListPage } from "@/components/feed/owner-list-page";

/**
 * Saved posts — private to the signed-in user (Part 3 §19).
 *
 * One of three owner-only lists (saved / liked / archived) that are genuinely
 * different things: saving is a bookmark you make on anyone's post, liking is a
 * reaction, archiving is your own post set aside. They share the list shell and
 * nothing else.
 */
export default function SavedPage() {
  return (
    <OwnerListPage
      title="Saved posts"
      subtitle="Private to you — only you can see this list."
      icon={Bookmark}
      endpoint={({ cursor }) => `/posts/saved?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
      emptyTitle="Nothing saved yet"
      emptyDescription="Save something you want to come back to — tap the bookmark on any post."
    />
  );
}
