"use client";

/**
 * Member picker (Part 11 §5)
 * ──────────────────────────
 * "jaha user apne followers ya following or anyone on the app ko apne team me
 *  add kr ske" — three sources, one control:
 *
 *   Followers  GET /api/follow/:me/followers   → `users`
 *   Following  GET /api/follow/:me/following   → `users`
 *   Anyone     GET /api/users/suggested        (no query yet)
 *              GET /api/search?q=&type=people  (debounced, 300ms)
 *
 * No mock people, ever (§41): every row shown here came from the API, and an
 * empty list says so honestly instead of padding itself with strangers.
 *
 * Reused by "create a team" and by "add to a team", so there is one picker to
 * keep correct rather than two that drift.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, Users, X } from "lucide-react";
import { api } from "@/utils/api";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

export type PickerSource = "followers" | "following" | "anyone";

const TABS: { id: PickerSource; label: string }[] = [
  { id: "followers", label: "Followers" },
  { id: "following", label: "Following" },
  { id: "anyone", label: "Anyone" },
];

const PAGE_SIZE = 20;

interface PickerUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  profile?: { avatar?: string; institution?: string };
}

export interface MemberPickerProps {
  /** The signed-in user's id — the follow lists are addressed by it. */
  meId?: string | null;
  /** Rows already in the team — shown ticked and not removable here. */
  lockedIds?: string[];
  selected: PickerUser[];
  onChange: (next: PickerUser[]) => void;
  /** True while the parent is submitting; disables the picker. */
  busy?: boolean;
}

