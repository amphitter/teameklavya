/**
 * Completion Service (Part 4, Phase 9 — spec §60–63).
 *
 * The single `event:end` hook: fires when an event completes (and lazily
 * from the results endpoint if the first attempt failed). Everything it
 * does is derived from the immutable EventResult snapshot — never client
 * claims, never live collections, never manual grants. Idempotent by
 * design (unique indexes swallow repeats), and it NEVER throws upward:
 * a hook failure must not break completion or results reads.
 *
 *  - Achievements (§61): first_live_event, live_participant, top_10,
 *    top_3, quiz_winner — extends Part 3's engine with the same discipline.
 *  - Certificates (§62): generation REQUESTS (pending) — winner for the
 *    podium, participation for everyone who answered. No designer yet.
 */
const UserAchievement = require("../models/userAchievement.model");
const Certificate = require("../models/certificate.model");
const Event = require("../models/event.model");
const { notify } = require("./notification.service");

/** Codes this event qualifies a participant for, from their snapshot row. */
function qualifiedCodes(entry) {
  const codes = ["first_live_event"];
  if (entry.answered >= 1) codes.push("live_participant");
  if (entry.rank <= 10) codes.push("top_10");
  if (entry.rank <= 3) codes.push("top_3");
  if (entry.rank === 1 && entry.score > 0) codes.push("quiz_winner");
  return codes;
}

/**
 * Award live-event achievements + create certificate requests.
 * @param {object} resultDoc — the stored EventResult (lean or document)
 */
async function onEventCompleted(eventId, resultDoc) {
  eventId = String(eventId);
  const leaderboard = (resultDoc && resultDoc.leaderboard) || [];
  if (!leaderboard.length) return;

  const event = await Event.findById(eventId).select("title").lean();
  const eventTitle = event?.title || "";

  /* ── Achievements: unlock what isn't unlocked yet (idempotent) ── */
  const userIds = leaderboard.map((e) => e.participantId).filter(Boolean).map(String);
  const existing = await UserAchievement.find({ user: { $in: userIds } }).select("user code").lean();
  const have = new Set(existing.map((d) => `${d.user}:${d.code}`));

  const toCreate = [];
  const newlyByUser = new Map();
  for (const entry of leaderboard) {
    if (!entry.participantId) continue;
    const uid = String(entry.participantId);
    const fresh = [];
    for (const code of qualifiedCodes(entry)) {
      if (!have.has(`${uid}:${code}`)) {
        toCreate.push({ user: entry.participantId, code, context: { event: eventId } });
        fresh.push(code);
        have.add(`${uid}:${code}`); // dedupe within this batch too
      }
    }
    if (fresh.length) newlyByUser.set(uid, fresh);
  }

  if (toCreate.length) {
    try {
      // ordered:false → duplicate-key races with other sockets are skipped
      await UserAchievement.insertMany(toCreate, { ordered: false });
    } catch (err) {
      if (String(err.code) !== "11000" && !String(err.name).includes("Bulk")) {
        console.error("Achievement award failed:", err.message);
      }
    }
    for (const [uid, codes] of newlyByUser) {
      // System notification per new unlock (same pattern as the engine)
      for (const code of codes) {
        notify({ user: uid, actor: undefined, type: "achievement" }).catch(() => {});
      }
    }
  }

  /* ── Certificate requests (§62): pending until a designer exists ── */
  const certificates = leaderboard
    .filter((e) => e.participantId && (e.answered >= 1 || e.rank <= 3))
    .map((e) => ({
      event: eventId,
      user: e.participantId,
      kind: e.rank <= 3 ? "winner" : "participation",
      rank: e.rank,
      score: e.score || 0,
      eventTitle,
      status: "pending",
    }));

  if (certificates.length) {
    try {
      // Upsert-once semantics: existing rows keep their original status
      await Certificate.bulkWrite(
        certificates.map((c) => ({
          updateOne: {
            filter: { event: c.event, user: c.user },
            update: { $setOnInsert: c },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    } catch (err) {
      console.error("Certificate request failed:", err.message);
    }
  }

  return { achievementsAwarded: toCreate.length, certificatesRequested: certificates.length };
}

/** Certificate availability for a participant (results screen / memory page). */
async function certificateFor(eventId, userId) {
  const Certificate = require("../models/certificate.model");
  const cert = await Certificate.findOne({ event: eventId, user: userId }).lean();
  if (!cert) return { available: false };
  return {
    available: true,
    kind: cert.kind,
    status: cert.status, // "pending" until the designer flow exists (§62)
    rank: cert.rank,
  };
}

module.exports = { onEventCompleted, certificateFor, qualifiedCodes };
