"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, MoreVertical, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { UserAvatar } from "@/components/user-avatar";
import type { StoryItem, StoryAuthor } from "@/hooks/use-social";
import { timeAgo } from "@/lib/social";

const IMAGE_MS = 5000;

/**
 * Full-screen story viewer (§11, §18).
 *
 * 9:16 portrait canvas — a landscape story is letterboxed rather than cropped,
 * so no face or detail is cut off to make the frame fit.
 *
 * Interaction model follows the convention users already have: tap right to
 * advance, tap left to go back, press-and-hold to pause, swipe down to close.
 * The timer pauses on hold and on tab-blur, so a story never "expires" while
 * the reader is looking away.
 */
export interface StoryViewerProps {
  stories: StoryItem[];
  author?: StoryAuthor | null;
  startIndex?: number;
  onClose: () => void;
  onViewed?: (storyId: string) => void;
  onDelete?: (storyId: string) => void;
  canDelete?: boolean;
  /** Category grouping the viewer was opened from, for the context label. */
  contextLabel?: string;
}

export function StoryViewer({
  stories,
  author,
  startIndex = 0,
  onClose,
  onViewed,
  onDelete,
  canDelete,
  contextLabel,
}: StoryViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const elapsedRef = useRef(0);
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const story = stories[index];
  const authorName = author
    ? `${author.firstName || ""} ${author.lastName || ""}`.trim() || author.username || "Unknown"
    : "Story";

  const markViewed = useCallback(
    (s?: StoryItem) => {
      if (s && !s.viewedByMe) onViewed?.(s._id);
    },
    [onViewed]
  );

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = i + delta;
        if (next < 0) return 0;
        if (next >= stories.length) {
          onClose();
          return i;
        }
        return next;
      });
    },
    [stories.length, onClose]
  );

  /* Progress + auto-advance, driven by rAF so it stays smooth and pauses
     exactly where the reader paused it. */
  useEffect(() => {
    if (!story) return;
    setReady(false);
    setProgress(0);
    elapsedRef.current = 0;
    markViewed(story);
  }, [story, markViewed]);

  useEffect(() => {
    if (paused || !story) return;
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = elapsedRef.current + (now - startRef.current);
      const pct = Math.min(100, (elapsed / IMAGE_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        elapsedRef.current = 0;
        go(1);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (startRef.current) elapsedRef.current += performance.now() - startRef.current;
    };
  }, [story, paused, go]);

  // Never advance while the tab is hidden — a story shouldn't run in the background.
  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    document.addEventListener("keydown", onKey);
    // Stop the page behind the viewer from scrolling.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, go]);

  if (!story) return null;

  const isVideo = story.media.type === "video";

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/92 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`${authorName}'s story`}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
        setPaused(true);
      }}
      onTouchEnd={(e) => {
        const start = touchRef.current;
        touchRef.current = null;
        setPaused(false);
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        const quick = Date.now() - start.t < 600;
        if (dy > 110 && Math.abs(dy) > Math.abs(dx)) return onClose(); // swipe down
        if (Math.abs(dx) > 60) return go(dx < 0 ? 1 : -1); // swipe sideways
        if (!quick && Math.abs(dx) < 10 && Math.abs(dy) < 10) return; // a hold, already handled
      }}
    >
      {/* Desktop side arrows */}
      <button
        type="button"
        onClick={() => go(-1)}
        disabled={index === 0}
        className="absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-25 md:block"
        aria-label="Previous story"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        className="absolute right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20 md:block"
        aria-label="Next story"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      <div className="relative flex h-full w-full max-w-[30rem] flex-col sm:h-[92vh] sm:max-h-[54rem]">
        {/* Progress bars (§18) */}
        <div className="absolute left-0 right-0 top-0 z-20 flex gap-1 px-2 pt-safe">
          <div className="mt-2 flex w-full gap-1">
            {stories.map((s, i) => (
              <div key={s._id} className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-white/30">
                <div
                  className="story-progress h-full rounded-full bg-white"
                  style={{
                    transform: `scaleX(${i < index ? 1 : i === index ? progress / 100 : 0})`,
                    animationDuration: i === index && !paused ? `${IMAGE_MS}ms` : undefined,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="absolute left-0 right-0 top-0 z-20 flex items-center gap-2 px-3 pb-3 pt-8">
          <UserAvatar
            user={{ firstName: author?.firstName, lastName: author?.lastName, profile: author?.profile }}
            size={34}
            className="ring-2 ring-white/70"
          />
          <div className="min-w-0 flex-1">
            {author?._id ? (
              <Link href={`/profile/${author.username || author._id}`} className="block truncate text-[13px] font-bold text-white hover:underline">
                {authorName}
                {author.verified ? <Icon name="verified" size={13} filled className="ml-0.5 inline align-[-1px] text-white" /> : null}
              </Link>
            ) : (
              <span className="block truncate text-[13px] font-bold text-white">{authorName}</span>
            )}
            <span className="text-[11px] text-white/70">
              {timeAgo(story.createdAt)}
              {contextLabel ? ` · ${contextLabel}` : ""}
            </span>
          </div>
          {!ready ? <Loader2 className="h-4 w-4 animate-spin text-white/70" /> : null}
          {canDelete ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-full p-1.5 text-white/90 hover:bg-white/15"
                aria-label="Story options"
                aria-expanded={menuOpen}
              >
                <MoreVertical className="h-5 w-5" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-9 w-36 overflow-hidden rounded-lg border border-white/15 bg-[rgba(20,24,40,0.96)] py-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete?.(story._id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-red-300 hover:bg-white/10"
                  >
                    <Trash2 className="h-4 w-4" /> Delete story
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white hover:bg-white/15" aria-label="Close story">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Media — tap zones layered over the canvas.
            `key={story._id}` + `animate-viewer-in` gives the story-to-story
            swap a 200ms enter (scale 1.03 → 1, fade) instead of an instant
            frame change. The keyframes had been in globals.css unused since
            they were written (docs/PHASE4_FEED_AUDIT.md F3), and the overlay
            itself only faded in ONCE, on open. Reduced-motion neutralises it
            globally via the existing @media block. */}
        <div
          key={story._id}
          className="relative flex-1 overflow-hidden bg-black animate-viewer-in"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width * 0.3) go(-1);
            else go(1);
          }}
        >
          {isVideo ? (
            <video
              src={story.media.url}
              poster={story.media.poster}
              className="h-full w-full object-contain"
              autoPlay
              playsInline
              muted={false}
              onLoadedData={() => setReady(true)}
              onEnded={() => go(1)}
            />
          ) : (
            // object-contain, never object-cover: §11 "Do not crop important
            // faces/content unnecessarily."
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={story.media.url}
              alt={story.caption || `${authorName}'s story`}
              className="h-full w-full object-contain"
              onLoad={() => setReady(true)}
              draggable={false}
            />
          )}

          {/* Text overlay (§17) */}
          {story.textOverlay ? (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-2xl font-extrabold leading-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              {story.textOverlay}
            </p>
          ) : null}

          {/* Caption */}
          {story.caption ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-16 pt-10">
              <p className="text-[15px] text-white">{story.caption}</p>
            </div>
          ) : null}

          {/* Event link (§35-adjacent: stories understand event context) */}
          {story.event?.slug ? (
            <Link
              href={`/events/${story.event.slug}`}
              className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full border border-white/40 bg-white/15 px-4 py-2 text-[13px] font-semibold text-white backdrop-blur hover:bg-white/25"
            >
              View {story.event.title || "event"}
            </Link>
          ) : null}
        </div>

        {/* Owner view count */}
        {canDelete ? (
          <div className="flex items-center justify-center gap-1.5 bg-black/80 py-2 text-[12px] text-white/80">
            <Icon name="visibility" size={14} />
            {story.viewsCount ?? 0} {(story.viewsCount ?? 0) === 1 ? "view" : "views"}
            {story.archived ? <span className="ml-2 rounded-full bg-white/15 px-2 py-0.5 text-[10px]">Archived</span> : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
