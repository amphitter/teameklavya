/**
 * Activity Controller (Part 4, Phase 1) — Activity Builder + Question CRUD.
 * ─────────────────────────────────────────────────────────────────────────
 * Every route is organizer-authorized server-side via canManageEvent
 * (owner or admin). Participants never touch these endpoints; they receive
 * sanitized live state through the realtime engine (Phase 2+).
 *
 *  GET    /api/events/:eventId/activities          list (organizer)
 *  POST   /api/events/:eventId/activities          create
 *  PUT    /api/events/:eventId/activities/order    reorder {activityIds}
 *  PUT    /api/activities/:id                      update title/description/config
 *  DELETE /api/activities/:id                      delete (+its questions)
 *  POST   /api/activities/:id/validate             validation report
 *  POST   /api/activities/:id/generate-quiz        AI boundary (501 until provider)
 *  GET    /api/activities/:id/questions            full incl. correctAnswer (organizer)
 *  POST   /api/activities/:id/questions            create (validated)
 *  PUT    /api/activities/:id/questions/order      reorder {questionIds}
 *  POST   /api/questions/:id/duplicate             duplicate question
 *  PUT    /api/questions/:id                       update (validated)
 *  DELETE /api/questions/:id                       delete
 */
const Activity = require("../models/activity.model");
const Question = require("../models/question.model");
const Event = require("../models/event.model");
const { canManageEvent } = require("../middleware/auth.middleware");
const { normalizeQuestion, validateActivity } = require("../services/quizValidation.service");
const quizGenerator = require("../services/quizGenerator.service");

async function loadEventOr404(req, res) {
  const event = await Event.findById(req.params.eventId);
  if (!event) {
    res.status(404).json({ success: false, message: "Event not found" });
    return null;
  }
  if (!(await canManageEvent(req.user, event))) {
    res.status(403).json({ success: false, message: "You can't manage this event" });
    return null;
  }
  return event;
}

async function loadActivityOr404(req, res) {
  const activity = await Activity.findById(req.params.id);
  if (!activity) {
    res.status(404).json({ success: false, message: "Activity not found" });
    return null;
  }
  const event = await Event.findById(activity.event);
  if (!event || !(await canManageEvent(req.user, event))) {
    res.status(403).json({ success: false, message: "You can't manage this event" });
    return null;
  }
  return activity;
}

// GET /api/events/:eventId/activities — with question counts
exports.getActivities = async (req, res) => {
  try {
    const event = await loadEventOr404(req, res);
    if (!event) return;
    const activities = await Activity.find({ event: event._id }).sort({ order: 1, createdAt: 1 }).lean();
    const counts = await Question.aggregate([
      { $match: { activity: { $in: activities.map((a) => a._id) } } },
      { $group: { _id: "$activity", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    res.json({
      success: true,
      activities: activities.map((a) => ({ ...a, questionCount: countMap.get(String(a._id)) || 0 })),
    });
  } catch (error) {
    console.error("Get activities error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load activities" });
  }
};

// POST /api/events/:eventId/activities { type, title, description?, config? }
exports.createActivity = async (req, res) => {
  try {
    const event = await loadEventOr404(req, res);
    if (!event) return;
    const { type, title, description, config } = req.body;
    if (!["WELCOME", "QUIZ", "POLL", "QA", "LEADERBOARD", "CUSTOM"].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid activity type" });
    }
    const last = await Activity.findOne({ event: event._id }).sort({ order: -1 }).select("order").lean();
    const activity = await Activity.create({
      event: event._id,
      type,
      title: String(title || "").trim().slice(0, 120) || `${type.toLowerCase()} activity`,
      description: String(description || "").slice(0, 500),
      order: (last?.order ?? -1) + 1,
      config: config && typeof config === "object" ? config : {},
      createdBy: req.user.id,
    });

    // A POLL is exactly one choice question — create the starter question
    if (type === "POLL") {
      await Question.create({
        activity: activity._id,
        type: "SINGLE_CHOICE",
        text: "Poll question…",
        options: ["Option A", "Option B"],
        correctAnswer: 0,
        points: 0,
        timeLimit: 60,
        order: 0,
      });
    }
    res.status(201).json({ success: true, activity });
  } catch (error) {
    console.error("Create activity error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create activity" });
  }
};

// PUT /api/events/:eventId/activities/order { activityIds: [] }
exports.reorderActivities = async (req, res) => {
  try {
    const event = await loadEventOr404(req, res);
    if (!event) return;
    const ids = Array.isArray(req.body.activityIds) ? req.body.activityIds : [];
    const existing = await Activity.find({ event: event._id }).select("_id").lean();
    if (ids.length !== existing.length || !existing.every((a) => ids.includes(String(a._id)))) {
      return res.status(400).json({ success: false, message: "activityIds must be a complete reorder of this event's activities" });
    }
    await Promise.all(ids.map((id, index) => Activity.updateOne({ _id: id, event: event._id }, { $set: { order: index } })));
    res.json({ success: true });
  } catch (error) {
    console.error("Reorder activities error:", error.message);
    res.status(500).json({ success: false, message: "Failed to reorder" });
  }
};

// PUT /api/activities/:id { title?, description?, config? }
exports.updateActivity = async (req, res) => {
  try {
    const activity = await loadActivityOr404(req, res);
    if (!activity) return;
    const { title, description, config } = req.body;
    if (title !== undefined) activity.title = String(title).trim().slice(0, 120);
    if (description !== undefined) activity.description = String(description).slice(0, 500);
    if (config !== undefined && config !== null && typeof config === "object") activity.config = config;
    await activity.save();
    res.json({ success: true, activity });
  } catch (error) {
    console.error("Update activity error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update activity" });
  }
};

// DELETE /api/activities/:id — removes its questions too
exports.deleteActivity = async (req, res) => {
  try {
    const activity = await loadActivityOr404(req, res);
    if (!activity) return;
    await Question.deleteMany({ activity: activity._id });
    await Activity.deleteOne({ _id: activity._id });
    res.json({ success: true });
  } catch (error) {
    console.error("Delete activity error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete activity" });
  }
};

