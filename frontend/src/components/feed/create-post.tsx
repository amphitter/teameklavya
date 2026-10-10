"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarDays, ChevronDown, Globe, ImagePlus, Loader2, MapPin, MoreHorizontal, Plus, Send, Tag, Users, Video, Vote, X } from "lucide-react";
import { api } from "@/utils/api";
import { compressFor } from "@/utils/compress-image";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cn } from "@/lib/utils";
import { hasPlatformAdminAccess } from "@/lib/superAdmin";
import type { FeedEventData, FeedPostData } from "@/components/feed/types";
import { TagPeoplePicker } from "@/components/post/tag-people-picker";
import type { PersonResult } from "@/components/people/use-people-search";

const MAX_IMAGES = 4;

export function CreatePost({
  onCreated,
  composerRef,
  showGuestCard = true,
  variant = "inline",
  onClose,
}: {
  onCreated: (post: FeedPostData) => void;
  composerRef?: React.RefObject<HTMLDivElement | null>;
  showGuestCard?: boolean;
  variant?: "inline" | "modal";
  onClose?: () => void;
}) {
  const { user, role } = useSessionUser();
  const canAttachEvent = hasPlatformAdminAccess(role, user);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [event, setEvent] = useState<FeedEventData | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tagged, setTagged] = useState<PersonResult[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "followers" | "event_participants">("public");

  const canSubmit = (content.trim().length > 0 || images.length > 0 || event) && !submitting && !uploading;

  useEffect(() => {
    if (variant === "modal") textareaRef.current?.focus();
  }, [variant]);

  const openComposer = () => {
    composerRef?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => textareaRef.current?.focus(), 250);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_IMAGES - images.length;
    const list = Array.from(files).slice(0, room);
    if (list.length < files.length) toast.info(`Up to ${MAX_IMAGES} photos per post`);
    if (!list.length) return;

    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of list) {
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`${file.name} is larger than 5 MB`);
          continue;
        }
        const { file: toUpload } = await compressFor(file, "post");
        const fd = new FormData();
        fd.append("file", toUpload);
        const res = await api.post("/upload/image?folder=posts", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (res.data?.success && res.data.url) uploaded.push(res.data.url);
      }
      if (uploaded.length) setImages((p) => [...p, ...uploaded].slice(0, MAX_IMAGES));
    } catch {
      toast.error("Photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const toggleTag = (person: PersonResult) => {
    const handle = (person.username || "").trim();
    if (!handle) {
      toast.error("That person has no username yet");
      return;
    }
    const exists = tagged.some((t) => t._id === person._id);

    if (exists) {
      setTagged((prev) => prev.filter((t) => t._id !== person._id));
      setContent((c) => c.replace(new RegExp(`@${handle}(?![a-z0-9_])`, "i"), "").replace(/\s{2,}/g, " ").trim());
      return;
    }

    const token = `@${handle} `;
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart ?? content.length;
      const end = el.selectionEnd ?? content.length;
      const next = content.slice(0, start) + token + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      setContent((c) => (c ? `${c} ${token}` : token));
    }
    setTagged((prev) => [...prev, person]);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await api.post("/posts", {
        content: content.trim(),
        images,
        eventId: event?._id || undefined,
        visibility,
      });
      if (res.data?.success && res.data.post) {
        onCreated(res.data.post as FeedPostData);
        setContent("");
        setImages([]);
        setEvent(null);
        setTagged([]);
        setFocused(false);
        setVisibility("public");
        toast.success("Posted!");
        if (variant === "modal") onClose?.();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to post");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    if (!showGuestCard) return null;
    return (
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold text-foreground">Join the conversation</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Share event updates, photos and memories — right where the community is.
        </p>
        <div className="mt-3.5 flex gap-2">
          <Button asChild size="sm">
            <Link href="/login?returnUrl=%2F">Sign in to post</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/signup">Create account</Link>
          </Button>
        </div>
      </div>
    );
  }

  const visibilityOptions = [
    { id: "public" as const, icon: Globe, label: "Public", title: "Everyone can see this post" },
    { id: "followers" as const, icon: Users, label: "Followers", title: "Only your followers" },
    ...(event ? [{ id: "event_participants" as const, icon: CalendarDays, label: "Participants", title: "Only event participants" }] : []),
  ];

  const surface = (
    <div
      ref={composerRef}
      className={cn(
        variant === "inline" && "rounded-xl border border-border bg-card p-4 sm:p-5",
        variant === "modal" && "p-0"
      )}
    >
      <div className="flex gap-3 min-w-0">
        <div className="shrink-0">
          <UserAvatar user={user} size={40} />
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onFocus={() => setFocused(true)}
          rows={focused ? 3 : 1}
          maxLength={2000}
          placeholder="What's happening?"
          aria-label="Write a post"
          className="min-h-[44px] flex-1 min-w-0 resize-none rounded-lg border-0 bg-transparent py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {(images.length > 0 || uploading) && (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:pl-[52px]">
          {images.map((url) => (
            <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setImages((p) => p.filter((u) => u !== url))}
                aria-label="Remove photo"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {uploading && (
            <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border bg-muted">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {event && (
        <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-primary/30 bg-brand-light px-3 py-2.5 sm:ml-[52px]">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{event.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {new Date(event.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {event.eventType === "online" ? "Online" : event.venue || "In person"}
            </p>
          </div>
          <button type="button" onClick={() => setEvent(null)} aria-label="Remove event" className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {(focused || content.length > 0) && (
        <p className="mt-1.5 text-right text-[11px] text-muted-foreground sm:pl-[52px]"> {content.length} / 2000 </p>
      )}

      {tagged.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 sm:pl-[52px]">
          {tagged.map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => toggleTag(p)}
              aria-label={`Remove tag for ${p.username || p.firstName}`}
              className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary shrink-0"
            >
              @{p.username || p.firstName}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Actions – Fixed responsive layout ───────────────────────────
         Desktop (768+): Preserve current design – visibility left, actions
         middle, Post right, single horizontal row, no shrinking/clipping.
         Mobile (320-767): Two balanced rows – Row1: visibility + Post (space-between),
         Row2: action icons with adequate touch targets. No ellipsis for primary
         actions; secondary (Video/Poll) in overflow only when needed. Allows
         vertical growth instead of squeezing into one row. Uses min-w-0, shrink-0
         correctly, no overflow-x hidden. */}
      <div className="mt-3 border-t border-border pt-3">
        {/* Desktop layout – single row, unchanged visual, all controls visible */}
        <div className="hidden sm:flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex shrink-0 overflow-hidden rounded-full border border-border" role="group" aria-label="Post visibility">
              {visibilityOptions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVisibility(v.id)}
                  aria-pressed={visibility === v.id}
                  title={v.title}
                  className={cn(
                    "flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold transition-colors shrink-0 min-h-[32px]",
                    visibility === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <v.icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{v.label}</span>
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-border shrink-0 hidden lg:block" />

            <div className="flex items-center gap-1 min-w-0 flex-wrap">
              <button
                type="button"
                onClick={() => setTagOpen(true)}
                aria-label="Tag people"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                title="Tag people"
              >
                <Tag className="h-[18px] w-[18px] shrink-0" />
                {tagged.length > 0 ? <span className="ml-0.5 text-[11px] font-bold">{tagged.length}</span> : null}
              </button>

              <label
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                title="Add photos"
              >
                <ImagePlus className="h-[18px] w-[18px] shrink-0" />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    onFiles(e.target.files);
                    e.target.value = "";
                  }}
                  disabled={images.length >= MAX_IMAGES}
                />
              </label>

              {canAttachEvent && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                  title="Attach an event"
                >
                  <CalendarDays className="h-[18px] w-[18px] shrink-0" />
                </button>
              )}

              <span className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-lg text-muted-foreground/50" title="Video – Coming soon">
                <Video className="h-[18px] w-[18px] shrink-0" />
              </span>
              <span className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-lg text-muted-foreground/50" title="Poll – Coming soon">
                <Vote className="h-[18px] w-[18px] shrink-0" />
              </span>
            </div>
          </div>

          <Button size="sm" onClick={submit} disabled={!canSubmit} className="shrink-0 gap-1.5">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {submitting ? "Posting…" : "Post"}
          </Button>
        </div>

        {/* Mobile layout – two balanced rows, compact but accessible, no ellipsis for primary */}
        <div className="flex flex-col gap-3 sm:hidden min-w-0">
          {/* Row 1: Visibility + Post – space-between, both visible, readable labels */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <MobileVisibilitySelector visibility={visibility} setVisibility={setVisibility} hasEvent={!!event} />
            </div>
            <Button size="sm" onClick={submit} disabled={!canSubmit} className="shrink-0 gap-1.5 h-9 px-4 text-[13px] font-medium min-w-[64px]">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {submitting ? "Posting…" : "Post"}
            </Button>
          </div>

          {/* Row 2: Action controls – balanced, 36px touch targets, centered icons, no overlap */}
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <button
              type="button"
              onClick={() => setTagOpen(true)}
              aria-label="Tag people"
              className="flex h-9 min-w-[44px] items-center justify-center gap-1 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary shrink-0"
              title="Tag people"
            >
              <Tag className="h-[18px] w-[18px] shrink-0" />
              <span className="text-[12px] font-medium">Tag</span>
              {tagged.length > 0 ? <span className="text-[11px] font-bold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 ml-0.5 min-w-[18px] text-center">{tagged.length}</span> : null}
            </button>

            <label
              className="flex h-9 min-w-[44px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary shrink-0"
              title="Add photos"
            >
              <ImagePlus className="h-[18px] w-[18px] shrink-0" />
              <span className="text-[12px] font-medium">Photo</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  onFiles(e.target.files);
                  e.target.value = "";
                }}
                disabled={images.length >= MAX_IMAGES}
              />
            </label>

            {canAttachEvent && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex h-9 min-w-[44px] items-center justify-center gap-1 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary shrink-0"
                title="Attach an event"
              >
                <CalendarDays className="h-[18px] w-[18px] shrink-0" />
                <span className="text-[12px] font-medium">Event</span>
              </button>
            )}

            {/* Secondary actions – still visible on mobile, not hidden behind ellipsis */}
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-border bg-card text-muted-foreground/50" title="Video – Coming soon">
                <Video className="h-[18px] w-[18px] shrink-0" />
              </span>
              <span className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-border bg-card text-muted-foreground/50" title="Poll – Coming soon">
                <Vote className="h-[18px] w-[18px] shrink-0" />
              </span>
            </div>
          </div>

          {/* Row 3: Only shown at 320px when needed – overflow menu for extra actions, keeps main controls visible */}
          <div className="hidden [320px]:flex min-[321px]:hidden items-center gap-1">
            <span className="text-[11px] text-muted-foreground">More:</span>
            <MobileOverflowMenu canAttachEvent={false} onAttachEvent={() => setPickerOpen(true)} />
          </div>
        </div>
      </div>

      <TagPeoplePicker open={tagOpen} onClose={() => setTagOpen(false)} selected={tagged} onToggle={toggleTag} />

      <EventPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(ev) => {
          setEvent(ev);
          setPickerOpen(false);
        }}
      />
    </div>
  );

  if (variant === "modal") {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose?.()}>
        <DialogContent className={cn("flex flex-col gap-3 p-4", "h-[100dvh] max-h-none w-screen max-w-none rounded-none", "sm:h-auto sm:max-h-[85vh] sm:w-[calc(100vw-2rem)] sm:max-w-lg sm:rounded-xl sm:p-5")}>
          <DialogHeader className="text-left">
            <DialogTitle>Create Post</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">{surface}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return surface;
}

