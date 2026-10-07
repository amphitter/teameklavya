"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useSessionUser } from "@/components/shell/use-session-user";
import { refreshUnread, useUnread } from "@/hooks/use-messages";
import { useDmSocket } from "@/hooks/use-dm-socket";
import { cn } from "@/lib/utils";

/**
 * Header messages icon with unread badge → /messages.
 *
 * Part 10 §3, §12 — the badge is now driven by the shared realtime
 * subscription instead of its own 30-second poll. Before this, a message
 * could sit unreported for half a minute and the badge kept asking the server
 * even while the user was mid-conversation. Now it is written the instant the
 * `dm:message` event lands, and the poll is gone entirely — so an idle tab
 * makes zero requests where it used to make 120 an hour.
 *
 * `refreshUnread()` still runs once on mount and on every reconnect, because
 * events that fired while the socket was down are not replayed (§28).
 */
export function MessagesNavLink() {
  const { user, ready } = useSessionUser();
  const { inbox: unread } = useUnread();
  /* The header is on every page, so this is where the DM subscription lives:
   * one socket for the whole app (the same singleton the live-event pages
   * use), which means the badge updates from a realtime event rather than
   * only when the user happens to be inside /messages.
   *
   * `useDmSocket` attaches its handlers once per app, so mounting it here
   * and on the messages pages is not two subscriptions — the second call is
   * a no-op that only reads connection state. */
  useDmSocket();

  useEffect(() => {
    if (!user) return;
    void refreshUnread();
  }, [user]);

  if (ready && !user) return null;

  return (
    <Link
      href="/messages"
      aria-label={`Messages${unread ? ` (${unread} unread)` : ""}`}
      /* P0 fix — this was `hidden ... sm:flex`, so the only way to reach
         Messages was gone on every phone. §32 asks for a top-right header
         entry on mobile while the bottom nav stays
         Home/Explore/Create/Community/Profile, so the icon renders at all
         widths. The 44px box is the §44 minimum tap target; it collapses to
         the original 36px only from sm up, where the header is denser. */
      className={cn(
        "relative flex shrink-0 touch-manipulation items-center justify-center rounded-lg",
        "text-muted-foreground transition-colors active:bg-muted",
        "hover:bg-muted hover:text-foreground",
        "-mr-1 h-11 w-11 sm:-mr-0 sm:h-9 sm:w-9"
      )}
    >
      <MessageCircle className="h-[18px] w-[18px]" />
      {unread > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
