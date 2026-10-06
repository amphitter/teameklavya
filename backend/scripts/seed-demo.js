/**
 * DEMO MODE SEEDER (Part 4, Phase 10 — spec §97: one-command demo event).
 * ─────────────────────────────────────────────────────────────────────
 * Creates a clearly-labeled demo organizer + a fully-staged LIVE event
 * (welcome → quiz → poll → Q&A → leaderboard) so the whole Part 4 flow
 * can be demonstrated end-to-end without touching real data.
 *
 * SAFETY (non-negotiable):
 *   • DEV-ONLY. Refuses to run unless NODE_ENV=development AND DEMO_MODE=1.
 *   • NEVER runs in production — checked before anything else.
 *   • Every fixture is labeled "DEMO — …" so it can never be mistaken
 *     for real content, and `--reset` deletes exactly those labels.
 *
 * Usage:
 *   NODE_ENV=development DEMO_MODE=1 npm run seed:demo
 *   NODE_ENV=development DEMO_MODE=1 npm run seed:demo -- --reset
 */

/* ── gate 1: environment (before any require that touches the DB) ── */
if (process.env.NODE_ENV === "production") {
  console.error("⛔ REFUSED: the demo seeder must NEVER run against production.");
  process.exit(1);
}
if (process.env.NODE_ENV !== "development" || process.env.DEMO_MODE !== "1") {
  console.error("⛔ REFUSED: demo mode is dev-only.");
  console.error("   To run it locally:  NODE_ENV=development DEMO_MODE=1 npm run seed:demo");
  process.exit(1);
}

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const Activity = require("../models/activity.model");
const Question = require("../models/question.model");

const DEMO_TAG = "DEMO —";
const ORG_EMAIL = "demo-organizer@eventhub.dev";
const ORG_PASSWORD = "demo1234";
const FRONTEND = process.env.FRONTEND_URL || "http://localhost:3000";

