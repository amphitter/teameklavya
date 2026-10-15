"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { CommunicationsHistory, CommunicationRow } from "@/components/admin/communications-history";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/utils/api";

const STATUS_FILTERS = ["all", "sent", "partial", "failed", "sending", "pending"] as const;

export default function AdminCommunicationsPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [rows, setRows] = useState<CommunicationRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadHistory = useCallback(async (cursor: string | null = null, append = false) => {
    if (append) setLoadingMore(true);
    else {
      setHistoryLoading(true);
      setHistoryError(false);
    }
    try {
      const response = await api.get("/admin/communications", {
        params: {
          scope: "PLATFORM",
          status: statusFilter === "all" ? undefined : statusFilter,
          cursor: cursor || undefined,
          limit: 25,
        },
      });
      const incoming: CommunicationRow[] = response.data?.items || [];
      setRows((previous) => append ? [...previous, ...incoming] : incoming);
      setHistoryCursor(response.data?.nextCursor || null);
      setHasMore(Boolean(response.data?.hasMore));
    } catch {
      if (!append) setHistoryError(true);
      else toast.error("Couldn't load older communications");
    } finally {
      setHistoryLoading(false);
      setLoadingMore(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadHistory(null, false);
  }, [loadHistory]);

  useEffect(() => {
    api.get("/admin/stats")
      .then((response) => setAudienceCount(Number(response.data?.totalUsers) || 0))
      .catch(() => setAudienceCount(null));
  }, []);

  const sendPlatformMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed) {
      toast.error("Confirm the platform-wide recipient list before sending");
      return;
    }
    if (!subject.trim() || !message.trim()) {
      toast.error("Add both a subject and message");
      return;
    }
    const audience = audienceCount == null ? "all EventHub user accounts" : `${audienceCount.toLocaleString()} EventHub user accounts`;
    if (!window.confirm(`Send this email to ${audience}?`)) return;

    setSending(true);
    try {
      const response = await api.post("/admin/communications/platform", {
        subject: subject.trim(),
        message: message.trim(),
      });
      const communication = response.data?.communication;
      toast.success(response.data?.message || "Platform message processed");
      setSubject("");
      setMessage("");
      setConfirmed(false);
      setStatusFilter("all");
      if (communication?._id) {
        setRows((previous) => [communication, ...previous.filter((row) => row._id !== communication._id)]);
      }
      await loadHistory(null, false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Couldn't send platform message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Admin tools</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Communications</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Compose a platform-wide email and review recipient-level delivery status. Messages are sent through the existing EventHub email service.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-xl bg-brand-light p-2.5 text-primary"><Mail className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">New platform message</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Audience: {audienceCount == null ? "all EventHub accounts" : `${audienceCount.toLocaleString()} EventHub accounts`}.
              The server determines recipients and enforces admin access.
            </p>
          </div>
        </div>

        <form onSubmit={sendPlatformMessage} className="space-y-4">
          <div>
            <label htmlFor="platform-subject" className="mb-1.5 block text-sm font-semibold text-foreground">Subject</label>
            <input
              id="platform-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={180}
              required
              className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
              placeholder="A clear, short subject"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{subject.length}/180</p>
          </div>
          <div>
            <label htmlFor="platform-message" className="mb-1.5 block text-sm font-semibold text-foreground">Message</label>
            <textarea
              id="platform-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={8000}
              required
              rows={7}
              className="min-h-36 w-full resize-y rounded-lg border border-input bg-background px-3.5 py-3 text-base leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
              placeholder="Write your message. Plain text and line breaks are supported."
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{message.length}/8000</p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-warning/30 bg-warning-light/50 p-3.5 text-sm text-foreground">
            <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} className="mt-0.5 h-5 w-5" />
            <span>
              <span className="block font-semibold">I understand this is a platform-wide email</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">It will be sent to every account with an email address, not only event participants.</span>
            </span>
          </label>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">Recipient emails and delivery status are retained for 90 days. Message bodies are not stored in history.</p>
            <Button type="submit" disabled={sending || !confirmed || !subject.trim() || !message.trim()} className="min-h-11 w-full gap-2 sm:w-auto">
              <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send platform message"}
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Platform history</h2>
            <p className="mt-1 text-sm text-muted-foreground">Platform-wide messages and Event announcements sent to the whole user base.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as (typeof STATUS_FILTERS)[number])}
              className="min-h-11 rounded-lg border border-input bg-card px-3 text-base text-foreground outline-none focus:border-primary sm:text-sm"
            >
              {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : status[0].toUpperCase() + status.slice(1)}</option>)}
            </select>
          </label>
        </div>
        <CommunicationsHistory
          rows={rows}
          loading={historyLoading}
          error={historyError}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => void loadHistory(historyCursor, true)}
          deliveryUrlFor={(communicationId) => `/admin/communications/${communicationId}/deliveries`}
        />
      </section>
    </div>
  );
}