export function MemberPicker({ meId, lockedIds = [], selected, onChange, busy }: MemberPickerProps) {
  const [source, setSource] = useState<PickerSource>("followers");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<PickerUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const pageRef = useRef(1);

  const selectedIds = useMemo(() => new Set(selected.map((u) => String(u._id))), [selected]);
  const locked = useMemo(() => new Set(lockedIds.map(String)), [lockedIds]);

  /* One debounced query for the whole picker (§25: never a request per
     keystroke). 300ms because this is a list the user is scanning, not a
     result they are waiting on. */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async (page: number, append: boolean) => {
      setLoading(true);
      try {
        let users: PickerUser[] = [];
        let more = false;

        if (source === "anyone" && debounced.length >= 1) {
          const r = await api.get(
            `/search?type=people&limit=${PAGE_SIZE}&q=${encodeURIComponent(debounced)}`
          );
          users = (r.data?.people || []) as PickerUser[];
          more = false;
        } else if (source === "anyone") {
          // No query yet: who is around, from the app's own suggestion
          // ranking. Real people, no fixtures.
          const r = await api.get("/users/suggested");
          users = (r.data?.users || []) as PickerUser[];
          more = false;
        } else if (meId) {
          const r = await api.get(`/follow/${meId}/${source}?page=${page}`);
          users = (r.data?.users || []) as PickerUser[];
          more = Boolean(r.data?.hasMore);
        } else {
          // No session id yet: show nothing rather than someone else's graph.
          users = [];
        }

        setRows((prev) => (append ? [...prev, ...users.filter((u) => !prev.some((p) => p._id === u._id))] : users));
        setHasMore(more);
        setError(false);
      } catch {
        if (!append) {
          setRows([]);
          setError(true);
        }
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [source, debounced, meId]
  );

  // Reload whenever the source or the settled query changes. Appending only
  // happens from the explicit "load more" control, so a stale page can never
  // be concatenated onto a new query's results.
  useEffect(() => {
    if (busy) return;
    pageRef.current = 1;
    void load(1, false);
  }, [load, busy]);

  const toggle = (user: PickerUser) => {
    if (locked.has(String(user._id))) return;
    if (selectedIds.has(String(user._id))) {
      onChange(selected.filter((u) => String(u._id) !== String(user._id)));
    } else {
      onChange([...selected, user]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Source tabs — 44px touch targets, no card chrome (§3). */}
      <div
        role="tablist"
        aria-label="Where to add people from"
        className="flex shrink-0 gap-1 border-b border-outline-variant px-3 py-2"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={source === t.id}
            onClick={() => setSource(t.id)}
            className={cn(
              "min-h-[44px] flex-1 touch-manipulation rounded-full px-3 text-[13px] font-semibold transition-colors",
              source === t.id
                ? "bg-primary text-white"
                : "bg-surface-container text-on-surface-variant hover:text-on-surface"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Selected chips — removable, so a mis-tap is one tap to undo. */}
      {selected.length ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-outline-variant px-3 py-2">
          {selected.map((u) => (
            <button
              key={u._id}
              type="button"
              onClick={() => toggle(u)}
              className="flex max-w-[10rem] items-center gap-1 rounded-full bg-primary-light py-1 pl-1 pr-2 text-[12px] font-semibold text-primary"
              aria-label={`Remove ${displayName(u)}`}
            >
              <UserAvatar user={u} size={20} />
              <span className="truncate">{displayName(u)}</span>
              <X className="h-3 w-3 shrink-0" aria-hidden />
            </button>
          ))}
        </div>
      ) : null}

      {/* Search — only meaningful for "Anyone"; the follow lists are short
          enough to scan, and they are the user's own graph. */}
      <div className="shrink-0 px-3 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={source === "anyone" ? "Search anyone on EventHub" : "Search your list"}
            aria-label="Search people"
            enterKeyHint="search"
            className="h-10 w-full rounded-lg border border-outline-variant bg-surface-container pl-8 pr-8 text-[14px] outline-none placeholder:text-on-surface-variant/70 focus-visible:border-primary"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2">
        {error ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[13px] font-semibold text-on-surface">Couldn&apos;t load people</p>
            <button
              type="button"
              onClick={() => void load(1, false)}
              className="mt-2 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : loading && !rows.length ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-on-surface-variant">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
          </div>
        ) : !rows.length ? (
          <PickerEmpty source={source} query={debounced} />
        ) : (
          <>
            <ul>
              {rows
                .filter((u) => (query.trim() && source !== "anyone" ? matches(u, query) : true))
                .map((u) => {
                  const on = selectedIds.has(String(u._id));
                  const isLocked = locked.has(String(u._id));
                  return (
                    <li key={u._id}>
                      <button
                        type="button"
                        onClick={() => toggle(u)}
                        disabled={busy || isLocked}
                        aria-pressed={on || isLocked}
                        className={cn(
                          "flex w-full touch-manipulation items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                          on && "bg-primary-light",
                          !isLocked && "hover:bg-surface-container",
                          isLocked && "opacity-60"
                        )}
                      >
                        <UserAvatar user={u} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold text-on-surface">
                            {displayName(u)}
                          </span>
                          <span className="block truncate text-[12px] text-on-surface-variant">
                            {isLocked ? "Already in this team" : u.profile?.institution || (u.username ? `@${u.username}` : "")}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                            on || isLocked ? "border-primary bg-primary text-white" : "border-outline-variant"
                          )}
                          aria-hidden
                        >
                          {on || isLocked ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
            {hasMore ? (
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={() => {
                    const next = pageRef.current + 1;
                    pageRef.current = next;
                    void load(next, true);
                  }}
                  className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-primary hover:bg-surface-container"
                >
                  Load more
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function displayName(u: PickerUser) {
  return `${u.firstName || ""} ${u.lastName || ""}`.trim() || (u.username ? `@${u.username}` : "Someone");
}

function matches(u: PickerUser, q: string) {
  const needle = q.toLowerCase();
  return (
    displayName(u).toLowerCase().includes(needle) ||
    String(u.username || "").toLowerCase().includes(needle)
  );
}

function PickerEmpty({ source, query }: { source: PickerSource; query: string }) {
  if (source === "anyone" && query.length > 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
        <Search className="h-6 w-6 text-on-surface-variant/50" aria-hidden />
        <p className="text-[13px] font-bold text-on-surface">No one found</p>
        <p className="text-[12px] text-on-surface-variant">Try their name or @username.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <Users className="h-6 w-6 text-on-surface-variant/50" aria-hidden />
      <p className="text-[13px] font-bold text-on-surface">
        {source === "followers" ? "No followers yet" : source === "following" ? "You're not following anyone yet" : "Nobody to show yet"}
      </p>
      <p className="text-[12px] text-on-surface-variant">
        {source === "anyone"
          ? "Search by name to add someone."
          : "Switch to “Anyone” to add people you don't follow yet."}
      </p>
    </div>
  );
}
