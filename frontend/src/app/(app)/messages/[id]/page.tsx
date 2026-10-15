"use client";

/**
 * A conversation — its own route (Part 10 §30)
 * ─────────────────────────────────────────────
 * `/messages/[id]` is a real push, not a pane swap. That single decision buys
 * three things the previous implementation could not have:
 *
 *   • the hardware/gesture Back button returns to the inbox, because it IS
 *     the previous history entry — no custom back-button interception
 *   • Back-swipe on iOS works
 *   • a conversation is linkable and survives a reload
 *
 * Desktop renders the same panel beside the inbox via `@lg`, so there is one
 * thread implementation, not two.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ThreadPanel } from "@/components/messages/thread-panel";
import { ConversationList } from "@/components/messages/conversation-list";
import { useDmSocket, setActiveConversation } from "@/hooks/use-dm-socket";
import { useInbox, useUnread } from "@/hooks/use-messages";
import { TeamCreateSheet } from "@/components/messages/team-create-sheet";
import { useChatViewport } from "@/hooks/use-chat-viewport";

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conversationId = params?.id ?? null;

  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  const { connection } = useDmSocket();
  const { rows, loading, error, hasMore, loadMore, refresh } = useInbox("all");
  const { archived: unreadArchived } = useUnread();
  const viewportRef = useChatViewport<HTMLDivElement>();

  /* Tell the socket router which conversation is on screen. This is the ONE
     piece of state that decides whether an incoming `dm:message` updates the
     open thread or only the inbox row (§12). */
  useEffect(() => {
    setActiveConversation(conversationId);
    return () => setActiveConversation(null);
  }, [conversationId]);

  const onBack = useCallback(() => {
    // If history is empty (e.g. opened from notification / external link),
    // back() would leave the app. Push to inbox instead.
    if (typeof window !== "undefined" && window.history.length <= 1) {
      router.push("/messages");
    } else {
      router.back();
    }
  }, [router]);

  const fallback = rows.find((r) => r._id === conversationId) ?? null;

  return (
    <div
      ref={viewportRef}
      className="chat-viewport mx-auto flex w-full flex-col overflow-hidden overscroll-none bg-surface-container-lowest lg:h-[calc(100dvh-3.5rem)]"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-container-lowest lg:my-3 lg:rounded-2xl lg:border lg:border-outline-variant lg:elevation-card">
        {/* Desktop only: the inbox stays visible beside the open thread. */}
        <aside className="hidden w-[21rem] shrink-0 flex-col border-r border-outline-variant lg:flex">
          <ConversationList
            rows={rows}
            loading={loading}
            error={error}
            hasMore={hasMore}
            activeId={conversationId}
            tab="all"
            onTabChange={() => {}}
            search=""
            onSearchChange={() => {}}
            onOpen={(row) => router.push(`/messages/${row._id}`)}
            onLoadMore={loadMore}
            onRetry={() => void refresh()}
            archivedUnread={unreadArchived}
            linkPrefix="/messages"
            onCreateTeam={() => setTeamSheetOpen(true)}
          />
        </aside>

        <ThreadPanel
          conversationId={conversationId}
          fallback={fallback}
          onBack={onBack}
          connection={connection}
          onCreateTeam={() => setTeamSheetOpen(true)}
        />
      </div>

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
