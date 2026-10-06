"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";

/** Header messages icon with unread badge → /messages. */
export function MessagesNavLink() {
  const { user, ready } = useSessionUser();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const pull = () =>
      api
        .get("/messages/unread-count")
        .then((r) => setUnread(r.data?.unreadCount || 0))
        .catch(() => {});
    pull();
    const t = setInterval(pull, 30_000);
    return () => clearInterval(t);
  }, [user]);

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
