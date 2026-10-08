"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoryArchiveBody } from "@/components/stories/story-archive-body";

/**
 * Story archive (§19/§25) — grouped by month/year, tap to reopen in the viewer.
 *
 * The body lives in `StoryArchiveBody` because Archive is also a section inside
 * `/archived` (§12: Posts + Stories). This route keeps its own header and its
 * back button, so two entry points share one implementation.
 */
export default function StoryArchivePage() {
  const router = useRouter();

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

      <StoryArchiveBody showHeader={false} />
    </div>
  );
}
