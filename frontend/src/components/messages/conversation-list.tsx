"use client";

/**
 * Conversation list (Part 10 §3, §4, §25, §26)
 * ─────────────────────────────────────────────
 * A compact inbox, not a dashboard: 64px rows, no cards, no shadows, no
 * metadata the user did not ask for. Each row is memoised and receives only
 * primitives plus its own row object, so a message arriving in one
 * conversation re-renders that row and nothing else (§7, §12).
 */

import { memo, useCallback } from "react";
import { Archive, BellOff, Loader2, MessageCircle, Plus, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { handleOf, timeAgo } from "@/lib/social";
import { PresenceDot } from "@/components/messages/presence-dot";
import type { ConversationRow } from "@/lib/messages/store";
import { usePeopleSearch, type PersonResult } from "@/components/people/use-people-search";
import { PersonRow } from "@/components/people/person-row";
import { useStartConversation } from "@/hooks/use-messages";
import { useSessionUser } from "@/components/shell/use-session-user";

export type InboxTab = "all" | "unread" | "teams" | "archived";

/* Part 11 §5 — TEAMS, not groups. `teams` is the filter over the rows we
 * already have (type === "team"), so tapping it costs no request. */
export const INBOX_TABS: { id: InboxTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "teams", label: "Teams" },
  { id: "archived", label: "Archived" },
];

/** Is this row a team? Absent type means a row cached before teams existed. */
export function isTeamRow(row: ConversationRow) {
  return row.type === "team";
}

/** Display name for either kind of row. */
function rowName(row: ConversationRow) {
  if (isTeamRow(row)) return row.name || "Team";
  return `${row.other?.firstName || ""} ${row.other?.lastName || ""}`.trim() || "Unknown";
}

/**
 * Team avatar: the team's own picture when it has one, otherwise a neutral
 * people glyph. Never a fake face — a team is not a person (§51).
 */
