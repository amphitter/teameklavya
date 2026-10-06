"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cn } from "@/lib/utils";

/**
 * Follow pill for post authors and profiles — three real states:
 *   Follow · Following · Requested (private profiles)
 * Optimistic toggle with rollback on API failure. Statuses are fetched once
 * per user (module cache) so a feed of posts by the same author costs one call.
 */

interface FollowState {
  following: boolean;
  requested: boolean;
}

const statusCache = new Map<string, Promise<FollowState | null>>();

function fetchStatus(userId: string): Promise<FollowState | null> {
  if (!statusCache.has(userId)) {
    const p = api
      .get(`/follow/${userId}/status`)
      .then((res) => {
        if (res.data?.success) {
          const state = { following: Boolean(res.data.following), requested: Boolean(res.data.requested) };
          statusCache.set(userId, Promise.resolve(state));
          return state;
        }
        return null;
      })
      .catch(() => null);
    statusCache.set(userId, p);
  }
  return statusCache.get(userId)!;
}

export function FollowAuthorButton({
  userId,
  initialFollowing,
  size = "sm",
  withStatus = false,
}: {
  userId: string;
  initialFollowing: boolean;
  size?: "sm" | "md";
  /** Fetch the precise state (requested vs following) — used on profiles. */
  withStatus?: boolean;
}) {
  const { user } = useSessionUser();
  const [state, setState] = useState<FollowState>({ following: initialFollowing, requested: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!withStatus || !user || user._id === userId) return;
    let cancelled = false;
    fetchStatus(userId).then((s) => {
      if (!cancelled && s) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, user?._id, withStatus]);

  if (!user || user._id === userId) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const prev = state;
    // Optimistic: accepted → none, pending → none, none → follow/request
    const next: FollowState =
      state.following || state.requested
        ? { following: false, requested: false }
        : { following: true, requested: false };
    setState(next);
    try {
      const res = await api.post(`/follow/${userId}`);
      if (res.data?.success) {
        const after = { following: Boolean(res.data.following), requested: Boolean(res.data.requested) };
        setState(after);
        statusCache.set(userId, Promise.resolve(after));
        if (after.following) toast.success("Following — their posts will appear in your Following tab");
        else if (after.requested) toast.success("Follow request sent");
      } else {
        throw new Error(res.data?.message);
      }
    } catch (err: any) {
      setState(prev); // rollback
      toast.error(err.response?.data?.message || "Couldn't update follow");
    } finally {
      setBusy(false);
    }
  };

  const isFollowing = state.following;
  const isRequested = state.requested;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={isFollowing}
      className={cn(
        "shrink-0 rounded-full font-bold transition-colors",
        size === "sm" ? "px-3 py-1 text-[11px]" : "px-4 py-1.5 text-xs",
        isFollowing
          ? "border border-border bg-muted text-muted-foreground hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
          : isRequested
            ? "border border-border bg-muted text-muted-foreground hover:border-destructive/40 hover:text-destructive"
            : "bg-primary text-primary-foreground hover:opacity-90"
      )}
    >
      {isFollowing ? "Following" : isRequested ? "Requested" : "+ Follow"}
    </button>
  );
}
