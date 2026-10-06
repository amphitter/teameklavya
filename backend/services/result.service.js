const mongoose = require("mongoose");

/**
 * Result Service (Part 4, Phase 8 — spec §58–59, §64–66, §72–73).
 * Builds and reads the immutable EventResult snapshot: the single source
 * of truth for final leaderboards, certificates, analytics and memories.
 *
 * §72 logging discipline: business events are persisted where they happen —
 * answers → LiveAnswer, activity completions → Activity.state/endedAt,
 * event completion → ParticipantSession.completedAt + this snapshot.
 * Socket noise is NEVER persisted.
 */
const Event = require("../models/event.model");
const Activity = require("../models/activity.model");
const Question = require("../models/question.model");
const LiveAnswer = require("../models/liveAnswer.model");
const ParticipantSession = require("../models/participantSession.model");
const EventResult = require("../models/eventResult.model");
const { onEventCompleted } = require("./completion.service");

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Build the final snapshot. IDEMPOTENT + IMMUTABLE (§73): the first
 * completion writes it; later calls never overwrite (E11000 on the unique
 * event index is swallowed). Returns the stored document.
 */
async function buildEventResult(eventId, finalizedBy) {
  eventId = String(eventId);
  const existing = await EventResult.findOne({ event: eventId }).lean();
  if (existing) return existing; // finalized results are never rewritten

  const [sessions, activities] = await Promise.all([
    ParticipantSession.find({ event: eventId })
      .populate("user", "firstName lastName username profile")
      .lean(),
    Activity.find({ event: eventId }).sort({ order: 1 }).lean(),
  ]);

  /* ── Per-session answer stats (one aggregation) ── */
  const sessionRows = await LiveAnswer.aggregate([
    { $match: { event: toObjectId(eventId) } },
    {
      $group: {
        _id: "$session",
        answered: { $sum: 1 },
        correct: { $sum: { $cond: [{ $eq: ["$correct", true] }, 1, 0] } },
      },
    },
  ]);
  const statsBySession = new Map(sessionRows.map((r) => [String(r._id), r]));

  /* ── Leaderboard: score desc, joinedAt asc (same rule as the live engine) ── */
  const ranked = [...sessions].sort(
    (a, b) => (b.score || 0) - (a.score || 0) || new Date(a.joinedAt) - new Date(b.joinedAt)
  );
  const leaderboard = ranked.map((sess, i) => {
    const st = statsBySession.get(String(sess._id)) || { answered: 0, correct: 0 };
    return {
      rank: i + 1,
      participantId: sess.user?._id,
      displayName:
        `${sess.user?.firstName || ""} ${sess.user?.lastName || ""}`.trim() || "Participant",
      username: sess.user?.username,
      avatar: sess.user?.profile?.avatar || "",
      team: sess.teamName || "",
      score: sess.score || 0,
      answered: st.answered || 0,
      correctAnswers: st.correct || 0,
      accuracy: st.answered ? Math.round(((st.correct || 0) / st.answered) * 100) : 0,
    };
  });

  /* ── Question analytics (§65): distribution, correct %, avg response ── */
  const questionRows = await LiveAnswer.aggregate([
    { $match: { event: toObjectId(eventId) } },
    {
      $group: {
        _id: "$question",
        total: { $sum: 1 },
        correct: { $sum: { $cond: [{ $eq: ["$correct", true] }, 1, 0] } },
        avgResponseMs: { $avg: "$responseTime" },
        answers: { $push: "$answer" },
      },
    },
  ]);
  const byQuestion = new Map(questionRows.map((r) => [String(r._id), r]));

  const quizActivities = activities.filter((a) => a.type === "QUIZ" || a.type === "POLL");
  const allQuestions = quizActivities.length
    ? await Question.find({ activity: { $in: quizActivities.map((a) => a._id) } })
        .sort({ order: 1 })
        .select("+correctAnswer")
        .lean()
    : [];
  const questionsByActivity = new Map();
  const questionAnalytics = [];
  for (const q of allQuestions) {
    const row = byQuestion.get(String(q._id));
    const isSubjective = q.type === "SHORT_ANSWER" || q.type === "LONG_ANSWER";
    const optionCount = Math.max(0, (q.options || []).length);
    const distribution = new Array(optionCount).fill(0);
    if (row) {
      // MULTI_SELECT answers are arrays — count every selected option
      for (const a of row.answers) {
        const picks = Array.isArray(a) ? a : [a];
        for (const p of picks) {
          if (Number.isInteger(p) && p >= 0 && p < optionCount) distribution[p] += 1;
        }
      }
    }
    const entry = {
      questionId: q._id,
      activityId: q.activity,
      type: q.type,
      text: q.text,
      points: q.points || 0,
      totalAnswers: row ? row.total : 0,
      correctCount: row ? row.correct : 0,
      correctPct: row && row.total && !isSubjective ? Math.round((row.correct / row.total) * 100) : null,
      avgResponseMs: row && row.avgResponseMs != null ? Math.round(row.avgResponseMs) : null,
      distribution: isSubjective ? null : distribution, // subjective: no option distribution
    };
    questionAnalytics.push(entry);
    const list = questionsByActivity.get(String(q.activity)) || [];
    list.push(entry);
    questionsByActivity.set(String(q.activity), list);
  }

  /* ── Per-activity analytics (§65): participants, completion, avg score ── */
  const activityRows = await LiveAnswer.aggregate([
    { $match: { event: toObjectId(eventId) } },
    {
      $group: {
        _id: { activity: "$activity", session: "$session" },
        answers: { $sum: 1 },
        points: { $sum: "$points" },
      },
    },
  ]);
  const perActivity = new Map(); // activityId → [{session, answers, points}]
  for (const r of activityRows) {
    const key = String(r._id.activity);
    const list = perActivity.get(key) || [];
    list.push({ session: String(r._id.session), answers: r.answers, points: r.points });
    perActivity.set(key, list);
  }

  const activitiesSummary = activities.map((a) => {
    const parts = perActivity.get(String(a._id)) || [];
    const qCount = (questionsByActivity.get(String(a._id)) || []).length;
    const totalAnswers = parts.reduce((s, p) => s + p.answers, 0);
    const totalPoints = parts.reduce((s, p) => s + p.points, 0);
    return {
      activityId: a._id,
      type: a.type,
      title: a.title,
      state: a.state,
      questions: qCount,
      participants: parts.length,
      answers: totalAnswers,
      completion: qCount && parts.length ? Math.min(100, Math.round((totalAnswers / (qCount * parts.length)) * 100)) : 0,
      averageScore: parts.length ? Math.round((totalPoints / parts.length) * 10) / 10 : 0,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
    };
  });

  /* ── Event summary (§59, §66) ── */
  const totalAnswers = sessionRows.reduce((s, r) => s + r.answered, 0);
  const totalCorrect = sessionRows.reduce((s, r) => s + r.correct, 0);
  const activeSessions = sessionRows.length;
  const scores = leaderboard.map((e) => e.score);
  const summary = {
    totalParticipants: sessions.length,
    activeParticipants: activeSessions,
    engagementRate: sessions.length ? Math.round((activeSessions / sessions.length) * 100) : 0,
    totalAnswers,
    totalCorrect,
    correctRate: totalAnswers ? Math.round((totalCorrect / totalAnswers) * 100) : 0,
    averageScore: scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : 0,
    topScore: scores.length ? Math.max(...scores) : 0,
    totalQuestions: allQuestions.length,
    totalActivities: activities.length,
  };

  const doc = {
    event: eventId,
    leaderboard,
    activities: activitiesSummary,
    summary,
    ...(questionAnalytics.length ? { questions: questionAnalytics } : {}),
    finalizedAt: new Date(),
    finalizedBy: finalizedBy || null,
  };

  let stored;
  try {
    stored = await EventResult.create(doc);
  } catch (err) {
    if (String(err.code) === "11000") {
      // Raced with another finalize — the first snapshot stands (immutable)
      stored = await EventResult.findOne({ event: eventId }).lean();
    } else {
      throw err;
    }
  }

  // §60–62 completion hook: achievements + certificate requests, derived
  // from this snapshot. Idempotent; failures never break the snapshot.
  try {
    await onEventCompleted(eventId, stored);
  } catch (hookErr) {
    console.error("Completion hook failed:", hookErr.message);
  }
  return stored;
}

/** Read the snapshot; lazily build for events completed before this phase.
 *  Also self-heals the completion hook (achievements/certificates) for
 *  snapshots created before Phase 9 — one cheap existence check. */
async function getOrBuildResults(eventId, finalizedBy) {
  const existing = await EventResult.findOne({ event: eventId }).lean();
  if (existing) {
    const Certificate = require("../models/certificate.model");
    if (!(await Certificate.exists({ event: eventId }))) {
      try {
        await onEventCompleted(eventId, existing);
      } catch (hookErr) {
        console.error("Completion hook (lazy) failed:", hookErr.message);
      }
    }
    return existing;
  }
  return buildEventResult(eventId, finalizedBy);
}

module.exports = { buildEventResult, getOrBuildResults };