function MobileVisibilitySelector({
  visibility,
  setVisibility,
  hasEvent,
}: {
  visibility: "public" | "followers" | "event_participants";
  setVisibility: (v: "public" | "followers" | "event_participants") => void;
  hasEvent: boolean;
}) {
  const options = [
    { id: "public" as const, icon: Globe, label: "Public" },
    { id: "followers" as const, icon: Users, label: "Followers" },
    ...(hasEvent ? [{ id: "event_participants" as const, icon: CalendarDays, label: "Participants" }] : []),
  ];
  const current = options.find((o) => o.id === visibility) || options[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted min-w-0 max-w-[160px] shrink-0"
          aria-label={`Visibility: ${current.label}`}
        >
          <current.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {options.map((opt) => (
          <DropdownMenuItem key={opt.id} onClick={() => setVisibility(opt.id)} className="gap-2 py-2.5">
            <opt.icon className="h-4 w-4" />
            <span>{opt.label}</span>
            {visibility === opt.id ? <span className="ml-auto text-[10px] font-bold text-primary">✓</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileOverflowMenu({ canAttachEvent, onAttachEvent }: { canAttachEvent: boolean; onAttachEvent: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More post options"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
        >
          <MoreHorizontal className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {canAttachEvent ? (
          <DropdownMenuItem onClick={onAttachEvent} className="gap-2 py-2.5">
            <CalendarDays className="h-4 w-4" /> Attach an event
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled className="gap-2 py-2.5">
          <Video className="h-4 w-4" /> Video <span className="ml-auto text-[10px] font-bold">Soon</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="gap-2 py-2.5">
          <Vote className="h-4 w-4" /> Poll <span className="ml-auto text-[10px] font-bold">Soon</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EventPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (ev: FeedEventData) => void }) {
  const [events, setEvents] = useState<FeedEventData[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get("/events/admin/list", { params: { search: query || undefined, limit: 20 } })
      .then((res) => setEvents(res.data?.events || []))
      .catch(() => toast.error("Couldn't load your events"))
      .finally(() => setLoading(false));
  }, [open, query]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach an event</DialogTitle>
        </DialogHeader>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your events…" />
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
          {!loading && events.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No events found. Only public events can be shared.</p>}
          {events.map((ev) => (
            <button
              key={ev._id}
              type="button"
              onClick={() => onPick(ev)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 min-w-0"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {ev.bannerUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ev.bannerUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <CalendarDays className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{ev.title}</p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                  <MapPin className="h-3 w-3 shrink-0" /> {ev.eventType === "online" ? "Online" : ev.venue || "In person"}
                </p>
              </div>
              <Plus className="h-4 w-4 shrink-0 text-primary" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
