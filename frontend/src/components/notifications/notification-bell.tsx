"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Eraser, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationRow, type NotificationData } from "@/components/notifications/notification-item";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;

/**
 * Header bell: unread badge, dropdown with the latest notifications,
 * mark-all-read, and a link to the full page. Polls while open or mounted.
 */
export function NotificationBell() {
  const { user, ready } = useSessionUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationData[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefTypes, setPrefTypes] = useState<string[]>([]);
  const [mutes, setMutes] = useState<Record<string, boolean>>({});

  const refresh = useCallback(
    (latestOnly = false) => {
      if (!user) return;
      if (latestOnly) {
        api
          .get("/notifications/unread-count")
          .then((r) => setUnread(r.data?.unreadCount || 0))
          .catch(() => {});
        return;
      }
      setLoading(true);
      api
        .get("/notifications", { params: { limit: 8 } })
        .then((r) => {
          setItems(r.data?.notifications || []);
          setUnread(r.data?.unreadCount || 0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [user]
  );

  // Poll unread count while signed in
  useEffect(() => {
    if (!ready || !user) return;
    refresh(true);
    const t = setInterval(() => refresh(true), POLL_MS);
    return () => clearInterval(t);
  }, [ready, user, refresh]);

  // Load full items when the dropdown opens
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems((p) => p.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch {}
  };

  const onRead = (id: string) => {
    api.post(`/notifications/${id}/read`).catch(() => {});
    setItems((p) => p.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
  };

  const onDelete = (id: string) => {
    api.delete(`/notifications/${id}`).catch(() => {});
    setItems((p) => p.filter((n) => n._id !== id));
    refresh(true);
  };

  const clearRead = async () => {
    try {
      const r = await api.post("/notifications/clear-read");
      setItems((p) => p.filter((n) => !n.read));
      if (r.data?.success) toast.success(`Cleared ${r.data.deleted} read notification${r.data.deleted === 1 ? "" : "s"}`);
    } catch {
      toast.error("Couldn't clear notifications");
    }
  };

  const loadPrefs = () => {
    api
      .get("/notifications/preferences")
      .then((r) => {
        setPrefTypes(r.data?.types || []);
        setMutes(r.data?.mutes || {});
      })
      .catch(() => {});
  };

  const toggleMute = (type: string) => {
    const next = { ...mutes, [type]: !mutes[type] };
    setMutes(next);
    api.put("/notifications/preferences", { mutes: next }).catch(() => toast.error("Couldn't save preference"));
  };

  if (ready && !user) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,380px)] p-2">
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <span className="text-sm font-bold text-foreground">Notifications</span>
          <div className="flex items-center gap-2.5">
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
            {items.some((n) => n.read) && (
              <button type="button" onClick={clearRead} title="Delete read notifications" className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                <Eraser className="h-3.5 w-3.5" /> Clear read
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setShowPrefs((v) => !v);
                if (!showPrefs) loadPrefs();
              }}
              title="Notification preferences"
              className="inline-flex items-center text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Per-type mute preferences (server-enforced via the notification service) */}
        {showPrefs && (
          <div className="mb-2 rounded-xl border border-border bg-muted/40 p-3">
            <p className="mb-2 text-[11px] font-bold text-foreground">Mute notification types</p>
            <div className="grid grid-cols-2 gap-1.5">
              {prefTypes.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-card px-2 py-1.5 text-[11px] font-medium text-foreground">
                  <input type="checkbox" checked={Boolean(mutes[t])} onChange={() => toggleMute(t)} className="h-3 w-3 accent-[#2563FF]" />
                  <span className="truncate capitalize">{t.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
              Muted types stop arriving immediately. Account-critical emails are unaffected.
            </p>
          </div>
        )}
        <div className="max-h-[70vh] space-y-1 overflow-y-auto">
          {loading && items.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {!loading && items.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nothing yet — likes, comments, follows and registrations land here.
            </p>
          )}
          {items.map((n) => (
            <NotificationRow key={n._id} n={n} onRead={onRead} onDelete={onDelete} compact />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full text-xs font-semibold"
          onClick={() => {
            setOpen(false);
            router.push("/notifications");
          }}
        >
          View all notifications
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Small bell with badge for the mobile bottom nav. */
export function NotificationsNavLink({ active, onClick }: { active: boolean; onClick?: () => void }) {
  const { user } = useSessionUser();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const pull = () =>
      api
        .get("/notifications/unread-count")
        .then((r) => setUnread(r.data?.unreadCount || 0))
        .catch(() => {});
    pull();
    const t = setInterval(pull, POLL_MS);
    return () => clearInterval(t);
  }, [user]);

  return (
    <Link
      href="/notifications"
      onClick={onClick}
      aria-label="Notifications"
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 pb-1.5 pt-2",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <span className="relative">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[8px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </span>
      <span className="text-[10px] font-semibold">Alerts</span>
    </Link>
  );
}
