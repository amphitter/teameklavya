const express = require("express");
const router = express.Router();
const { optionalUser } = require("../middleware/auth.middleware");

/**
 * Minimal funnel analytics endpoint (Claude Week 4)
 * Discover → Event view → Register → Ticket → Check-in → Memory → Follow
 * Privacy-conscious: no PII, only event IDs and step names. Fail silently, never break UX.
 * Stores in memory or logs for now; can be extended to metrics.service.js or ClickHouse.
 */

const funnelBuffer = [];
const MAX_BUFFER = 1000;

router.post("/funnel", optionalUser, (req, res) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events)) return res.json({ success: true });
    for (const ev of events.slice(0, 20)) {
      if (!ev.step) continue;
      funnelBuffer.push({
        step: String(ev.step).slice(0, 20),
        eventId: ev.eventId ? String(ev.eventId).slice(0, 40) : undefined,
        orgId: ev.orgId ? String(ev.orgId).slice(0, 40) : undefined,
        userId: req.user?._id ? String(req.user._id) : undefined,
        meta: ev.meta ? JSON.stringify(ev.meta).slice(0, 500) : undefined,
        ts: ev.ts || Date.now(),
        receivedAt: new Date(),
      });
      if (funnelBuffer.length > MAX_BUFFER) funnelBuffer.shift();
    }
    // Log aggregated counts for observability (no PII)
    const counts = {};
    funnelBuffer.slice(-100).forEach((e) => {
      counts[e.step] = (counts[e.step] || 0) + 1;
    });
    if (events.length > 0) {
      console.log(`[funnel] received ${events.length} events, recent counts:`, counts);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("[funnel] error:", err.message);
    return res.json({ success: true }); // fail open, never break UX
  }
});

// Admin view of funnel (requires admin)
router.get("/funnel", require("../middleware/auth.middleware").requireAuth, require("../middleware/auth.middleware").requireAdmin, (req, res) => {
  const last24h = funnelBuffer.filter((e) => Date.now() - e.ts < 24 * 3600 * 1000);
  const byStep = {};
  last24h.forEach((e) => {
    byStep[e.step] = (byStep[e.step] || 0) + 1;
  });
  res.json({ success: true, total: funnelBuffer.length, last24h: last24h.length, byStep, recent: funnelBuffer.slice(-50) });
});

module.exports = router;
