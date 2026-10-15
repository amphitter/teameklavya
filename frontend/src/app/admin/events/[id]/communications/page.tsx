"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Mail, Search, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { CommunicationsHistory, CommunicationRow } from "@/components/admin/communications-history";
import { EventTabs } from "@/components/admin/event-tabs";

interface Participant {
  _id: string;
  userId?: { _id?: string; firstName?: string; lastName?: string; email?: string } | null;
  status?: string;
}
interface SelectedRecipient {
  name: string;
  email: string;
}

const MAX_RECIPIENTS = 500;

export default function EventCommunicationsPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<any>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState(false);

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<Record<string, SelectedRecipient>>({});

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantLoading, setParticipantLoading] = useState(true);
  const [participantError, setParticipantError] = useState(false);
  const [participantMoreLoading, setParticipantMoreLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMoreParticipants, setHasMoreParticipants] = useState(false);
  const participantRequest = useRef<AbortController | null>(null);

  const [history, setHistory] = useState<CommunicationRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyMoreLoading, setHistoryMoreLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setEventLoading(true);
    setEventError(false);
    api.get(`/events/${id}`)
      .then((response) => {
        if (!active) return;
        if (!response.data?.event) throw new Error("Event unavailable");
        setEvent(response.data.event);
      })
      .catch(() => { if (active) setEventError(true); })
      .finally(() => { if (active) setEventLoading(false); });
    return () => { active = false; };
  }, [id]);

  const fetchParticipants = useCallback(async (cursor: string | null = null) => {
    participantRequest.current?.abort();
    const controller = new AbortController();
    participantRequest.current = controller;
    if (cursor) setParticipantMoreLoading(true);
    else {
      setParticipantLoading(true);
      setParticipantError(false);
    }

    try {
      const params: Record<string, string> = { limit: "50" };
      if (debouncedSearch) params.q = debouncedSearch;
      if (statusFilter !== "all") params.status = statusFilter;
      if (cursor) params.cursor = cursor;
      const response = await api.get(`/registration/responses/${id}`, { params, signal: controller.signal });
      const incoming: Participant[] = response.data?.items || response.data?.responses || [];
      setParticipants((previous) => cursor ? [...previous, ...incoming] : incoming);
      setNextCursor(response.data?.nextCursor || null);
      setHasMoreParticipants(Boolean(response.data?.hasMore));
    } catch (error: any) {
      if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") return;
      if (!cursor) setParticipantError(true);
      else toast.error("Couldn't load more participants");
    } finally {
      setParticipantLoading(false);
      setParticipantMoreLoading(false);
    }
  }, [id, debouncedSearch, statusFilter]);

  useEffect(() => {
    void fetchParticipants(null);
    return () => participantRequest.current?.abort();
  }, [fetchParticipants]);

  const loadHistory = useCallback(async (cursor: string | null = null, append = false) => {
    if (append) setHistoryMoreLoading(true);
    else {
      setHistoryLoading(true);
      setHistoryError(false);
    }
    try {
      const response = await api.get(`/events/${id}/communications`, { params: { cursor: cursor || undefined, limit: 25 } });
      const incoming: CommunicationRow[] = response.data?.items || [];
      setHistory((previous) => append ? [...previous, ...incoming] : incoming);
      setHistoryNextCursor(response.data?.nextCursor || null);
      setHistoryHasMore(Boolean(response.data?.hasMore));
    } catch {
      if (!append) setHistoryError(true);
      else toast.error("Couldn't load older Event messages");
    } finally {
      setHistoryLoading(false);
      setHistoryMoreLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadHistory(null, false); }, [loadHistory]);

  const toggleRecipient = (userId: string, user: Participant["userId"]) => {
    setSelected((previous) => {
      if (previous[userId]) {
        const next = { ...previous };
        delete next[userId];
        return next;
      }
      if (Object.keys(previous).length >= MAX_RECIPIENTS) {
        toast.error(`You can select up to ${MAX_RECIPIENTS} recipients at a time`);
        return previous;
      }
      const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Attendee";
      return { ...previous, [userId]: { name, email: user?.email || "" } };
    });
  };

  const selectVisiblePage = () => {
    const users = participants
      .map((participant) => participant.userId)
      .filter((user): user is NonNullable<Participant["userId"]> => Boolean(user?._id && user.email));
    const newUsers = users.filter((user) => !selected[user._id!]);
    if (Object.keys(selected).length + newUsers.length > MAX_RECIPIENTS) {
      toast.error(`Selection cannot exceed ${MAX_RECIPIENTS} registered recipients`);
      return;
    }
    setSelected((previous) => {
      const next = { ...previous };
      for (const user of users) {
        const userId = user._id!;
        next[userId] = { name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email!, email: user.email! };
      }
      return next;
    });
  };

  const sendEventMessage = async (submitEvent: React.FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const userIds = Object.keys(selected);
    if (!userIds.length) {
      toast.error("Select at least one registered recipient");
      return;
    }
    if (!subject.trim() || !message.trim()) {
      toast.error("Add both a subject and message");
      return;
    }
    if (!window.confirm(`Send “${subject.trim()}” to ${userIds.length} selected registered recipients of this Event?`)) return;

    setSending(true);
    try {
      const response = await api.post(`/events/${id}/communications`, {
        subject: subject.trim(),
        message: message.trim(),
        userIds,
      });
      toast.success(response.data?.message || "Event message processed");
      setSubject("");
      setMessage("");
      setSelected({});
      await loadHistory(null, false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Couldn't send Event message");
    } finally {
      setSending(false);
    }
  };

  const visibleUsers = participants.filter((participant) => Boolean(participant.userId?._id && participant.userId.email));
  const selectedCount = Object.keys(selected).length;

  if (eventLoading) return <div className="mx-auto max-w-6xl animate-pulse space-y-4"><div className="h-8 w-56 rounded bg-muted" /><div className="h-28 rounded-xl bg-muted" /></div>;
  if (eventError || !event) return <div className="mx-auto max-w-6xl rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">Couldn't load this Event or you don't have permission to manage it.</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href={`/admin/events/${id}`} className="inline-flex min-h-11 max-w-full items-center break-words text-sm font-semibold text-primary hover:underline">← {event.title}</Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Event communications</h1>
        <p className="mt-1 break-words text-sm text-muted-foreground">Send a custom message to registered attendees and review per-recipient delivery.</p>
      </div>
      <EventTabs active="communications" />

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-xl bg-brand-light p-2.5 text-primary"><Mail className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h2 className="break-words text-lg font-bold text-foreground">Compose for {event.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Only users registered for this Event can be selected. The server rechecks both Event-management permission and recipient eligibility.</p>
          </div>
        </div>

        <form onSubmit={sendEventMessage} className="space-y-5">
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <label htmlFor="attendee-search" className="mb-1.5 block text-sm font-semibold text-foreground">Registered recipients</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="attendee-search"
                    value={search}
                    onChange={(inputEvent) => setSearch(inputEvent.target.value)}
                    placeholder="Search names or emails…"
                    className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(inputEvent) => setStatusFilter(inputEvent.target.value)}
                  aria-label="Filter registrations by status"
                  className="min-h-11 rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary sm:text-sm"
                >
                  <option value="all">All statuses</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                </select>
                <button type="button" onClick={selectVisiblePage} disabled={!visibleUsers.length} className="min-h-11 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">
                  Select this page
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"><Users className="h-4 w-4 text-primary" /> {selectedCount} selected <span className="font-normal text-muted-foreground">(max {MAX_RECIPIENTS})</span></span>
              {selectedCount > 0 && <button type="button" onClick={() => setSelected({})} className="min-h-11 rounded-md px-2 text-sm font-semibold text-primary hover:bg-brand-light">Clear selection</button>}
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              {participantLoading ? (
                <div className="space-y-2 p-3"><div className="h-12 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /></div>
              ) : participantError ? (
                <div className="p-4 text-sm text-destructive">Couldn't load Event registrations. <button type="button" onClick={() => void fetchParticipants(null)} className="inline-flex min-h-11 items-center rounded px-1 font-semibold underline">Retry</button></div>
              ) : visibleUsers.length === 0 ? (
                <div className="p-5 text-center text-sm text-muted-foreground">No matching registered accounts with an email address.</div>
              ) : (
                <ul className="max-h-[360px] divide-y divide-border overflow-y-auto">
                  {visibleUsers.map((participant) => {
                    const user = participant.userId!;
                    const userId = user._id!;
                    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Event attendee";
                    const isSelected = Boolean(selected[userId]);
                    return (
                      <li key={userId}>
                        <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/40 sm:px-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRecipient(userId, user)}
                            className="h-5 w-5 shrink-0 accent-primary"
                            aria-label={`Select ${name} ${user.email}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
                            <span className="block break-all text-xs text-muted-foreground">{user.email}</span>
                          </span>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-semibold capitalize text-muted-foreground">{participant.status || "registered"}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!participantLoading && !participantError && hasMoreParticipants && (
                <div className="border-t border-border p-2 text-center">
                  <button type="button" disabled={participantMoreLoading} onClick={() => nextCursor && void fetchParticipants(nextCursor)} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-primary hover:bg-brand-light disabled:opacity-50">
                    {participantMoreLoading ? "Loading…" : "Load more registrations"}
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Search and select across pages. Selection stays in place when you search; emails are sent only to selected accounts, up to {MAX_RECIPIENTS} per message.</p>
          </div>

          <div className="grid gap-4 border-t border-border pt-5">
            <div>
              <label htmlFor="event-message-subject" className="mb-1.5 block text-sm font-semibold text-foreground">Subject</label>
              <input
                id="event-message-subject"
                value={subject}
                onChange={(inputEvent) => setSubject(inputEvent.target.value)}
                maxLength={180}
                required
                className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
                placeholder="Event update subject"
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">{subject.length}/180</p>
            </div>
            <div>
              <label htmlFor="event-message-body" className="mb-1.5 block text-sm font-semibold text-foreground">Message</label>
              <textarea
                id="event-message-body"
                value={message}
                onChange={(inputEvent) => setMessage(inputEvent.target.value)}
                maxLength={8000}
                required
                rows={6}
                className="min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3.5 py-3 text-base leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
                placeholder="Share event details, schedule changes, or useful attendee information."
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">{message.length}/8000</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-muted-foreground">Recipient emails and delivery statuses are retained for 90 days. Message bodies are not stored in history.</p>
              <Button type="submit" disabled={sending || !selectedCount || !subject.trim() || !message.trim()} className="min-h-11 w-full gap-2 sm:w-auto">
                <Send className="h-4 w-4" /> {sending ? "Sending…" : `Send to ${selectedCount} selected`}
              </Button>
            </div>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Event message history</h2>
          <p className="mt-1 text-sm text-muted-foreground">Custom messages and existing Event-scoped invitation/RSVP emails.</p>
        </div>
        <CommunicationsHistory
          rows={history}
          loading={historyLoading}
          error={historyError}
          hasMore={historyHasMore}
          loadingMore={historyMoreLoading}
          onLoadMore={() => void loadHistory(historyNextCursor, true)}
          deliveryUrlFor={(communicationId) => `/events/${id}/communications/${communicationId}/deliveries`}
        />
      </section>
    </div>
  );
}