// POST /api/activities/:id/validate — full validation report (spec §26)
exports.validateActivityEndpoint = async (req, res) => {
  try {
    const activity = await loadActivityOr404(req, res);
    if (!activity) return;
    const questions = await Question.find({ activity: activity._id }).sort({ order: 1 }).select("+correctAnswer").lean();
    const result = validateActivity(activity, questions);
    res.json({ success: true, ...result, questionCount: questions.length });
  } catch (error) {
    console.error("Validate activity error:", error.message);
    res.status(500).json({ success: false, message: "Failed to validate" });
  }
};

// POST /api/activities/:id/generate-quiz — AI boundary (spec §25)
exports.generateQuiz = async (req, res) => {
  try {
    const activity = await loadActivityOr404(req, res);
    if (!activity) return;
    if (activity.type !== "QUIZ") {
      return res.status(400).json({ success: false, message: "AI generation applies to QUIZ activities only" });
    }
    await quizGenerator.generateQuiz(req.body); // throws NOT_IMPLEMENTED until a provider is registered
    res.json({ success: true });
  } catch (error) {
    if (error.code === "NOT_IMPLEMENTED") {
      return res.status(501).json({ success: false, message: error.message, code: error.code });
    }
    if (error.code === "INVALID_INPUT") {
      return res.status(400).json({ success: false, message: error.message, code: error.code });
    }
    console.error("Generate quiz error:", error.message);
    res.status(500).json({ success: false, message: "Generation failed" });
  }
};

// GET /api/activities/:id/questions — organizer view INCLUDING answer key
exports.getQuestions = async (req, res) => {
  try {
    const activity = await loadActivityOr404(req, res);
    if (!activity) return;
    const questions = await Question.find({ activity: activity._id })
      .sort({ order: 1, createdAt: 1 })
      .select("+correctAnswer") // organizer only — the ONLY place the key is exposed
      .lean();
    res.json({ success: true, questions });
  } catch (error) {
    console.error("Get questions error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load questions" });
  }
};

