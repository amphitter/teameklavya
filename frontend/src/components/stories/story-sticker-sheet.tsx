"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Hash, Loader2, MapPin, Search, UserRound } from "lucide-react";
import { api } from "@/utils/api";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { displayNameOf, usePeopleSearch, type PersonResult } from "@/components/people/use-people-search";
import type { StoryLayer } from "@/components/stories/story-layer";

/**
 * Story stickers (Part 9 §20).
 *
 * Rule this file exists to keep: **a sticker must do something.** Every sticker
 * here ends in a real destination that EventHub already has —
 *
 *   mention  → a real user, found through the people search, linking to their profile
 *              (and stored in the story's `mentions`, so the tag is genuine)
 *   event    → a real event, found through the events API, linking to the event page
 *   hashtag   → a topic, linking to that topic's feed
 *   location → a label (EventHub has no place pages — an honest label beats a dead link)
 *
 * Poll and Question stickers are deliberately NOT offered: they would need a vote
 * or answer model that does not exist, and a sticker that collects nothing is
 * exactly the "fake sticker functionality" the brief forbids. They are listed in
 * the report as remaining rather than shipped as a prop.
 */

export type StickerChoice = {
  kind: StoryLayer["kind"];
  label: string;
  payload: StoryLayer["payload"];
};

const EMOJI = [
  "😀", "😂", "🥳", "😍", "🔥", "✨", "🎉", "💯",
  "🙌", "👏", "🚀", "💡", "🏆", "📸", "🎯", "❤️",
  "👀", "🤝", "☕", "🌈", "⚡", "🎓", "🧠", "🍕",
];

export function StoryEmojiTray({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="space-y-1.5 rounded-2xl bg-black/55 p-2 backdrop-blur-md">
      <div className="grid grid-cols-8 gap-1">
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            aria-label={`Add ${e}`}
            className="flex h-9 items-center justify-center rounded-lg text-xl transition hover:bg-white/15"
          >
            {e}
          </button>
        ))}
      </div>
      <p className="px-1 text-[11px] text-white/60">Tap an emoji, then drag it anywhere.</p>
    </div>
  );
}

