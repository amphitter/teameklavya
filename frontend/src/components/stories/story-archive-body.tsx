"use client";

/**
 * The story archive's body — grouped by month, tap to reopen, delete.
 *
 * Extracted from the `/stories/archive` page because Archive is now ONE place
 * with two sections (§12: "archive with Posts/Stories sections"), and the same
 * grid has to render inside it. The page kept its own copy of this markup
 * otherwise, and a second copy is how the two archives drift apart — restore a
 * story in one and the other still shows it.
 *
 * Props exist for the two call sites only: `showHeader` is false when the
 * parent already draws a heading, and `onCount` lets the parent label its
 * "Stories" tab with the real number.
 */

import { useEffect, useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Icon } from "@/components/ui/icon";
import { StoryViewer } from "@/components/stories/story-viewer";
import { useStoryArchive, useDeleteStory, type StoryItem } from "@/hooks/use-social";
import { storyCategoryIcon } from "@/lib/story-categories";
import { cn } from "@/lib/utils";

export function StoryArchiveBody({
  showHeader = true,
  onCount,
  className,
}: {
  showHeader?: boolean;
  onCount?: (n: number) => void;
  className?: string;
}) {
  const { groups, isLoading, error, refetch } = useStoryArchive();
  const del = useDeleteStory();
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState(0);

  const flat = groups.flatMap((g) => g.stories);

  useEffect(() => {
    if (!isLoading) onCount?.(flat.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, flat.length]);

  return (
    <div className={cn("w-full", className)}>
      {showHeader ? (
        <p className="mb-3 text-[12px] text-on-surface-variant">
          Stories you&apos;ve posted, kept after their 24 hours.
        </p>
      ) : null}

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
          description="A story moves here 24 hours after you post it. Nothing is lost."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g, gi) => (
            <section key={g.label}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-title-md font-bold text-on-surface">{g.label}</h2>
                <span className="text-[11px] text-on-surface-variant">
                  {g.stories.length} {g.stories.length === 1 ? "story" : "stories"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {g.stories.map((s: StoryItem, i: number) => (
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
                        const res = await del.mutate(s._id);
                        if (res?.success) {
                          toast.success("Story deleted");
                          refetch();
                        } else {
                          toast.error("Couldn't delete that story");
                        }
                      }}
                      className="absolute right-1 top-1 hidden h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex focus-visible:flex"
                      aria-label="Delete story"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {openGroup !== null && groups[openGroup] ? (
        <StoryViewer
          stories={groups[openGroup].stories}
          startIndex={openIndex}
          contextLabel={groups[openGroup].label}
          canDelete
          onClose={() => setOpenGroup(null)}
          onDelete={async (id) => {
            const res = await del.mutate(id);
            if (res?.success) refetch();
            else toast.error("Couldn't delete that story");
          }}
        />
      ) : null}
    </div>
  );
}
