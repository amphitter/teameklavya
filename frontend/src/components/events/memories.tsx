"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Heart, ImagePlus, Loader2, MessageCircle, Users, X } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { compactCount } from "@/lib/social";
import { cloudinaryUrl } from "@/utils/image";
import { cn } from "@/lib/utils";
import type { FeedPostData } from "@/components/feed/types";

const MAX_IMAGES = 4;

/**
 * Event channel (Part 3, Phase 6) — the per-event discussion space.
 * Every public event has one automatically: posts attached to the event
 * (photos + thoughts) with a share-your-own composer. Participants can
 * post to the participants-only channel; everyone can share publicly.
 */
export function Memories({
  eventId,
  eventSlug,
  eventTitle,
  status,
  isParticipant = false,
  pageSize = 6,
  showViewAll = false,
}: {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  status: "upcoming" | "ongoing" | "past";
  /** Registered participant (or organizer) — may post to the participants-only channel */
  isParticipant?: boolean;
  pageSize?: number;
  showViewAll?: boolean;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState<FeedPostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // composer
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // Participants-only channel (default for participants) vs public share
  const [participantsOnly, setParticipantsOnly] = useState(isParticipant);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/posts/event/${eventId}`, { params: { limit: pageSize } })
      .then((r) => {
        setPosts(r.data?.posts || []);
        setHasMore(Boolean(r.data?.hasMore));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventId, pageSize]);

  useEffect(load, [load]);

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    api
      .get(`/posts/event/${eventId}`, { params: { limit: pageSize, page: Math.ceil(posts.length / pageSize) + 1 } })
      .then((r) => {
        setPosts((p) => [...p, ...(r.data?.posts || [])]);
        setHasMore(Boolean(r.data?.hasMore));
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_IMAGES - images.length;
    const list = Array.from(files).slice(0, room);
    if (list.length < files.length) toast.info(`Up to ${MAX_IMAGES} photos per memory`);
    if (!list.length) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const f of list) {
        const fd = new FormData();
        fd.append("file", f);
        const res = await api.post("/upload/image?folder=posts", fd, { headers: { "Content-Type": "multipart/form-data" } });
        if (res.data?.success && res.data.url) uploaded.push(res.data.url);
      }
      if (uploaded.length) setImages((p) => [...p, ...uploaded].slice(0, MAX_IMAGES));
    } catch {
      toast.error("Photo upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const share = async () => {
    const content = text.trim();
    if ((!content && images.length === 0) || posting) return;
    setPosting(true);
    try {
      const res = await api.post("/posts", {
        content,
        images,
        eventId,
        visibility: participantsOnly ? "event_participants" : "public",
      });
      if (res.data?.success) {
        toast.success("Memory shared");
        setOpen(false);
        setText("");
        setImages([]);
        load();
      } else {
        throw new Error(res.data?.message);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Couldn't share memory");
    } finally {
      setPosting(false);
    }
  };

  const openComposer = () => {
    const auth = typeof window !== "undefined" && localStorage.getItem("token");
    if (!auth) {
      router.push(`/login?returnUrl=${encodeURIComponent(`/events/${eventSlug}`)}`);
      return;
    }
    setOpen(true);
  };

  // The channel exists for every event — upcoming included

  const photoCount = posts.reduce((n, p) => n + (p.images?.length || 0), 0);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Camera className="h-5 w-5 text-purple" /> Discussion & memories
          </h2>
          {posts.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {posts.length} {posts.length === 1 ? "post" : "posts"} · {photoCount} {photoCount === 1 ? "photo" : "photos"} from this event
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={openComposer} className="gap-1.5">
          <ImagePlus className="h-4 w-4" /> Post to channel
        </Button>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
            <Camera className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-semibold text-foreground">
              {status === "past" ? "No memories yet — be the first!" : "Start the conversation"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              {status === "past"
                ? `Were you at ${eventTitle}? Post your photos and thoughts — they'll live on the event page and your profile.`
                : "Post photos and updates while the event is live."}
            </p>
            <Button size="sm" className="mt-4 gap-1.5" onClick={openComposer}>
              <ImagePlus className="h-4 w-4" /> Share the first memory
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {posts.map((p) =>
                p.images?.length > 0 ? (
                  <Link
                    key={p._id}
                    href={`/post/${p._id}`}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cloudinaryUrl(p.images[0], { w: 500, h: 500 })}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {p.images.length > 1 && (
                      <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                        1/{p.images.length}
                      </span>
                    )}
                    {p.content && (
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-6 text-[11px] font-medium text-white">
                        {p.content}
                      </span>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center gap-4 bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="inline-flex items-center gap-1 text-xs font-bold">
                        <Heart className="h-4 w-4" /> {compactCount(p.likeCount || 0)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-bold">
                        <MessageCircle className="h-4 w-4" /> {compactCount(p.commentCount || 0)}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <Link
                    key={p._id}
                    href={`/post/${p._id}`}
                    className="group flex aspect-square flex-col justify-between rounded-xl border border-border bg-gradient-to-br from-brand-light to-purple-light p-3.5 transition-shadow hover:shadow-md"
                  >
                    <p className={cn("line-clamp-5 text-sm font-medium leading-snug text-foreground")}>{p.content}</p>
                    <p className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate">
                        {p.author?.firstName} {p.author?.lastName}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Heart className="h-3 w-3" /> {compactCount(p.likeCount || 0)}
                      </span>
                    </p>
                  </Link>
                )
              )}
            </div>

            <div className="mt-4 flex justify-center">
              {hasMore ? (
                <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more memories"}
                </Button>
              ) : showViewAll ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/events/${eventSlug}/memories`}>View all memories →</Link>
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* ── Composer dialog ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Post to this event · {eventTitle}</DialogTitle>
          </DialogHeader>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="How was it? Share a moment, a win, a thank-you…"
            className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
          />
          {images.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {images.map((url) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cloudinaryUrl(url, { w: 200, h: 200 })} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((p) => p.filter((x) => x !== url))}
                    aria-label="Remove photo"
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {uploading ? "Uploading…" : `Photos (${images.length}/${MAX_IMAGES})`}
                </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
              </label>
              <button
                type="button"
                onClick={() => setParticipantsOnly((v) => !v)}
                disabled={!isParticipant}
                title={isParticipant ? "" : "Only participants can post to the participants-only channel"}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  participantsOnly
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                } ${!isParticipant ? "opacity-50" : ""}`}
              >
                <Users className="h-3.5 w-3.5" />
                {participantsOnly ? "Participants only" : "Public"}
              </button>
            </div>
            <Button onClick={share} disabled={posting || uploading || (!text.trim() && images.length === 0)} className="font-semibold">
              {posting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sharing…
                </>
              ) : (
                "Post"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