const bye = (code) => process.exit(code);

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("⛔ MONGO_URI is not set — configure your local .env first.");
    bye(1);
  }
  await mongoose.connect(process.env.MONGO_URI);

  /* ── optional reset: delete ONLY demo-labeled fixtures ── */
  if (process.argv.includes("--reset")) {
    const demoEvents = await Event.find({ title: { $regex: `^${DEMO_TAG}` } }).select("_id").lean();
    const ids = demoEvents.map((e) => e._id);
    if (ids.length) {
      await Question.deleteMany({ activity: { $in: await Activity.find({ event: { $in: ids } }).select("_id").lean().then((a) => a.map((x) => x._id)) } });
      await Activity.deleteMany({ event: { $in: ids } });
      await Event.deleteMany({ _id: { $in: ids } });
      console.log(`🧹 Removed ${ids.length} previous demo event(s).`);
    } else {
      console.log("🧹 No previous demo events found.");
    }
  }

  /* ── demo organizer (idempotent) ── */
  let organizer = await User.findOne({ email: ORG_EMAIL });
  if (organizer) {
    organizer.passwordHash = await bcrypt.hash(ORG_PASSWORD, 10); // keep the documented password working
    organizer.emailVerified = true;
    organizer.suspendedAt = null;
    await organizer.save();
  } else {
    organizer = await User.create({
      firstName: "Demo",
      lastName: "Organizer",
      email: ORG_EMAIL,
      passwordHash: await bcrypt.hash(ORG_PASSWORD, 10),
      emailVerified: true,
      bio: "Demo fixture account — safe to delete",
    });
  }

  const existing = await Event.findOne({ title: { $regex: `^${DEMO_TAG}` }, createdBy: organizer._id });
  if (existing) {
    console.log("\nℹ️  A demo event already exists:");
    console.log(`   • ${existing.title}  (slug: ${existing.slug}, joinCode: ${existing.joinCode})`);
    console.log(`   • Organizer login: ${ORG_EMAIL} / ${ORG_PASSWORD}`);
    console.log("   • Re-run with --reset to rebuild it fresh.");
    await mongoose.disconnect();
    bye(0);
  }

  /* ── the demo event — fully staged, clearly labeled ── */
  const event = await Event.create({
    title: `${DEMO_TAG} EventHub Live Showcase`,
    description: "Demo fixture — a fully staged live event (quiz, poll, Q&A, leaderboard). Safe to delete.",
    category: "Workshop",
    eventType: "online",
    onlineEventLink: "https://meet.example.com/demo-room",
    organizer: "Demo Organizer",
    createdBy: organizer._id,
    visibility: "public",
    startDate: new Date(Date.now() + 30 * 60e3),
    endDate: new Date(Date.now() + 3 * 3600e3),
    maxAttendees: 200,
    price: 0,
    liveState: "WAITING", // doors open — participants can enter the waiting room before the organizer starts
    liveSettings: {
      leaderboardVisibility: "every_question", // demo the live re-ranking board
      chatEnabled: true,
      requireRegistration: false,
      requireCheckIn: false,
      allowLateJoin: true,
      scoring: { basePoints: 100, speedBonus: 50, negativeMarking: 0, questionWeighting: true },
    },
  });

  /* Welcome (no questions — the generic Activity Engine carries any type) */
  await Activity.create({
    event: event._id,
    type: "WELCOME",
    title: `${DEMO_TAG} Welcome & rules`,
    order: 0,
    state: "UPCOMING",
    config: { notes: "Two minutes of housekeeping, then we go live." },
  });

  /* Quiz — 5 clearly-labeled demo questions */
  const quiz = await Activity.create({ event: event._id, type: "QUIZ", title: `${DEMO_TAG} Warm-up quiz`, order: 1, state: "UPCOMING" });
  const demoQuestions = [
    { text: "DEMO Q1 — Which planet is known as the Red Planet?", options: ["Mars", "Venus", "Mercury", "Neptune"], correctAnswer: 0, points: 100, timeLimit: 20 },
    { text: "DEMO Q2 — What does 'HTTP' stand for?", options: ["HyperText Transfer Protocol", "High Transfer Text Protocol", "HyperText Transit Pass", "None of these"], correctAnswer: 0, points: 100, timeLimit: 20 },
    { text: "DEMO Q3 — 12 × 12 = ?", options: ["124", "144", "154", "132"], correctAnswer: 1, points: 100, timeLimit: 15 },
    { text: "DEMO Q4 — The sun is a…", options: ["Planet", "Comet", "Star", "Moon"], correctAnswer: 2, points: 100, timeLimit: 15 },
    { text: "DEMO Q5 — Which is the largest ocean?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correctAnswer: 3, points: 100, timeLimit: 15 },
  ];
  for (let i = 0; i < demoQuestions.length; i++) {
    await Question.create({ activity: quiz._id, order: i, ...demoQuestions[i] });
  }

  /* Poll — one neutral question, live distribution */
  const poll = await Activity.create({ event: event._id, type: "POLL", title: `${DEMO_TAG} Audience poll`, order: 2, state: "UPCOMING" });
  await Question.create({
    activity: poll._id,
    type: "SINGLE_CHOICE",
    text: "DEMO POLL — What should the next workshop cover?",
    options: ["Realtime systems", "Database design", "Frontend craft", "All of it"],
    correctAnswer: null,
    points: 0,
    timeLimit: 30,
    order: 0,
  });

  /* Q&A */
  await Activity.create({ event: event._id, type: "QA", title: `${DEMO_TAG} Ask us anything`, order: 3, state: "UPCOMING" });

  /* Leaderboard checkpoint */
  await Activity.create({ event: event._id, type: "LEADERBOARD", title: `${DEMO_TAG} Final standings`, order: 4, state: "UPCOMING" });

  console.log("\n🌱 Demo event seeded (dev-only fixtures, clearly labeled):");
  console.log(`   • Event:        ${event.title}`);
  console.log(`   • Activities:   Welcome → Quiz (5 Qs) → Poll → Q&A → Leaderboard`);
  console.log(`   • liveSettings: board on every question · chat on · late join on · speed bonus 50`);
  console.log("\n👤 Demo organizer (log in with email + password):");
  console.log(`   • email:    ${ORG_EMAIL}`);
  console.log(`   • password: ${ORG_PASSWORD}`);
  console.log("\n🔗 URLs (frontend):");
  console.log(`   • Organizer console:  ${FRONTEND}/events/${event.slug}/live`);
  console.log(`   • Participant join:   ${FRONTEND}/events/${event.slug}/live  (join code: ${event.joinCode})`);
  console.log(`   • Projector display:  ${FRONTEND}/events/${event.slug}/live?display=1`);
  console.log("\n▶️  Flow (§97): participants join the waiting room → organizer presses Start event");
  console.log("    → Welcome → Quiz (advance per question) → Poll → Q&A → Leaderboard → End event");
  console.log("    → results, achievements, certificates, memories.");
  console.log("\n🧹 To remove: NODE_ENV=development DEMO_MODE=1 npm run seed:demo -- --reset");

  await mongoose.disconnect();
  bye(0);
})().catch(async (e) => {
  console.error("Demo seed failed:", e.message);
  try {
    await mongoose.disconnect();
  } catch {}
  bye(1);
});
