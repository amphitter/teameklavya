"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { api } from "@/utils/api";

/**
 * Story rail — event-native stories.
 * Until a story backend exists, the circles are REAL category shortcuts
 * (from /events/meta/categories) that filter event discovery.
 * "Your story" focuses the composer. No fabricated story data.
 */
export function StoryRail({ onYourStory }: { onYourStory?: () => void }) {
  const router = useRouter();
  const [categories, setCategories] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/events/meta/categories")
      .then((res) => {
        if (!cancelled) setCategories((res.data?.categories || []).slice(0, 8));
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to show yet (no categories in the system)
  if (failed || categories.length === 0) return null;

  return (
    <div className="no-scrollbar -mx-1 flex gap-4 overflow-x-auto px-1 pb-1">
      {/* Your story → composer */}
      <button
        type="button"
        onClick={onYourStory}
        className="flex w-16 shrink-0 flex-col items-center gap-1.5"
        aria-label="Share to your feed"
      >
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-muted shadow-sm transition-transform active:scale-95">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-card">
            <Plus className="h-6 w-6 text-primary" />
          </span>
          <span className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary shadow-md">
            <Plus className="h-3 w-3 text-primary-foreground" />
          </span>
        </span>
        <span className="w-full truncate text-center text-[11px] font-medium text-foreground">Add Story</span>
      </button>

      {categories.map((cat) => (
        <button
          key={cat}
          type="button"
          onClick={() => router.push(`/explore?category=${encodeURIComponent(cat)}`)}
          className="flex w-16 shrink-0 flex-col items-center gap-1.5 transition-transform active:scale-95"
        >
          <span className="rounded-full bg-gradient-to-tr from-[#2563FF] via-[#6C35FF] to-[#D946EF] p-[2.5px]">
            <span className="flex h-[57px] w-[57px] items-center justify-center rounded-full border-2 border-card bg-card text-sm font-extrabold text-primary">
              {cat.slice(0, 2).toUpperCase()}
            </span>
          </span>
          <span className="w-full truncate text-center text-[11px] font-medium text-foreground">{cat}</span>
        </button>
      ))}
    </div>
  );
}
