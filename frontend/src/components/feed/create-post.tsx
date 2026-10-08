"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarDays, Globe, ImagePlus, Loader2, MapPin, MoreHorizontal, Plus, Send, Tag, Users, Video, Vote, X } from "lucide-react";
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
import type { FeedEventData, FeedPostData } from "@/components/feed/types";
import { TagPeoplePicker } from "@/components/post/tag-people-picker";
import type { PersonResult } from "@/components/people/use-people-search";

const MAX_IMAGES = 4;

/**
 * Create-post composer.
 * Working: text + up to 4 photos (Cloudinary) + event attach (organizers).
 * Video/Poll are visible-but-disabled ("Soon") — architected, not fake.
 */
export function CreatePost({
  onCreated,
  composerRef,
  showGuestCard = true,
  variant = "inline",
  onClose,
}: {
  onCreated: (post: FeedPostData) => void;
  composerRef?: React.RefObject<HTMLDivElement | null>;
  /** Signed out: render the "Join the conversation" card. The feed turns it off
   *  when its own welcome card is already on screen, so the two do not stack. */
  showGuestCard?: boolean;
  /**
   * "inline" — the card that sits in the feed column.
   * "modal"  — the SAME composer in a dialog: centred on a desktop, full height
   *            on a phone. One implementation, two hosts, so a publish from
   *            anywhere behaves identically to a publish from the feed
   *            (Part 13 §5: no second post-creation implementation).
   */
  variant?: "inline" | "modal";
  /** Modal only: called after a successful publish, and on dismiss. */
  onClose?: () => void;
}) {
  const { user, role } = useSessionUser();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [event, setEvent] = useState<FeedEventData | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  /* People tagged in this post (Part 13 §9). Held as real user records, not
     free text, and mirrored into the content as @username so the backend's
     existing mention parser is what actually records them. */
  const [tagged, setTagged] = useState<PersonResult[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  // Post visibility (backend-enforced): public · followers · event participants
  const [visibility, setVisibility] = useState<"public" | "followers" | "event_participants">("public");

  const canSubmit = (content.trim().length > 0 || images.length > 0 || event) && !submitting && !uploading;

  /* Opening the composer from a "+" is a deliberate act — the caret belongs in
     the textarea, not one tap away from it. The inline feed composer keeps its
     existing focus-on-click behaviour. */
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
        // §20 — compress on-device before spending the user's mobile data.
        // A 10 MB phone photo becomes a ~1.5 MB / 1400px image; if compression
        // fails or doesn't help we upload the original (never block the user).
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

  /**
   * Tag / untag a person (Part 13 §9–§11).
   *
   * Tagging writes `@username` into the post at the caret, which is the input
   * the server already understands: `Post.mentions` is populated by parsing the
   * content, so the stored mention is a real user id and the notification is
   * created in the same transaction as the post — never for a failed or
   * abandoned draft.
   *
   * Untagging removes the handle again. Without that, removing a person from
   * the list would still notify them, which is the opposite of what the user
   * just asked for.
   */
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
      // Put the caret after the handle so the user keeps typing where they were.
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
        /* §8 — publish, then close. Not before: the button stays busy until the
           server has answered, so a double tap cannot post twice. */
        if (variant === "modal") onClose?.();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to post");
    } finally {
      setSubmitting(false);
    }
  };

  /* Signed out, this card and the feed's own "Welcome to EventHub" card said the
     same thing twice: measured stacked on the first screen at 360px, 174px of
     prose and four buttons between the search field and the first post. The feed
     passes `showGuestCard={false}` when it is already rendering the welcome card;
     this card still exists for any other caller that has no such notice. */
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

  /* The composer surface itself. Identical in both variants — the only change is
     the chrome around it, which is what keeps "post from Messages" and "post
     from the feed" the same feature rather than two. */
  const surface = (
    <div
      ref={composerRef}
      className={cn(
        variant === "inline" && "rounded-xl border border-border bg-card p-4 sm:p-5",
        variant === "modal" && "p-0"
      )}
    >
      <div className="flex gap-3">
        <UserAvatar user={user} size={40} />
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onFocus={() => setFocused(true)}
          rows={focused ? 3 : 1}
          maxLength={2000}
          placeholder="What's happening?"
          aria-label="Write a post"
          className="min-h-[44px] flex-1 resize-none rounded-lg border-0 bg-transparent py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Image previews */}
      {(images.length > 0 || uploading) && (
        <div className="mt-3 grid grid-cols-4 gap-2 pl-[52px]">
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

      {/* Attached event chip */}
      {event && (
        <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-primary/30 bg-brand-light px-3 py-2.5 pl-[52px] sm:pl-3">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{event.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {new Date(event.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ·{" "}
              {event.eventType === "online" ? "Online" : event.venue || "In person"}
            </p>
          </div>
          <button type="button" onClick={() => setEvent(null)} aria-label="Remove event" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Character counter (server limit 2000) */}
      {(focused || content.length > 0) && (
        <p className="mt-1.5 pl-[52px] text-right text-[11px] text-muted-foreground sm:pl-3">
          {content.length} / 2000
        </p>
      )}

      {/* Who is tagged — visible without opening the picker, removable in place */}
      {tagged.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-[52px] sm:pl-[52px]">
          {tagged.map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => toggleTag(p)}
              aria-label={`Remove tag for ${p.username || p.firstName}`}
              className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
            >
              @{p.username || p.firstName}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Actions ────────────────────────────────────────────────────────
         §11–§16 — THE TOOLBAR BUG, at its source.

         Measured before the fix, at a 390px viewport: the card's content box is
         326px, the row carried `pl-[52px]` (52px of indent borrowed from the
         avatar column above it) and then held a 3-button visibility control, a
         tag button, a photo button, an attach-event button, two disabled
         placeholders and the Post button — about 300px of controls plus gaps.
         The row could not shrink, so the LAST child, Post, was pushed past the
         card's edge and clipped; at 320px the visibility control itself was cut
         to a sliver. Nothing wrapped, nothing scrolled, it simply overflowed.

         What changed, all at the source rather than hidden with `overflow-x`:
           · the 52px indent is GONE on phones — the row starts where the card's
             content starts, which is also what §19 asks for (one width system);
           · `min-w-0` + `flex-wrap` so the row is allowed to be narrower than
             its contents instead of pushing them out of the card;
           · the Post button is `shrink-0` and sits in the normal flow;
           · secondary actions (attach event · video · poll) collapse into the
             "More" menu BELOW `sm` only. §16 asks for exactly this: "if the
             existing toolbar has more actions than can reasonably fit, use the
             existing supported More behavior rather than clipping buttons".
             Nothing is removed — every action is still one tap away, and from
             `sm` up they render inline exactly as they always did, so the
             desktop composer is unchanged (§26). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 border-t border-border pt-3 sm:gap-1.5">
        {/* Visibility — enforced by the backend */}
        <div
          className="flex shrink-0 overflow-hidden rounded-full border border-border sm:mr-1"
          role="group"
          aria-label="Post visibility"
        >
          {(
            [
              { id: "public" as const, icon: Globe, label: "Public", title: "Everyone can see this post" },
              { id: "followers" as const, icon: Users, label: "Followers", title: "Only your followers can see this post" },
              ...(event
                ? [{ id: "event_participants" as const, icon: CalendarDays, label: "Participants", title: "Only people registered for this event" }]
                : []),
            ]
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVisibility(v.id)}
              aria-pressed={visibility === v.id}
              title={v.title}
              className={cn(
                /* 30px wide on a phone (icon only), 36px tall so it is still a
                   real target, and it grows to the labelled pill from sm up.
                   Held at 30 rather than 36 because 320px is the binding
                   constraint: the whole row has to fit one line inside a 264px
                   content box, and 6px per pill is exactly what makes Post
                   wrap onto a second line. */
                "flex min-h-[36px] w-7 items-center justify-center gap-1 text-[11px] font-semibold transition-colors sm:w-auto sm:px-2.5 sm:py-1.5",
                visibility === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <v.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setTagOpen(true)}
          aria-label="Tag people"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary sm:h-auto sm:w-auto sm:p-2"
          title="Tag people"
        >
          <Tag className="h-[18px] w-[18px]" />
          {tagged.length > 0 ? <span className="text-[11px] font-bold">{tagged.length}</span> : null}
        </button>

        <label
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary sm:h-auto sm:w-auto sm:p-2"
          title="Add photos"
        >
          <ImagePlus className="h-[18px] w-[18px]" />
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

        {/* Secondary actions — INLINE FROM `sm` UP, exactly as before. */}
        {role === "admin" && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-primary sm:flex sm:items-center"
            title="Attach an event"
          >
            <CalendarDays className="h-[18px] w-[18px]" />
          </button>
        )}

        {/* Architected, not yet implemented */}
        <span
          className="hidden cursor-not-allowed items-center gap-1.5 rounded-lg p-2 text-muted-foreground/50 sm:flex"
          title="Coming soon"
        >
          <Video className="h-[18px] w-[18px]" />
        </span>
        <span
          className="hidden cursor-not-allowed items-center gap-1.5 rounded-lg p-2 text-muted-foreground/50 sm:flex"
          title="Coming soon"
        >
          <Vote className="h-[18px] w-[18px]" />
        </span>

        {/* Phones: the same three actions behind "More" (§16) — the row fits
            instead of clipping, and nothing is silently dropped. The menu is
            disabled-looking items included, so a user still learns what is
            coming rather than losing the affordance entirely. */}
        <SmMoreMenu
          canAttachEvent={role === "admin"}
          onAttachEvent={() => setPickerOpen(true)}
        />

        <Button size="sm" onClick={submit} disabled={!canSubmit} className="ml-auto shrink-0 gap-1.5">
          {/* The paper plane is hidden below `sm` — not as a style choice, but
              because it is 19px of the row's 262px budget at 320px, and losing
              it is what lets every control keep a real touch height instead of
              the row wrapping to a second line. The label stays, and from `sm`
              up the icon is back. */}
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="hidden h-3.5 w-3.5 sm:block" />
          )}
          {submitting ? "Posting…" : "Post"}
        </Button>
      </div>

      <TagPeoplePicker
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        selected={tagged}
        onToggle={toggleTag}
      />

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

  /* §6/§31 — the same surface, hosted as chrome. Centred dialog on a desktop; a
     full-height sheet on a phone, where a floating card would fight the keyboard
     and the bottom nav. `dvh` rather than `vh` so a collapsing URL bar cannot
     push the Post button off screen. */
  if (variant === "modal") {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose?.()}>
        <DialogContent
          className={cn(
            "flex flex-col gap-3 p-4",
            /* `max-h-none` matters: the shared DialogContent caps itself at
               90vh, and a phone composer that stops 10% short of the bottom
               looks like a sheet that failed to open and leaves a strip of the
               page showing through behind the keyboard. Truly full height on a
               phone, a compact centred card from `sm` up. */
            "h-[100dvh] max-h-none w-screen max-w-none rounded-none",
            "sm:h-auto sm:max-h-[85vh] sm:w-[calc(100vw-2rem)] sm:max-w-lg sm:rounded-xl sm:p-5"
          )}
        >
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

/* ── Event picker (organizers) ─────────────────────────────── */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach an event</DialogTitle>
        </DialogHeader>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your events…"
        />
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
          {!loading && events.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No events found. Only public events can be shared.</p>
          )}
          {events.map((ev) => (
            <button
              key={ev._id}
              type="button"
              onClick={() => onPick(ev)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
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
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {ev.eventType === "online" ? "Online" : ev.venue || "In person"}
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

/**
 * `sm:` and below only — the toolbar's overflow.
 *
 * §16 is explicit that if the row cannot hold every action without clipping,
 * the answer is a "More" affordance rather than a smaller touch target or a
 * hidden button. This is that affordance: one 36px control that opens the
 * actions which do not fit inline on a phone. From `sm` up it renders nothing,
 * because there the same actions are inline — so this cannot change desktop.
 */
function SmMoreMenu({
  canAttachEvent,
  onAttachEvent,
}: {
  canAttachEvent: boolean;
  onAttachEvent: () => void;
}) {
  return (
    <div className="sm:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More post options"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
          >
            <MoreHorizontal className="h-[18px] w-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
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
    </div>
  );
}