// POST /api/activities/:id/questions — validated create (spec §26)
exports.createQuestion = async (req, res) => {
  try {
    const activity = await loadActivityOr404(req, res);
    if (!activity) return;
    let payload;
    try {
      payload = normalizeQuestion({ ...req.body });
    } catch (vErr) {
      return res.status(400).json({ success: false, message: vErr.message, errors: vErr.validationErrors });
    }
    // Poll activities hold exactly one question
    if (activity.type === "POLL") {
      const existing = await Question.countDocuments({ activity: activity._id });
      if (existing > 0) {
        return res.status(400).json({ success: false, message: "A poll has exactly one question" });
      }
    }
    const last = await Question.findOne({ activity: activity._id }).sort({ order: -1 }).select("order").lean();
    const question = await Question.create({
      ...payload,
      activity: activity._id,
      order: (last?.order ?? -1) + 1,
    });
    const saved = await Question.findById(question._id).select("+correctAnswer").lean();
    res.status(201).json({ success: true, question: saved });
  } catch (error) {
    console.error("Create question error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create question" });
  }
};

// PUT /api/activities/:id/questions/order { questionIds: [] }
exports.reorderQuestions = async (req, res) => {
  try {
    const activity = await loadActivityOr404(req, res);
    if (!activity) return;
    const ids = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
    const existing = await Question.find({ activity: activity._id }).select("_id").lean();
    if (ids.length !== existing.length || !existing.every((q) => ids.includes(String(q._id)))) {
      return res.status(400).json({ success: false, message: "questionIds must be a complete reorder" });
    }
    await Promise.all(ids.map((id, index) => Question.updateOne({ _id: id, activity: activity._id }, { $set: { order: index } })));
    res.json({ success: true });
  } catch (error) {
    console.error("Reorder questions error:", error.message);
    res.status(500).json({ success: false, message: "Failed to reorder" });
  }
};

async function loadQuestionWithActivity(req, res) {
  const question = await Question.findById(req.params.id).select("+correctAnswer");
  if (!question) {
    res.status(404).json({ success: false, message: "Question not found" });
    return null;
  }
  const activity = await Activity.findById(question.activity);
  if (!activity) {
    res.status(404).json({ success: false, message: "Activity not found" });
    return null;
  }
  const event = await Event.findById(activity.event);
  if (!event || !(await canManageEvent(req.user, event))) {
    res.status(403).json({ success: false, message: "You can't manage this event" });
    return null;
  }
  return { question, activity };
}

// PUT /api/questions/:id — validated update
exports.updateQuestion = async (req, res) => {
  try {
    const loaded = await loadQuestionWithActivity(req, res);
    if (!loaded) return;
    const { question } = loaded;
    const merged = {
      type: req.body.type ?? question.type,
      text: req.body.text ?? question.text,
      media: req.body.media ?? question.media,
      options: req.body.options ?? question.options,
      correctAnswer: req.body.correctAnswer ?? question.correctAnswer,
      points: req.body.points ?? question.points,
      timeLimit: req.body.timeLimit ?? question.timeLimit,
      explanation: req.body.explanation ?? question.explanation,
    };
    let payload;
    try {
      payload = normalizeQuestion(merged);
    } catch (vErr) {
      return res.status(400).json({ success: false, message: vErr.message, errors: vErr.validationErrors });
    }
    Object.assign(question, payload);
    await question.save();
    res.json({ success: true, question: (await Question.findById(question._id).select("+correctAnswer").lean()) });
  } catch (error) {
    console.error("Update question error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update question" });
  }
};

// POST /api/questions/:id/duplicate — copy to end of same activity
exports.duplicateQuestion = async (req, res) => {
  try {
    const loaded = await loadQuestionWithActivity(req, res);
    if (!loaded) return;
    const { question, activity } = loaded;
    const last = await Question.findOne({ activity: activity._id }).sort({ order: -1 }).select("order").lean();
    const copy = await Question.create({
      activity: activity._id,
      type: question.type,
      text: question.text,
      media: question.media,
      options: question.options,
      correctAnswer: question.correctAnswer,
      points: question.points,
      timeLimit: question.timeLimit,
      explanation: question.explanation,
      metadata: question.metadata,
      order: (last?.order ?? -1) + 1,
    });
    res.status(201).json({ success: true, question: (await Question.findById(copy._id).select("+correctAnswer").lean()) });
  } catch (error) {
    console.error("Duplicate question error:", error.message);
    res.status(500).json({ success: false, message: "Failed to duplicate question" });
  }
};

// DELETE /api/questions/:id
exports.deleteQuestion = async (req, res) => {
  try {
    const loaded = await loadQuestionWithActivity(req, res);
    if (!loaded) return;
    await Question.deleteOne({ _id: loaded.question._id });
    res.json({ success: true });
  } catch (error) {
    console.error("Delete question error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete question" });
  }
};
