"use client";

/**
 * Archive (§12) — ONE destination with two SECTIONS: Posts and Stories.
 *
 * The brief is explicit that archive is not saved and not liked, and equally
 * explicit that "archive" is where a user finds both things they took out of
 * circulation: their posts (set aside, still owned) and their stories (expired
 * after 24 hours, still owned). Those were two routes — `/archived` and
 * `/stories/archive` — which meant "where is my stuff" had two answers.
 *
 * Nothing was duplicated to do this: the posts list is the existing owner list,
 * and the stories section is the same `StoryArchiveBody` the `/stories/archive`
 * route renders, so a story deleted in one place disappears from both.
 */

import { useState } from "react";
import Link from "next/link";
import { Archive, ChevronLeft, Info } from "lucide-react";
import { OwnerListPage } from "@/components/feed/owner-list-page";
import { StoryArchiveBody } from "@/components/stories/story-archive-body";
import { cn } from "@/lib/utils";

type Section = "posts" | "stories";

export default function ArchivedPage() {
  const [section, setSection] = useState<Section>("posts");
  const [storyCount, setStoryCount] = useState<number | null>(null);

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-5 sm:px-6 sm:py-7">
      <Link
        href="/"
        className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-primary"
      >
        <ChevronLeft className="h-4 w-4" /> Back to feed
      </Link>
      <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
        <Archive className="h-5 w-5 text-primary" /> Archive
      </h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Out of your profile and the feed — nothing is deleted.
      </p>

      {/* §12 — the two sections. Real tabs, one screen. */}
      <div role="tablist" aria-label="Archive sections" className="mt-3 flex gap-1.5">
        {(
          [
            { id: "posts" as const, label: "Posts" },
            { id: "stories" as const, label: storyCount === null ? "Stories" : `Stories · ${storyCount}` },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={section === t.id}
            onClick={() => setSection(t.id)}
            className={cn(
              "flex-1 rounded-xl px-3 py-3 text-[13px] font-semibold transition-colors",
              section === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* The distinction the brief insists on, stated where it matters. */}
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Archives are neither saved nor liked: saving bookmarks someone else&apos;s post, liking reacts to it, and
          archiving sets your own post or story aside. Views here are yours alone, and a post can be restored at any
          time.
        </span>
      </p>

      {section === "posts" ? (
        <div className="mt-4">
          <OwnerListPage
            bare
            title="Archived posts"
            subtitle="Posts you set aside — restore or delete them from their ••• menu."
            icon={Archive}
            endpoint={({ cursor }) => `/posts/archived?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
            emptyTitle="Nothing archived"
            emptyDescription="Archive a post from its ••• menu to move it here without deleting it."
          />
        </div>
      ) : (
        <div className="mt-4">
          <StoryArchiveBody onCount={setStoryCount} />
        </div>
      )}
    </div>
  );
}
