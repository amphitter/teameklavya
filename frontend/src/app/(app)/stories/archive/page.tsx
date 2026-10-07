"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Icon } from "@/components/ui/icon";
import { StoryViewer } from "@/components/stories/story-viewer";
import { useStoryArchive, useDeleteStory, type StoryItem } from "@/hooks/use-social";
import { storyCategoryIcon } from "@/lib/story-categories";

/**
 * Story archive (§19).
 *
 * Grouped by month/year, tap to reopen in the viewer. Expired stories stay
 * reachable here — the archive is the reason a 24h story is not simply lost.
 */
export default function StoryArchivePage() {
  const router = useRouter();
  const { groups, isLoading, error, refetch } = useStoryArchive();
  const del = useDeleteStory();
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState(0);

  const flat = groups.flatMap((g) => g.stories);

  return (
    <div className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-4">
      <header className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="h-9 w-9 p-0" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-headline-sm font-bold tracking-tight text-on-surface">Archive</h1>
          <p className="text-[12px] text-on-surface-variant">Stories you've posted, kept after their 24 hours.</p>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-6">
          {[0, 1].map((g) => (
            <div key={g}>
              <Skeleton className="mb-2 h-4 w-32" />
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Could not load your archive." onRetry={() => refetch()} />
      ) : !groups.length ? (
        <EmptyState
          icon={Archive}
          title="No archived stories yet"
          description="Stories you post appear here once their 24 hours are up — nothing is deleted."
        />
      ) : (
        <div className="space-y-7">
          {groups.map((g, gi) => (
            <section key={g.key}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-title-md font-bold text-on-surface">{g.label}</h2>
                <span className="text-[11px] font-semibold text-on-surface-variant">
                  {g.stories.length} {g.stories.length === 1 ? "story" : "stories"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {g.stories.map((s: StoryItem, i) => {
                  const idx = flat.indexOf(s);
                  return (
                    <div key={s._id} className="group relative">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenGroup(gi);
                          setOpenIndex(i);
                        }}
                        className="relative block w-full overflow-hidden rounded-xl border border-outline-variant bg-surface-container"
                        aria-label={`Open story from ${g.label}`}
                      >
                        <span className="block aspect-[9/16] w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={s.media.poster || s.media.url}
                            alt={s.caption || "Archived story"}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </span>
                        {s.media.type === "video" ? (
                          <Icon name="play_arrow" size={20} filled className="absolute left-1.5 top-1.5 text-white drop-shadow" />
                        ) : null}
                        {s.category ? (
                          <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">
                            <Icon name={storyCategoryIcon(s.category)} size={10} className="mr-0.5 align-[-1px]" />
                            {s.category}
                          </span>
                        ) : null}
                        {s.archived ? (
                          <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">
                            Expired
                          </span>
                        ) : (
                          <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-white">
                            Live
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm("Delete this story permanently?")) return;
                          const res = await del.mutate(s._id);
                          if (res) toast.success("Story deleted");
                          else toast.error("Couldn't delete that story");
                          setOpenGroup(null);
                        }}
                        className="absolute right-1 bottom-1 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label="Delete story"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {openGroup !== null && groups[openGroup] ? (
        <StoryViewer
          stories={groups[openGroup].stories}
          startIndex={openIndex}
          canDelete
          contextLabel={groups[openGroup].label}
          onClose={() => setOpenGroup(null)}
          onDelete={async (id) => {
            const res = await del.mutate(id);
            if (res) toast.success("Story deleted");
            else toast.error("Couldn't delete that story");
            setOpenGroup(null);
          }}
        />
      ) : null}
    </div>
  );
}
