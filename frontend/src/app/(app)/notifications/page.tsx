"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { NotificationRow, type NotificationData } from "@/components/notifications/notification-item";

/** Full notifications page — everything that ever happened, newest first. */
export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    api
      .get("/notifications", { params: { limit: 25 } })
      .then((r) => {
        setItems(r.data?.notifications || []);
        setHasMore(Boolean(r.data?.hasMore));
        setUnread(r.data?.unreadCount || 0);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    api
      .get("/notifications", { params: { limit: 25, page: Math.ceil(items.length / 25) + 1 } })
      .then((r) => {
        setItems((p) => [...p, ...(r.data?.notifications || [])]);
        setHasMore(Boolean(r.data?.hasMore));
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

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
  };

  return (
    <div className="mx-auto max-w-2xl px-3 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {unread > 0 ? `${unread} unread` : "You're all caught up"}
          </p>
        </div>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead} className="gap-1.5">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[68px]" />)
        ) : error ? (
          <ErrorState title="Couldn't load notifications" onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="When people follow you, like or comment on your posts, or register for your events, you'll see it here."
          />
        ) : (
          <>
            {items.map((n) => (
              <NotificationRow key={n._id} n={n} onRead={onRead} onDelete={onDelete} />
            ))}
            {hasMore && (
              <Button variant="outline" className="w-full" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
