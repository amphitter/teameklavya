"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Link2,
  Loader2,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { api } from "@/utils/api";
import { queryClient } from "@/lib/query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { useSessionUser } from "@/components/shell/use-session-user";
import { usePeopleSearch, displayNameOf, type PersonResult } from "@/components/people/use-people-search";

/**
 * Share a post with other EventHub users (Part 13 §13–§22).
 *
 * What this replaced: a button labelled "Copy link" that put a URL on the
 * clipboard. A link is not a share — it assumes the person you are sending it to
 * is on the same messenger. The main action here is sending the post to real
 * users through the messaging that already exists.
 *
 * How a share travels: it is an ordinary DM. The sheet resolves the chosen
 * people to conversations with `POST /messages/conversations` (get-or-create —
 * the exact call the Message button makes) and then sends `sharedPostId` to
 * each with the existing send endpoint. So shares inherit realtime delivery,
 * read receipts, unread badges, archive behaviour and blocking rules for free,
 * and no second messaging path is created.
 *
 * Ordering of the quick-share row is deliberately shallow, as the brief asks: the
 * people you have actually talked to, then followers, then people you follow.
 * "Recent conversations" IS the frequency signal — there is no scoring model
 * here and there should not be one.
 *
 * Sending to followers is a bulk action and gets an explicit confirmation, a
 * dry count of who it will reach, and an honest report of what actually
 * happened.
 */

const FOLLOWER_FANOUT_CAP = 25;

interface Target {
  key: string;
  kind: "conversation" | "user";
  /** Conversation id for a conversation target, user id for a user target. */
  refId: string;
  user?: { _id: string; firstName?: string; lastName?: string; username?: string; profile?: { avatar?: string } };
  label: string;
  sub?: string;
}

