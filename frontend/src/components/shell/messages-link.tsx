"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import { usePolling } from "@/lib/query";

/** Header messages icon with unread badge → /messages. */
export function MessagesNavLink() {
  const { user, ready } = useSessionUser();
  const [unread, setUnread] = useState(0);

  // §6 (audit) / §51 — was a fixed 30s interval that kept firing on hidden
  // tabs. Now: paused while hidden, and the interval stretches up to 5min
  // whenever consecutive polls return the same count.
  const unreadRef = useRef(0);
  const reportRef = useRef<(changed: boolean) => void>(() => {});

  const pull = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.get("/messages/unread-count");
      const next = r.data?.unreadCount || 0;
      reportRef.current(next !== unreadRef.current);
      unreadRef.current = next;
      setUnread(next);
    } catch {
      /* silent — the badge is not worth an error toast */
    }
  }, [user]);

  const { reportResult } = usePolling(pull, {
    intervalMs: 30_000,
    maxIntervalMs: 5 * 60_000,
    enabled: Boolean(user),
  });
  reportRef.current = reportResult;

  if (ready && !user) return null;

  return (
    <Link
      href="/messages"
      aria-label={`Messages${unread ? ` (${unread} unread)` : ""}`}
      className="relative hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
    >
      <MessageCircle className="h-[18px] w-[18px]" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
