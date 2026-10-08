"use client";

/**
 * The page shell shared by /saved, /liked and /archived.
 *
 * These three are the same screen with a different title, endpoint and empty
 * state — the kind of sameness that turns into three drifting copies if it is
 * not named once. Each route is a four-line file that names its own content;
 * this owns the layout, the heading, the privacy note and the list.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PostList } from "@/components/feed/post-list";

export function OwnerListPage({
  title,
  subtitle,
  icon: Icon,
  endpoint,
  emptyTitle,
  emptyDescription,
  emptyAction,
  bare = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  endpoint: (params: { cursor: string | null }) => string;
  emptyTitle: string;
  emptyDescription: string;
  /** Optional way out of the empty state (§10: "Explore events"). */
  emptyAction?: React.ReactNode;
  /** Skip the heading — the caller already drew one (e.g. the Archive tabs). */
  bare?: boolean;
}) {
  const list = (
    <PostList
      endpoint={endpoint}
      emptyIcon={Icon}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      emptyAction={emptyAction}
    />
  );

  if (bare) return list;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-5 sm:px-6 sm:py-7">
      <div>
        <Link
          href="/"
          className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-primary"
        >
          <ChevronLeft className="h-4 w-4" /> Back to feed
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          <Icon className="h-5 w-5 text-primary" /> {title}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {list}
    </div>
  );
}
