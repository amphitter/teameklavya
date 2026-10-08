"use client";

/**
 * Your activity (§48) — one place for "what have I been doing here".
 *
 * The brief asked for this as a destination from the profile menu, and the
 * honest version is a tab strip over the endpoints that already exist for each
 * category. Nothing here is a new API and nothing is a mock:
 *
 *   Posts     GET /api/users/:id/posts      (page-based)
 *   Likes     GET /api/posts/liked          (cursor)
 *   Saved     GET /api/posts/saved          (cursor)
 *   Archived  GET /api/posts/archived       (cursor)
 *   Stories   GET /api/stories/archive      (grouped by month)
 *
 * Comments are absent on purpose: there is no "comments I wrote" endpoint, and
 * a tab that shows an empty list because the API does not exist would be worse
 * than not having the tab (§41 — never fake a surface).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ImageOff } from "lucide-react";
import { api } from "@/utils/api";
import { PostList } from "@/components/feed/post-list";
import { PageLoader } from "@/components/states";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cn } from "@/lib/utils";

type Tab = "posts" | "likes" | "saved" | "archived" | "stories";

const TABS: { id: Tab; label: string }[] = [
  { id: "posts", label: "Posts" },
  { id: "likes", label: "Likes" },
  { id: "saved", label: "Saved" },
  { id: "archived", label: "Archived" },
  { id: "stories", label: "Stories" },
];

interface ArchiveStory {
  _id: string;
  media?: { url?: string; type?: string; poster?: string };
  caption?: string;
  createdAt?: string;
}

export default function ActivityPage() {
  const { user, ready } = useSessionUser();
  const [tab, setTab] = useState<Tab>("posts");
  const [stories, setStories] = useState<{ label: string; items: ArchiveStory[] }[] | null>(null);
  const [storiesError, setStoriesError] = useState(false);

  /* Only the Stories tab needs this call, and only when it is opened — the
     other four paginate themselves through PostList. */
  useEffect(() => {
    if (tab !== "stories" || stories) return;
    api
      .get("/stories/archive")
      .then((r) => {
        const groups = (r.data?.groups || []).map((g: any) => ({ label: g.label, items: g.stories || [] }));
        setStories(groups);
      })
      .catch(() => setStoriesError(true));
  }, [tab, stories]);

  if (!ready || !user?._id) return <PageLoader label="Loading your activity…" />;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-5 sm:px-6 sm:py-7">
      <div>
        <Link
          href="/user/profile"
          className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-primary"
        >
          <ChevronLeft className="h-4 w-4" /> Your profile
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">Your activity</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Everything you have written, liked, saved and set aside — in one place.
        </p>
      </div>

      {/* A horizontal strip that scrolls on a narrow phone and never shrinks a
          target below a thumb (§30, §44). */}
      <div
        role="tablist"
        aria-label="Activity sections"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "posts" ? (
        <PostList
          endpoint={({ page }) => `/users/${user._id}/posts?limit=12&page=${page}`}
          emptyTitle="No posts yet"
          emptyDescription="Share an event moment and it will show up here."
        />
      ) : null}

      {tab === "likes" ? (
        <PostList
          endpoint={({ cursor }) => `/posts/liked?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
          emptyTitle="Nothing liked yet"
          emptyDescription="Posts you like land here — private to you."
        />
      ) : null}

      {tab === "saved" ? (
        <PostList
          endpoint={({ cursor }) => `/posts/saved?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
          emptyTitle="Nothing saved yet"
          emptyDescription="Save something you want to come back to."
        />
      ) : null}

      {tab === "archived" ? (
        <PostList
          endpoint={({ cursor }) => `/posts/archived?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
          emptyTitle="Nothing archived"
          emptyDescription="Archive a post from its ••• menu to set it aside without deleting it."
        />
      ) : null}

      {tab === "stories" ? (
        <>
          {storiesError ? (
            <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              Couldn&apos;t load your stories. Pull the tab again to retry.
            </p>
          ) : stories === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading your stories…</p>
          ) : stories.length === 0 ? (
            <p className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              <ImageOff className="h-5 w-5" />
              No expired stories yet. A story moves here 24 hours after you post it.
            </p>
          ) : (
            <div className="space-y-4">
              {stories.map((g) => (
                <div key={g.label}>
                  <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {g.items.map((s) => (
                      <Link
                        key={s._id}
                        href="/stories/archive"
                        className="group relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-muted"
                        aria-label={s.caption ? `Story: ${s.caption}` : "Story"}
                      >
                        {s.media?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={(s.media as any).poster || s.media.url}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                          />
                        ) : null}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              <Link
                href="/stories/archive"
                className="inline-block text-[13px] font-semibold text-primary hover:underline"
              >
                Manage in Story archive →
              </Link>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