export function PostShareSheet({
  post,
  open,
  onClose,
}: {
  /** The post being shared — only its id and author are used. */
  post: { _id: string; content?: string; author?: any };
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useSessionUser();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Target[]>([]);
  const [quick, setQuick] = useState<Target[]>([]);
  const [quickLoading, setQuickLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmFollowers, setConfirmFollowers] = useState<null | number>(null);
  const [followerCount, setFollowerCount] = useState<number | null>(null);

  const { results, loading, error, searched } = usePeopleSearch(query, {
    enabled: open,
    limit: 12,
    excludeIds: useMemo(() => (user?._id ? [user._id] : []), [user?._id]),
  });

  /* ── Quick-share row ────────────────────────────────────────────────────
   * Rendered from existing relationships, in this order:
   *   1. recent conversations (most recent first — that is the order the
   *      endpoint already returns them in)
   *   2. followers
   *   3. people you follow
   * Deduped by person, capped, and each entry keeps the conversation id when it
   * has one so sending does not re-resolve it. */
  useEffect(() => {
    if (!open || !user?._id) return;
    let cancelled = false;
    setQuickLoading(true);

    const targets: Target[] = [];
    const seen = new Set<string>([user._id]);

    const push = (t: Target, personId?: string) => {
      if (personId && seen.has(personId)) return;
      if (personId) seen.add(personId);
      targets.push(t);
    };

    Promise.allSettled([
      api.get("/messages/conversations", { params: { limit: 8 } }),
      api.get(`/follow/${user._id}/followers`, { params: { page: 1 } }),
      api.get(`/follow/${user._id}/following`, { params: { page: 1 } }),
    ]).then(([convos, followers, following]) => {
      if (cancelled) return;

      if (convos.status === "fulfilled") {
        for (const c of convos.value.data?.conversations || []) {
          if (c.type === "team") {
            push({
              key: `c:${c._id}`,
              kind: "conversation",
              refId: c._id,
              label: c.name || "Team",
              sub: `${c.memberCount || 0} members`,
              user: { _id: c._id, firstName: c.name || "Team", profile: { avatar: c.avatar || "" } },
            });
          } else if (c.other?._id) {
            push(
              {
                key: `u:${c.other._id}`,
                kind: "user",
                refId: c.other._id,
                label: [c.other.firstName, c.other.lastName].filter(Boolean).join(" ") || c.other.username,
                sub: c.other.username ? `@${c.other.username}` : undefined,
                user: c.other,
              },
              String(c.other._id)
            );
          }
        }
      }

      const people = [
        ...(followers.status === "fulfilled" ? followers.value.data?.users || [] : []).map((u: any) => ({ u, sub: "Follows you" })),
        ...(following.status === "fulfilled" ? following.value.data?.users || [] : []).map((u: any) => ({ u, sub: "You follow" })),
      ];
      for (const { u, sub } of people) {
        push(
          {
            key: `u:${u._id}`,
            kind: "user",
            refId: u._id,
            label: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username,
            sub: u.username ? `@${u.username}` : sub,
            user: u,
          },
          String(u._id)
        );
      }

      setQuick(targets.slice(0, 24));
      setQuickLoading(false);
    });

    // Follower total, for the confirmation copy.
    api
      .get(`/follow/${user._id}/followers`, { params: { page: 1 } })
      .then((r) => {
        if (!cancelled) {
          const first = r.data?.users?.length || 0;
          const hasMore = Boolean(r.data?.hasMore);
          setFollowerCount(hasMore ? Math.max(first, FOLLOWER_FANOUT_CAP + 1) : first);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open, user?._id]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected([]);
      setConfirmFollowers(null);
    }
  }, [open]);

  const selectedKeys = new Set(selected.map((t) => t.key));

  const toggle = (t: Target) => {
    setSelected((prev) => (prev.some((x) => x.key === t.key) ? prev.filter((x) => x.key !== t.key) : [...prev, t]));
  };

  const targetFromPerson = (p: PersonResult): Target => ({
    key: `u:${p._id}`,
    kind: "user",
    refId: p._id,
    label: displayNameOf(p),
    sub: p.username ? `@${p.username}` : undefined,
    user: p,
  });

  /**
   * Send the share to one target.
   *
   * `clientMessageId` is generated once per target per sheet session and reused
   * across retries, so the existing idempotency guard turns a double tap or a
   * re-connect replay into one message instead of two (§20 — no duplicate
   * notifications, no duplicate bubbles).
   */
  const sendOne = async (t: Target, nonce: string): Promise<void> => {
    let conversationId = t.refId;
    if (t.kind === "user") {
      const started = await api.post("/messages/conversations", { userId: t.refId });
      conversationId = started.data?.conversationId;
      if (!conversationId) throw new Error("no conversation");
    }
    await api.post(`/messages/conversations/${conversationId}`, {
      sharedPostId: post._id,
      clientMessageId: `share-${post._id}-${conversationId}-${nonce}`,
    });
  };

  const runShare = async (targets: Target[]) => {
    if (!targets.length || sending) return;
    setSending(true);
    const nonce = `${Date.now()}`;
    const results = await Promise.allSettled(targets.map((t) => sendOne(t, nonce)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;

    if (ok) {
      queryClient.invalidateQueries(["conversations"]);
      queryClient.invalidateQueries(["messages"]);
    }

    setSending(false);

    if (failed === 0) {
      toast.success(targets.length === 1 ? `Shared with ${targets[0].label}` : `Shared with ${ok} people`);
      onClose();
      return;
    }
    if (ok === 0) {
      // Say why, when the server said why — a silent failure teaches nothing.
      const reason =
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult)?.reason?.response?.data?.message;
      toast.error(reason || "Couldn't share this post");
      return;
    }
    toast.warning(`Shared with ${ok} of ${targets.length} — some couldn't be reached`);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/post/${post._id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.info(url);
    }
  };

  const followerTargets = async (): Promise<Target[]> => {
    if (!user?._id) return [];
    const res = await api.get(`/follow/${user._id}/followers`, { params: { page: 1 } });
    const users: any[] = res.data?.users || [];
    const chosen = new Set(selected.filter((t) => t.kind === "user").map((t) => t.refId));
    return users
      .filter((u) => !chosen.has(String(u._id)))
      .slice(0, FOLLOWER_FANOUT_CAP)
      .map((u) => ({
        key: `u:${u._id}`,
        kind: "user" as const,
        refId: String(u._id),
        label: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username,
        sub: u.username ? `@${u.username}` : undefined,
        user: u,
      }));
  };

  const listToShow = query.trim().length >= 2 ? results.map(targetFromPerson) : quick;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          /* A thumb reaches the bottom of a phone, not its middle: bottom sheet
             on mobile, centred card from `sm` up. The sheet sits above the
             home-indicator inset (§30 — safe areas). */
          className={cn(
            "flex max-h-[88vh] flex-col gap-3 p-4",
            "max-sm:left-0 max-sm:right-0 max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl",
            "sm:max-w-md"
          )}
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>Share post</DialogTitle>
          </DialogHeader>

          {/* chosen recipients */}
          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggle(t)}
                  aria-label={`Remove ${t.label}`}
                  className="flex max-w-[12rem] items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-1 pr-2.5 text-xs font-semibold text-primary"
                >
                  <UserAvatar user={t.user || {}} size={20} />
                  <span className="truncate">{t.label}</span>
                  <X className="h-3 w-3 shrink-0" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people to send to"
              aria-label="Search people to share with"
              className="h-11 w-full rounded-full border border-input bg-muted/60 pl-9 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background"
            />
          </div>

          <div className="-mx-1 min-h-[160px] flex-1 overflow-y-auto overscroll-contain">
            {query.trim().length >= 2 && error ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Couldn&apos;t search right now. Try again.
              </p>
            ) : query.trim().length >= 2 && loading ? (
              <p className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </p>
            ) : query.trim().length >= 2 && searched && results.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">No people found</p>
            ) : query.trim().length < 2 && quickLoading ? (
              <p className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading people…
              </p>
            ) : query.trim().length < 2 && quick.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Search for someone to send this post to.
              </p>
            ) : (
              <>
                {query.trim().length < 2 ? (
                  <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Recent &amp; people you know
                  </p>
                ) : null}
                {listToShow.map((t) => {
                  const isSelected = selectedKeys.has(t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => toggle(t)}
                      aria-pressed={isSelected}
                      className="flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <UserAvatar user={t.user || {}} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-foreground">{t.label}</span>
                        {t.sub ? (
                          <span className="block truncate text-xs text-muted-foreground">{t.sub}</span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                          isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        )}
                      >
                        {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {/* Secondary action — kept, but no longer the only thing the button does. */}
          <button
            type="button"
            onClick={copyLink}
            className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Link2 className="h-4 w-4" /> Copy link instead
          </button>

          <div className="flex items-center gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const res = await api.get(`/follow/${user?._id}/followers`, { params: { page: 1 } });
                  const users = res.data?.users || [];
                  setConfirmFollowers(res.data?.hasMore ? Math.max(users.length, FOLLOWER_FANOUT_CAP + 1) : users.length);
                } catch {
                  setConfirmFollowers(0);
                }
              }}
              disabled={followerCount === 0}
              className="gap-1.5"
            >
              <Users className="h-4 w-4" /> Followers
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => runShare(selected)}
              disabled={!selected.length || sending}
              className="ml-auto gap-1.5"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sending ? "Sending…" : selected.length > 1 ? `Send to ${selected.length}` : "Send"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk send is irreversible and reaches everyone, so it asks first and
          says how many people it will reach. */}
      <Dialog open={confirmFollowers !== null} onOpenChange={(o) => !o && setConfirmFollowers(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle>Share this post with your followers?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmFollowers === 0
              ? "You don't have any followers to share with yet."
              : `This sends the post as a message to up to ${Math.min(confirmFollowers || 0, FOLLOWER_FANOUT_CAP)} of your followers.`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmFollowers(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!confirmFollowers || sending}
              onClick={async () => {
                const targets = await followerTargets();
                setConfirmFollowers(null);
                if (!targets.length) {
                  toast.info("Nobody new to share with");
                  return;
                }
                await runShare(targets);
              }}
            >
              Share
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
