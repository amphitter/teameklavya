"use client";

/**
 * Messaging latency instrumentation (Phase: low-latency upgrade)
 * ───────────────────────────────────────────────────────────────
 * Privacy-conscious, metadata only. No bodies, tokens, attachments.
 * Measures:
 *  - send-to-ack p50/p95 (client → server persist → ack)
 *  - client queue time (optimistic → network start)
 *  - reconnect gap fetch latency
 *  - duplicate suppression count
 *
 * Stored in memory, sampled, exposed via window.__EH_MSG_METRICS__ for
 * diagnostics. No external logging unless explicitly enabled.
 */

export type MetricEvent = {
  type: "send_to_ack" | "queue" | "reconnect_fetch" | "duplicate_suppressed" | "send_failed" | "outbox_retry";
  conversationId?: string;
  durationMs?: number;
  at: number;
  meta?: Record<string, unknown>;
};

const MAX_EVENTS = 200;
const events: MetricEvent[] = [];

function push(e: MetricEvent) {
  events.push(e);
  if (events.length > MAX_EVENTS) events.shift();
  // Expose for diagnostics in devtools
  if (typeof window !== "undefined") {
    (window as unknown as { __EH_MSG_METRICS__?: MetricEvent[] }).__EH_MSG_METRICS__ = events.slice();
  }
  // Optional: console in development for visibility
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[msg-metrics] ${e.type}`, e.durationMs != null ? `${e.durationMs}ms` : "", e.meta ?? "");
  }
}

export function recordLatency(
  type: MetricEvent["type"],
  durationMs: number,
  opts: { conversationId?: string; meta?: Record<string, unknown> } = {}
) {
  if (!shouldSample()) return;
  push({ type, durationMs, at: Date.now(), conversationId: opts.conversationId, meta: opts.meta });
}

export function recordEvent(type: MetricEvent["type"], opts: { conversationId?: string; meta?: Record<string, unknown> } = {}) {
  if (!shouldSample() && type !== "duplicate_suppressed" && type !== "send_failed") return;
  push({ type, at: Date.now(), conversationId: opts.conversationId, meta: opts.meta });
}

/** Sample 100% in dev, 10% in prod to keep overhead low */
export function shouldSample(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "development") return true;
  return Math.random() < 0.1;
}

export function getMetricsSnapshot(): MetricEvent[] {
  return events.slice();
}

export function getLatencyStats(type: MetricEvent["type"] = "send_to_ack"): { p50: number | null; p95: number | null; count: number; avg: number | null } {
  const filtered = events.filter((e) => e.type === type && typeof e.durationMs === "number");
  if (!filtered.length) return { p50: null, p95: null, count: 0, avg: null };
  const sorted = filtered.map((e) => e.durationMs as number).sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { p50, p95, count: sorted.length, avg: Math.round(avg) };
}

// Expose helpers for manual testing in console
if (typeof window !== "undefined") {
  (window as unknown as { __EH_MSG_STATS__?: () => unknown }).__EH_MSG_STATS__ = () =>
    ({
      send_to_ack: getLatencyStats("send_to_ack"),
      reconnect_fetch: getLatencyStats("reconnect_fetch"),
      queue: getLatencyStats("queue"),
      recent: getMetricsSnapshot().slice(-20),
    });
}