function RowAvatar({ row, size = 48 }: { row: ConversationRow; size?: number }) {
  if (!isTeamRow(row)) {
    return (
      <div className="relative shrink-0">
        <UserAvatar user={row.other} size={size} />
        {/* Presence under the avatar. Renders nothing when offline. */}
        <PresenceDot userId={row.other?._id} />
      </div>
    );
  }
  if (row.avatar) {
    return (
      <div className="relative shrink-0">
        <UserAvatar user={{ firstName: row.name || "T", profile: { avatar: row.avatar } }} size={size} />
      </div>
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-primary-light text-primary"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Users className="h-5 w-5" />
    </div>
  );
}

/**
 * Second line of a row.
 * A team must say WHO spoke — "Ben: standup at 6" — otherwise a busy team
 * reads as a wall of unattributed text.
 */
function rowPreview(row: ConversationRow) {
  if (!row.lastMessage) return isTeamRow(row) ? "No messages yet" : `@${handleOf(row.other)} — say hi`;
  const who = row.lastMessage.mine
    ? "You"
    : isTeamRow(row)
      ? row.lastMessage.senderName || ""
      : "";
  return `${who ? `${who}: ` : ""}${row.lastMessage.text}`;
}

/* ── One row ────────────────────────────────────────────────────────────── */

interface RowProps {
  row: ConversationRow;
  active: boolean;
  onOpen: (row: ConversationRow) => void;
}

const ConversationItem = memo(function ConversationItem({ row, active, onOpen }: RowProps) {
  const unread = (row.unreadCount || 0) > 0;
  const name = rowName(row);
  const team = isTeamRow(row);

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        aria-current={active ? "true" : undefined}
        /* touch-manipulation removes the 300ms tap delay Android applies to
           buttons it thinks might need a double-tap, which is most of the
           perceived "lag" when opening a chat. */
        className={cn(
          "flex w-full touch-manipulation items-center gap-3 px-3 py-2 text-left transition-colors",
          active ? "bg-purple-light" : "hover:bg-surface-container active:bg-surface-container"
        )}
      >
        <div className="relative shrink-0">
          <RowAvatar row={row} />
          {row.archived ? (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface-container-lowest bg-on-surface-variant">
              <Archive className="h-2 w-2 text-white" aria-hidden />
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            {/* Unread rows get heavier type, not a different colour — colour
                alone is not a reliable signal for every user. */}
            <span className={cn("truncate text-[14px] text-on-surface", unread ? "font-bold" : "font-semibold")}>
              {name}
              {team && row.memberCount ? (
                <span className="ml-1.5 text-[11px] font-medium text-on-surface-variant">{row.memberCount}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-on-surface-variant">
              {row.lastMessage?.at ? timeAgo(row.lastMessage.at) : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                unread ? "font-semibold text-on-surface" : "text-on-surface-variant"
              )}
            >
              {rowPreview(row)}
            </span>
            {unread ? (
              <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                {row.unreadCount > 9 ? "9+" : row.unreadCount}
              </span>
            ) : null}
            {row.muted ? <BellOff className="h-3 w-3 shrink-0 text-on-surface-variant" aria-label="Muted" /> : null}
          </div>
        </div>
      </button>
    </li>
  );
});

/* ── Skeleton ───────────────────────────────────────────────────────────── */

export function ConversationListSkeleton() {
  return (
    <div className="space-y-0.5 p-2" aria-busy="true" aria-label="Loading conversations">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-2">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-surface-container" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-28 animate-pulse rounded bg-surface-container" />
            <div className="h-3 w-40 animate-pulse rounded bg-surface-container" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── List + tabs ────────────────────────────────────────────────────────── */

export interface ConversationListProps {
  rows: ConversationRow[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  activeId: string | null;
  tab: InboxTab;
  onTabChange: (t: InboxTab) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onOpen: (row: ConversationRow) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  archivedUnread: number;
  /** Server search results replace the local rows while a query is active. */
  searching?: boolean;
  searchResults?: ConversationRow[];
  /** Rendered as a link on desktop, as a router push on mobile. */
  linkPrefix?: string;
  /** Part 11 — opens the create-team sheet. Hidden when the caller has none. */
  onCreateTeam?: () => void;
}

/**
 * One person in the search results (§78).
 *
 * Tapping starts or opens the conversation — never a profile detour. It uses
 * the same `useStartConversation` path as the profile button, so a person found
 * here and a person found on their profile reach the same thread, created once.
 */
function PersonHit({ person }: { person: PersonResult }) {
  const { start, isPending } = useStartConversation();
  const pending = isPending(person._id);

  return (
    <li>
      <PersonRow
        person={person}
        onSelect={() => void start(person._id)}
        action={
          pending ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
          ) : (
            <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-primary">
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
              Message
            </span>
          )
        }
        className={pending ? "opacity-70" : undefined}
      />
    </li>
  );
}

export function ConversationList({
  rows,
  loading,
  error,
  hasMore,
  activeId,
  tab,
  onTabChange,
  search,
  onSearchChange,
  onOpen,
  onLoadMore,
  onRetry,
  archivedUnread,
  searching,
  searchResults,
  linkPrefix,
  onCreateTeam,
}: ConversationListProps) {
  const query = search.trim();
  const isSearching = query.length > 0;
  const shown = isSearching ? searchResults || [] : rows;

  /* §76–§81 — the SAME search surface answers both questions:
     "which chat was that?" and "who do I want to message?".
     People come from the existing server-side search (debounced, projected,
     paginated by the server), never from a list of every user held in the
     browser (§79). The viewer is excluded: you cannot message yourself. */
  const { user } = useSessionUser();
  const { results: people, loading: peopleLoading, error: peopleError, searched: peopleSearched } = usePeopleSearch(query, {
    limit: 8,
    excludeIds: user?._id ? [user._id] : [],
  });
  const peopleToShow = people;
  const chatsShown = searching ? [] : shown;

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      // 240px of runway: the next page is usually in flight before the user
      // reaches the end, so the list never visibly stops.
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 240 && hasMore) onLoadMore();
    },
    [hasMore, onLoadMore]
  );

  return (
    /* `min-w-0` on the root is LOAD-BEARING, not decoration.
     *
     * This column is a flex ITEM of the page's row. Without it the automatic
     * minimum size of a flex item is its min-content width — and a
     * conversation row contains a `truncate` (nowrap) preview line, whose
     * min-content width is the whole sentence. The list therefore laid itself
     * out at ~1321px inside a page that is `overflow-hidden`, so on a phone
     * the preview text, the timestamp, the unread badge, the search field and
     * the "New team" button were all laid out PAST the right edge and simply
     * clipped: the inbox had no right margin at all. Measured at 320px before
     * this fix: list 1321px wide, preview span 1237px, search input 1309px.
     * With `min-w-0` the rows are sized by the viewport and `truncate` finally
     * truncates instead of being clipped. */
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Header: title + search. No giant hero, no stats (§3). */}
      <div className="shrink-0 border-b border-outline-variant px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h1 className="text-[20px] font-bold tracking-tight text-on-surface">
            {tab === "archived" ? "Archived" : tab === "teams" ? "Teams" : "Messages"}
          </h1>
          {/* The one place a team is created, right where teams are listed. */}
          {onCreateTeam ? (
            <button
              type="button"
              onClick={onCreateTeam}
              className="flex h-11 min-h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-semibold text-white active:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New team
            </button>
          ) : null}
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search people or chats"
            aria-label="Search conversations"
            enterKeyHint="search"
            /* §84 — 16px on phones, and ONLY on phones.
               iOS Safari zooms the whole page when a focused field is
               smaller than 16px, which is what "the DM UI zooms in" was.
               `text-base` is 16px; it returns to the tighter 14px from `sm`
               where no such behaviour exists, and nothing about zoom is
               disabled elsewhere on the site. */
            className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container pl-8 pr-10 text-base outline-none placeholder:text-on-surface-variant/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12 sm:text-[14px]"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {/* Segment control (§3) — now genuinely 44px tall (§30, §44). */}
        <div
          role="tablist"
          aria-label="Conversation filters"
          className="mt-2 flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {INBOX_TABS.map((t) => {
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => onTabChange(t.id)}
                className={cn(
                  "relative shrink-0 touch-manipulation rounded-full px-3 text-[13px] font-semibold transition-colors",
                  /* §30/§44 — measured 32px tall, which is a mouse target, not a
                     thumb one. The pill keeps its shape; the hit area grows to
                     the 44px minimum. */
                  "min-h-[44px] py-2.5",
                  tab === t.id
                    ? "bg-primary text-white"
                    : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                )}
              >
                {t.label}
                {t.id === "archived" && archivedUnread > 0 ? (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                    {archivedUnread > 9 ? "9+" : archivedUnread}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain" onScroll={handleScroll}>
        {isSearching ? (
          /* ── Unified search results ───────────────────────────────────
             Two labelled sections, people first: "message someone" is the
             action a search inside Messages is usually reaching for, and the
             chat you were half-remembering is the second. Both are live
             server searches; neither blocks the other. */
          <div className="pb-4" data-testid="message-search-results">
            <section aria-label="People">
              <h2 className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                People
              </h2>
              {peopleLoading && !peopleToShow.length ? (
                <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-on-surface-variant">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching people…
                </div>
              ) : peopleToShow.length ? (
                <ul className="divide-y divide-outline-variant/50">
                  {peopleToShow.map((person) => (
                    <PersonHit key={person._id} person={person} />
                  ))}
                </ul>
              ) : peopleError ? (
                <p className="px-3 py-3 text-[13px] text-on-surface-variant">
                  Couldn&apos;t search people right now.
                </p>
              ) : peopleSearched && query.length >= 2 ? (
                /* §80 — a real empty state, never a blank panel. */
                <p className="px-3 py-3 text-[13px] text-on-surface-variant" data-testid="no-people-found">
                  No people found for “{query}”.
                </p>
              ) : (
                <p className="px-3 py-3 text-[13px] text-on-surface-variant">
                  Keep typing to search people.
                </p>
              )}
            </section>

            <section aria-label="Chats" className="mt-1 border-t border-outline-variant/60">
              <h2 className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                Chats
              </h2>
              {searching && !chatsShown.length ? (
                <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-on-surface-variant">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching chats…
                </div>
              ) : chatsShown.length ? (
                <ul className="divide-y divide-outline-variant/50">
                  {chatsShown.map((row) => (
                    <ConversationItem key={row._id} row={row} active={activeId === row._id} onOpen={onOpen} />
                  ))}
                </ul>
              ) : query.length >= 2 && !searching ? (
                <p className="px-3 py-3 text-[13px] text-on-surface-variant" data-testid="no-chats-found">
                  No chats match “{query}”. Pick someone above to start one.
                </p>
              ) : !searching ? (
                <p className="px-3 py-3 text-[13px] text-on-surface-variant">Keep typing to search chats.</p>
              ) : null}
            </section>
          </div>
        ) : loading && !shown.length ? (
          <ConversationListSkeleton />
        ) : error && !shown.length ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <p className="text-[14px] font-semibold text-on-surface">Couldn&apos;t load messages</p>
            <p className="text-[12px] text-on-surface-variant">Check your connection and try again.</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 min-h-11 rounded-full bg-primary px-4 py-2 text-[12px] font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : shown.length === 0 ? (
          <EmptyInbox tab={tab} hasQuery={Boolean(search.trim())} />
        ) : (
          <>
            <ul className="divide-y divide-outline-variant/50">
              {shown.map((row) =>
                linkPrefix ? (
                  /* A real link, so middle-click and ⌘-click open a new tab
                     the way every other link in the app does. */
                  <li key={row._id}>
                    <Link
                      href={`${linkPrefix}/${row._id}`}
                      className="flex w-full touch-manipulation items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-container"
                    >
                      <ConversationRowInner row={row} active={row._id === activeId} />
                    </Link>
                  </li>
                ) : (
                  <ConversationItem key={row._id} row={row} active={row._id === activeId} onOpen={onOpen} />
                )
              )}
            </ul>
            {hasMore && !search.trim() ? (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-on-surface-variant" aria-label="Loading more" />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Non-interactive inner content, for the desktop `<Link>` variant. */
function ConversationRowInner({ row, active }: { row: ConversationRow; active: boolean }) {
  const unread = (row.unreadCount || 0) > 0;
  const name = rowName(row);
  const team = isTeamRow(row);
  return (
    <div className={cn("flex w-full items-center gap-3", active && "font-semibold")}>
      <div className="relative shrink-0">
        <RowAvatar row={row} />
        {row.archived ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface-container-lowest bg-on-surface-variant">
            <Archive className="h-2 w-2 text-white" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-[14px] text-on-surface", unread ? "font-bold" : "font-semibold")}>
            {name}
            {team && row.memberCount ? (
              <span className="ml-1.5 text-[11px] font-medium text-on-surface-variant">{row.memberCount}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-on-surface-variant">
            {row.lastMessage?.at ? timeAgo(row.lastMessage.at) : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              unread ? "font-semibold text-on-surface" : "text-on-surface-variant"
            )}
          >
            {rowPreview(row)}
          </span>
          {unread ? (
            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
              {row.unreadCount > 9 ? "9+" : row.unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Empty states (§26) ─────────────────────────────────────────────────── */

function EmptyInbox({ tab, hasQuery }: { tab: InboxTab; hasQuery: boolean }) {
  if (hasQuery) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <Search className="h-7 w-7 text-on-surface-variant/50" aria-hidden />
        <p className="text-[14px] font-bold text-on-surface">No matches</p>
        <p className="text-[12px] text-on-surface-variant">Try a different name or word.</p>
      </div>
    );
  }
  if (tab === "archived") {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <Archive className="h-7 w-7 text-on-surface-variant/50" aria-hidden />
        <p className="text-[14px] font-bold text-on-surface">No archived conversations</p>
        <p className="text-[12px] text-on-surface-variant">
          Conversations you archive are kept here — never deleted.
        </p>
      </div>
    );
  }
  if (tab === "teams") {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <Users className="h-7 w-7 text-on-surface-variant/50" aria-hidden />
        <p className="text-[14px] font-bold text-on-surface">No teams yet</p>
        <p className="max-w-[16rem] text-[12px] text-on-surface-variant">
          Create a team and add your followers, the people you follow, or anyone on EventHub.
        </p>
      </div>
    );
  }
  if (tab === "unread") {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <MessageCircle className="h-7 w-7 text-on-surface-variant/50" aria-hidden />
        <p className="text-[14px] font-bold text-on-surface">You&apos;re all caught up</p>
        <p className="text-[12px] text-on-surface-variant">No unread conversations.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
      <MessageCircle className="h-7 w-7 text-on-surface-variant/50" aria-hidden />
      <p className="text-[14px] font-bold text-on-surface">Start a conversation</p>
      <p className="max-w-[16rem] text-[12px] text-on-surface-variant">
        Search for people, organizations or event communities to message.
      </p>
    </div>
  );
}
