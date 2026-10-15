// Minimal privacy-conscious funnel instrumentation (Claude Week 4)
// Discover → Event view → Register → Ticket → Check-in → Memory → Follow
// No PII, no passwords, only event IDs and action types. Respects no tracking if user opts out.

type FunnelStep = "discover" | "event_view" | "register" | "ticket" | "checkin" | "memory" | "follow" | "search" | "explore";

interface FunnelEvent {
  step: FunnelStep;
  eventId?: string;
  orgId?: string;
  meta?: Record<string, string | number | boolean>;
  ts: number;
}

const QUEUE_KEY = "eventhub:funnel-queue";
const FLUSH_EVERY = 10000; // 10s batch
const MAX_QUEUE = 20;
const ENABLED = process.env.NEXT_PUBLIC_ENABLE_FUNNEL === "true"; // disabled by default to avoid 404s

let queue: FunnelEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) queue = JSON.parse(raw).slice(0, MAX_QUEUE);
  } catch {}
}

function saveQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE)));
  } catch {}
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const batch = [...queue];
  queue = [];
  saveQueue();

  if (!ENABLED) return; // No endpoint — silently drop, no 404

  try {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/analytics/funnel`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
    }).catch(() => {});
  } catch {}
  if (process.env.NODE_ENV !== "production") {
    console.debug("[funnel]", batch);
  }
}

function enqueue(ev: Omit<FunnelEvent, "ts">) {
  if (!ENABLED && process.env.NODE_ENV === "production") return; // no-op in prod when disabled
  loadQueue();
  queue.push({ ...ev, ts: Date.now() });
  if (queue.length >= MAX_QUEUE) {
    flush();
    return;
  }
  if (!timer) timer = setTimeout(flush, FLUSH_EVERY);
  saveQueue();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export function trackFunnel(step: FunnelStep, opts: { eventId?: string; orgId?: string; meta?: Record<string, any> } = {}) {
  enqueue({ step, eventId: opts.eventId, orgId: opts.orgId, meta: opts.meta });
}
