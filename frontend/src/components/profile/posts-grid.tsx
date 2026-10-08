"use client";

import Link from "next/link";
import { CalendarDays, Heart, MessageCircle, Type } from "lucide-react";
import type { FeedPostData } from "@/components/feed/types";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { cn } from "@/lib/utils";

/**
 * Instagram-style grid of a user's posts.
 * Image posts show their first photo; text posts show a text tile.
 */
export function PostsGrid({ posts }: { posts: FeedPostData[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2.5">
      {posts.map((p) => {
        const img = p.images?.[0];
        const isEvent = Boolean(p.event);
        return (
          <Link
            key={p._id}
            href={`/post/${p._id}`}
            className={cn(
              "group relative aspect-square overflow-hidden rounded-lg border border-border",
              !img && "bg-gradient-to-br from-brand-light to-purple-light"
            )}
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <OptimizedImage
                src={img}
                alt={p.content ? p.content.slice(0, 60) : "Post photo"}
                preset="post"
                size="small"
                aspectRatio="1 / 1"
                sizes="(max-width: 640px) 33vw, 220px"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full flex-col justify-between p-3">
                <span className="line-clamp-5 text-[13px] font-medium leading-snug text-foreground">
                  {p.content || "—"}
                </span>
                {isEvent && (
                  <span className="mt-auto flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                    <CalendarDays className="h-3 w-3" /> Event
                  </span>
                )}
              </div>
            )}

            {/* hover overlay with real counts */}
            <div className="absolute inset-0 flex items-center justify-center gap-4 bg-navy/60 opacity-0 transition-opacity group-hover:opacity-100">
              {img && p.content && (
                <span className="absolute inset-x-3 top-3 line-clamp-2 text-left text-xs font-medium text-white">
                  {p.content}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                <Heart className="h-4 w-4 fill-white" /> {p.likeCount}
              </span>
              <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                <MessageCircle className="h-4 w-4 fill-white" /> {p.commentCount}
              </span>
              {!img && (
                <span className="absolute bottom-3 right-3 text-white/70">
                  <Type className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