export function StoryStickerSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (choice: StickerChoice) => void;
}) {
  const [kind, setKind] = useState<null | "mention" | "event" | "hashtag" | "location">(null);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");

  useEffect(() => {
    if (!open) {
      setKind(null);
      setQuery("");
      setLocation("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 p-4 sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[15px]">
            {kind === null
              ? "Add a sticker"
              : kind === "mention"
                ? "Tag a person"
                : kind === "event"
                  ? "Add an event"
                  : kind === "hashtag"
                    ? "Add a topic"
                    : "Add a location"}
          </DialogTitle>
        </DialogHeader>

        {kind === null ? (
          <div className="space-y-2">
            {[
              { id: "mention" as const, icon: UserRound, label: "Mention", hint: "Tag someone — links to their profile" },
              { id: "event" as const, icon: CalendarDays, label: "Event", hint: "Link the story to an event" },
              { id: "hashtag" as const, icon: Hash, label: "Topic", hint: "Link to a topic feed" },
              { id: "location" as const, icon: MapPin, label: "Location", hint: "Show where this happened" },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setKind(s.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition hover:border-primary/40 hover:bg-muted/50"
              >
                <span className="rounded-lg bg-brand-light p-2 text-primary">
                  <s.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-foreground">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {kind === "mention" ? <MentionPicker onPick={onPick} close={onClose} /> : null}

        {kind === "event" ? (
          <SearchAndList
            placeholder="Search events by name"
            endpoint={(q) => `/events?status=upcoming&limit=8&q=${encodeURIComponent(q)}`}
            pick={(raw) => ({
              kind: "event",
              label: raw.title,
              payload: { eventId: raw._id, slug: raw.slug },
            })}
            render={(raw) => (
              <>
                <span className="flex-1 truncate text-sm font-bold text-foreground">{raw.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {raw.startDate ? new Date(raw.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}
                </span>
              </>
            )}
            onPick={onPick}
            close={onClose}
          />
        ) : null}

        {kind === "hashtag" ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const topic = query.trim().replace(/^#/, "").replace(/\s+/g, "");
              if (!topic) return;
              onPick({ kind: "hashtag", label: `#${topic}`, payload: { topic } });
              onClose();
            }}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="#hackathon"
              aria-label="Topic"
              className="h-11 w-full rounded-xl border border-input bg-muted/60 px-3 text-sm outline-none focus:border-primary/50 focus:bg-background"
            />
            <button type="submit" className="btn-gradient h-11 w-full rounded-xl text-sm font-bold">
              Add topic
            </button>
          </form>
        ) : null}

        {kind === "location" ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const label = location.trim();
              if (!label) return;
              onPick({ kind: "location", label, payload: {} });
              onClose();
            }}
          >
            <input
              autoFocus
              value={location}
              onChange={(e) => setLocation(e.target.value.slice(0, 60))}
              placeholder="Bengaluru, India"
              aria-label="Location"
              className="h-11 w-full rounded-xl border border-input bg-muted/60 px-3 text-sm outline-none focus:border-primary/50 focus:bg-background"
            />
            <button type="submit" className="btn-gradient h-11 w-full rounded-xl text-sm font-bold">
              Add location
            </button>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mentions use the same debounced people search as the composer's tag picker. */
function MentionPicker({ onPick, close }: { onPick: (c: StickerChoice) => void; close: () => void }) {
  const [query, setQuery] = useState("");
  const { results, loading, error, searched } = usePeopleSearch(query, { limit: 10 });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people"
          aria-label="Search people to mention"
          className="h-11 w-full rounded-xl border border-input bg-muted/60 pl-9 pr-3 text-sm outline-none focus:border-primary/50 focus:bg-background"
        />
      </div>
      <div className="min-h-[120px] overflow-y-auto">
        {query.trim().length < 2 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Type two characters to search.</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Couldn&apos;t search right now.</p>
        ) : loading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </p>
        ) : searched && results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No people found</p>
        ) : (
          results.map((p: PersonResult) => (
            <button
              key={p._id}
              type="button"
              onClick={() => {
                onPick({
                  kind: "mention",
                  label: `@${p.username || displayNameOf(p)}`,
                  payload: { username: p.username, userId: p._id },
                });
                close();
              }}
              className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-muted/60"
            >
              <UserAvatar user={p} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-foreground">{displayNameOf(p)}</span>
                <span className="block truncate text-xs text-muted-foreground">@{p.username}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** A debounced search + list, generic over whatever collection is being picked. */
function SearchAndList<T extends Record<string, any>>({
  placeholder,
  endpoint,
  render,
  pick,
  onPick,
  close,
}: {
  placeholder: string;
  endpoint: (q: string) => string;
  render: (item: T) => React.ReactNode;
  pick: (item: T) => StickerChoice;
  onPick: (c: StickerChoice) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get(endpoint(q), { signal: controller.signal })
        .then((r) => {
          setItems(r.data?.events || r.data?.results || []);
          setSearched(true);
        })
        .catch((e: any) => {
          if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
          setItems([]);
          setSearched(true);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-11 w-full rounded-xl border border-input bg-muted/60 pl-9 pr-3 text-sm outline-none focus:border-primary/50 focus:bg-background"
        />
      </div>
      <div className="min-h-[120px] overflow-y-auto">
        {query.trim().length < 2 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Type two characters to search.</p>
        ) : loading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </p>
        ) : searched && items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing found</p>
        ) : (
          items.map((item, i) => (
            <button
              key={String((item as any)._id || i)}
              type="button"
              onClick={() => {
                onPick(pick(item));
                close();
              }}
              className={cn(
                "flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-muted/60"
              )}
            >
              {render(item)}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
