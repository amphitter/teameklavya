"use client";

/**
 * Messages — the mobile screen (Part 10 §2, §3, §29, §30)
 * ───────────────────────────────────────────────────────
 * On a phone this is a real, separate screen: the inbox fills the viewport,
 * tapping a conversation pushes `/messages/[id]`, and Back returns to the
 * list. It is NOT the desktop two-pane layout squeezed onto 360px, which was
 * the previous implementation's core mobile failure (§30).
 *
 * Desktop reuses the same components inside a two-pane shell at `lg`.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MessageCircleOff } from "lucide-react";
import { useSessionUser } from "@/components/shell/use-session-user";
import {
  ConversationList,
  ConversationListSkeleton,
  isTeamRow,
  type InboxTab,
} from "@/components/messages/conversation-list";
import { Button } from "@/components/ui/button";
import { TeamCreateSheet } from "@/components/messages/team-create-sheet";
import { useConversationSearch, useInbox, useResolveConversation, useUnread } from "@/hooks/use-messages";
import { useDmSocket } from "@/hooks/use-dm-socket";
import type { ConversationRow } from "@/lib/messages/store";
import { cn } from "@/lib/utils";

export default function MessagesPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full p-3">
          <ConversationListSkeleton />
        </div>
      }
    >
      <MessagesInbox />
    </Suspense>
  );
}

function MessagesInbox() {
  const router = useRouter();
  const { user, ready } = useSessionUser();
  // One subscription for the whole app session: the badge, the inbox and any
  // open thread all learn about new messages from this single hook (§12).
  useDmSocket();

  const params = useSearchParams();
  const withUser = params.get("with");
  const initialTab = (params.get("view") as InboxTab) || "all";

  const [tab, setTab] = useState<InboxTab>(initialTab);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const archived = tab === "archived";
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);

  /* Only the archive is a different SERVER view. Unread is a filter over
   * rows we already have — every row carries its own `unreadCount` — so
   * tapping "Unread" is instant and costs zero requests, and the cached
   * inbox is never clobbered by a narrower server response.
   * (GET /messages/conversations?view=unread still exists and is tested;
   * it is there for clients that cannot hold the full list.) */
  const { rows: allRows, loading, error, hasMore, loadMore, refresh } = useInbox(archived ? "archived" : "all");
  const { inbox: unreadInbox, archived: unreadArchived } = useUnread();
  /* A notification links to `?c=<conversationId>` — the conversation already
     exists, so there is nothing to resolve and the thread can open directly.
     `?with=<userId>` is kept for deep links and for anything that still wants
     the get-or-create behaviour. */
  const withConversation = params.get("c");
  const { conversationId: resolvedId, error: resolveError, loading: resolving, retry: retryResolve } =
    useResolveConversation(withUser, user?._id);

  /* §25 — one debounced server request per settled query, never one per
     keystroke. The input's own state is separate from the query that is
     actually sent, so typing does not re-render the list. */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { results: searchResults, loading: searching } = useConversationSearch(
    debouncedQuery,
    debouncedQuery.length > 0 ? "conversations" : "conversations"
  );

  const openConversation = useCallback(
    (row: ConversationRow) => {
      router.push(`/messages/${row._id}`);
    },
    [router]
  );

  /* §99 — every entry point lands on the same thread route. A conversation id
     goes straight there; a user id goes through get-or-create first. */
  useEffect(() => {
    if (withConversation) router.replace(`/messages/${withConversation}`);
    else if (resolvedId) router.replace(`/messages/${resolvedId}`);
  }, [resolvedId, withConversation, router]);



  /* Every tab is a filter over the rows we already hold — no tab costs a
   * request, so switching is instant (§"chats load slowly"). */
  const rowsForList = useMemo(() => {
    if (tab === "unread") return allRows.filter((r) => (r.unreadCount || 0) > 0);
    if (tab === "teams") return allRows.filter(isTeamRow);
    return allRows;
  }, [allRows, tab]);

  if (!ready) {
    return (
      <div className="h-full p-3">
        <ConversationListSkeleton />
      </div>
    );
  }

  /* A deep link is being resolved (or has failed). Showing the inbox underneath
     would flash a list the user did not ask for and then replace it — so the
     surface holds the space and says what is happening. §73: the failure is
     STATED, with the server's reason and a retry, never swallowed. */
  if (withUser && (resolving || resolveError)) {
    return (
      <div className="mx-auto flex h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] w-full max-w-[1200px] flex-col items-center justify-center gap-3 px-6 text-center lg:h-[calc(100dvh-3.5rem)]">
        {resolving ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
            <p className="text-sm font-semibold text-on-surface">Opening conversation…</p>
            <p className="text-xs text-on-surface-variant">This only takes a moment.</p>
          </>
        ) : (
          <>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <MessageCircleOff className="h-5 w-5" aria-hidden />
            </div>
            <p className="text-sm font-semibold text-on-surface">Couldn&apos;t open that conversation</p>
            {/* The backend distinguishes self / blocked / "doesn't accept
                messages" / unknown user, so its words are the useful ones. */}
            <p role="alert" className="max-w-sm text-xs text-on-surface-variant">
              {resolveError}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={retryResolve} data-testid="conversation-retry">
                Try again
              </Button>
              <Button size="sm" variant="outline" onClick={() => router.replace("/messages")}>
                Back to messages
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    /* Part 10 §2 — THE VIEWPORT MATHS LIVES HERE, ONCE.
     *
     * `100dvh` (not `100vh`) so the mobile browser's collapsing address bar
     * does not push the composer off screen. The header offset is subtracted
     * with dvh units throughout so the two stay consistent when the bar
     * moves. `dvh` is supported everywhere the app targets; `100vh` is kept
     * as the first declaration as the fallback for anything older.
     *
     * This element is the ONLY thing that scrolls the page — the list and
     * the thread each scroll internally, so the composer can never be
     * scrolled away and the page can never rubber-band behind a chat. */
    <div
      className={cn(
        /* Was max-w-5xl (1024px): inside the 1200px column it left an 88px
           empty band on each side at 1440 — the "faltu gap". A chat is a
           two-pane surface, so it should use the width it is given, with a
           readable cap only on very wide monitors. */
        "mx-auto flex w-full max-w-[1200px] flex-col overflow-hidden 2xl:max-w-[1440px]",
        /* The inbox keeps the bottom nav, so it must subtract it.
         *   3.5rem = shell header, 4.5rem = bottom nav, plus the safe area
         *   the nav itself reserves. From lg the nav is gone and only the
         *   header remains.
         * `100vh` first as the fallback, `100dvh` after so the collapsing
         * mobile address bar cannot push the list off screen (§2). */
        /* The bottom nav is `lg:hidden`, so 4.5rem must be subtracted below
         * lg and only the header above it. `100vh` is declared first as the
         * fallback for engines without `dvh`. */
        /* Below lg only the bottom nav is left (4.5rem) — the header is
         * desktop-only now, so subtracting it would leave a 56px dead strip
         * at the foot of the list. */
        "h-[calc(100vh-4.5rem-env(safe-area-inset-bottom))]",
        "h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))]",
        "lg:h-[calc(100vh-3.5rem)] lg:h-[calc(100dvh-3.5rem)]"
      )}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-container-lowest lg:my-3 lg:rounded-2xl lg:border lg:border-outline-variant lg:elevation-card">
        <ConversationList
          rows={rowsForList}
          loading={loading}
          error={error}
          hasMore={hasMore}
          activeId={null}
          tab={tab}
          onTabChange={setTab}
          search={query}
          onSearchChange={setQuery}
          onOpen={openConversation}
          onLoadMore={loadMore}
          onRetry={() => void refresh()}
          archivedUnread={unreadArchived}
          searching={Boolean(debouncedQuery) && searching}
          searchResults={searchResults as unknown as ConversationRow[]}
          onCreateTeam={() => setTeamSheetOpen(true)}
        />
      </div>

      {/* Part 11 §5 — create a team and go straight into it. */}
      <TeamCreateSheet
        open={teamSheetOpen}
        onClose={() => setTeamSheetOpen(false)}
        onCreated={(id) => {
          setTeamSheetOpen(false);
          router.push(`/messages/${id}`);
        }}
      />
    </div>
  );
}
