"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";
import { api } from "@/utils/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { FollowAuthorButton } from "@/components/feed/follow-author-button";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cn } from "@/lib/utils";

interface ListUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  verified?: boolean;
  profile?: { avatar?: string; institution?: string };
}

type ListKind = "followers" | "following" | "requests";

/**
 * Followers / Following / Requests modal — paginated real lists with
 * follow-state actions. Used from profiles (counts) and the header.
 */
export function FollowListModal({
  userId,
  kind,
  open,
  onOpenChange,
  onCountChange,
}: {
  userId: string;
  kind: ListKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange?: (delta: number) => void;
}) {
  const { user: me } = useSessionUser();
  const [users, setUsers] = useState<ListUser[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    (which: ListKind, pageNum: number, append: boolean) => {
      setLoading(true);
      let request: Promise<any>;
      if (which === "requests") {
        request = api.get(`/follow/requests`);
      } else {
        request = api.get(`/follow/${userId}/${which}?page=${pageNum}`);
      }
      request
        .then((res) => {
          if (!res.data?.success) return;
          if (which === "requests") {
            setUsers(res.data.requests || []);
            setHasMore(false);
          } else {
            const list: ListUser[] = res.data.users || [];
            setUsers((prev) => (append ? [...prev, ...list] : list));
            setPage(res.data.page || pageNum);
            setHasMore(Boolean(res.data.hasMore));
          }
        })
        .catch(() => toast.error("Couldn't load the list"))
        .finally(() => setLoading(false));
    },
    [userId]
  );

  useEffect(() => {
    if (open) load(kind, 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  const respond = async (requesterId: string, accept: boolean) => {
    try {
      const res = await api.post(`/follow/requests/${requesterId}/${accept ? "accept" : "decline"}`);
      if (res.data?.success) {
        setUsers((prev) => prev.filter((u) => u._id !== requesterId));
        onCountChange?.(accept ? 1 : 0);
        toast.success(accept ? "Request accepted" : "Request declined");
      }
    } catch {
      toast.error("Couldn't respond");
    }
  };

  const titles: Record<ListKind, string> = {
    followers: "Followers",
    following: "Following",
    requests: "Follow requests",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-md overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">{titles[kind]}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[62vh] overflow-y-auto px-3 py-3">
          {loading && users.length === 0 ? (
            <div className="space-y-3 px-2 py-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-28 animate-pulse rounded bg-muted" />
                    <div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : users.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              {kind === "requests" ? "No pending requests." : `No ${kind} yet.`}
            </p>
          ) : (
            <ul className="space-y-1">
              {users.map((u) => (
                <li key={u._id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/50">
                  <Link href={`/profile/${u.username || u._id}`} onClick={() => onOpenChange(false)}>
                    <UserAvatar user={u} size={40} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/profile/${u.username || u._id}`}
                      onClick={() => onOpenChange(false)}
                      className="line-clamp-1 block text-sm font-semibold text-foreground hover:underline"
                    >
                      {u.firstName} {u.lastName}
                    </Link>
                    {u.username && <p className="truncate text-xs text-muted-foreground">@{u.username}</p>}
                  </div>

                  {kind === "requests" && me ? (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => respond(u._id, true)}
                        className="rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground hover:opacity-90"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => respond(u._id, false)}
                        className="rounded-full border border-border px-3 py-1 text-[11px] font-bold text-muted-foreground hover:text-foreground"
                      >
                        Decline
                      </button>
                    </div>
                  ) : me && me._id !== u._id ? (
                    <FollowAuthorButton userId={u._id} initialFollowing={kind === "following"} size="sm" />
                  ) : (
                    me?._id === u._id && <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </li>
              ))}
            </ul>
          )}

          {hasMore && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => load(kind, page + 1, true)}
                disabled={loading}
                className={cn(
                  "rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground hover:bg-muted",
                  loading && "opacity-60"
                )}
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
