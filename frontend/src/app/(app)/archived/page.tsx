"use client";

import { Archive } from "lucide-react";
import { OwnerListPage } from "@/components/feed/owner-list-page";

/**
 * Your own archived posts (Part 9 §12).
 *
 * Not deleted, and not saved: archived posts are YOURS, taken out of public
 * feeds and your public profile, and restorable from here. The endpoint filters
 * on `author: req.user.id`, so nobody can read anyone else's archive.
 */
export default function ArchivedPage() {
  return (
    <OwnerListPage
      title="Archive"
      subtitle="Posts you set aside. Out of your profile and the feed — nothing is deleted."
      icon={Archive}
      endpoint={({ cursor }) => `/posts/archived?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
      emptyTitle="Nothing archived"
      emptyDescription="Archive a post from its ••• menu to move it here without deleting it."
    />
  );
}
