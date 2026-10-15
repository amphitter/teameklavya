const Quiz = require("../models/quiz.model");
const QuizParticipation = require("../models/quizParticipation.model");
const Event = require("../models/event.model");
const { canManageEvent } = require("../middleware/auth.middleware");
const { canAccessPrivateEvent } = require("../services/event-permissions.service");

const USER_FIELDS = "firstName lastName username profile";
const EVENT_FIELDS = "title slug visibility createdBy organizerType organizerId";

/* ── helpers ─────────────────────────────────────────────── */

function sanitizeQuiz(quiz, isManager) {
  const o = quiz.toObject ? quiz.toObject() : { ...quiz };
  const safe = { ...o };
  if (safe.event && typeof safe.event === "object") {
    safe.event = { ...safe.event };
    delete safe.event.organizerType;
    delete safe.event.organizerId;
  }
  return {
    ...safe,
    questionCount: o.questions?.length || 0,
    // participants never see the answer key
    questions: isManager
      ? o.questions
      : (o.questions || []).map((q) => ({ text: q.text, options: q.options, points: q.points })),
  };
}

async function leaderboardFor(quizId, viewerId) {
  const parts = await QuizParticipation.find({ quiz: quizId })
    .populate("user", USER_FIELDS)
    .lean();
  parts.sort((a, b) => b.score - a.score || new Date(a.lastAnswerAt || a.createdAt) - new Date(b.lastAnswerAt || b.createdAt));
  const entries = parts.slice(0, 50).map((p, i) => ({
    rank: i + 1,
    user: p.user,
    score: p.score,
    correct: p.answers.filter((a) => a.correct).length,
    answered: p.answers.length,
  }));
  const myIndex = viewerId ? parts.findIndex((p) => String(p.user?._id) === String(viewerId)) : -1;
  const me =
    myIndex >= 0
      ? {
          rank: myIndex + 1,
          score: parts[myIndex].score,
          correct: parts[myIndex].answers.filter((a) => a.correct).length,
          answered: parts[myIndex].answers.length,
        }
      : null;
  return { entries, me, total: parts.length };
}

/* ── organizer: create / update / publish / end / delete ── */

// POST /api/quizzes  { eventId, title, description, questions }
exports.createQuiz = async (req, res) => {
  try {
    const { eventId, title, description = "", questions } = req.body;
    if (!eventId || !title?.trim()) return res.status(400).json({ success: false, message: "Event and title are required" });
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: "Add at least one question" });
    }
    for (const [i, q] of questions.entries()) {
      if (!q.text?.trim()) return res.status(400).json({ success: false, message: `Question ${i + 1} is empty` });
      if (!Array.isArray(q.options) || q.options.filter((o) => String(o).trim()).length < 2) {
        return res.status(400).json({ success: false, message: `Question ${i + 1} needs at least 2 options` });
      }
      if (typeof q.correctIndex !== "number" || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        return res.status(400).json({ success: false, message: `Pick the correct answer for question ${i + 1}` });
      }
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "Only the event organizer can create quizzes" });
    }

    const quiz = await Quiz.create({
      event: event._id,
      createdBy: req.user.id,
      title: title.trim(),
      description: String(description || "").trim(),
      questions: questions.map((q) => ({
        text: String(q.text).trim(),
        options: q.options.map((o) => String(o).trim()).filter(Boolean),
        correctIndex: q.correctIndex,
        points: Number(q.points) || 10,
      })),
    });

    res.status(201).json({ success: true, quiz: sanitizeQuiz(quiz, true) });
  } catch (error) {
    console.error("Create quiz error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create quiz" });
  }
};

// PUT /api/quizzes/:id  (draft only)
exports.updateQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate("event", EVENT_FIELDS);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
    if (!(await canManageEvent(req.user, quiz.event))) {
      return res.status(403).json({ success: false, message: "Only the event organizer can edit quizzes" });
    }
    if (quiz.status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft quizzes can be edited" });
    }

    const { title, description, questions } = req.body;
    if (title !== undefined) quiz.title = String(title).trim();
    if (description !== undefined) quiz.description = String(description).trim();
    if (questions !== undefined) {
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ success: false, message: "Add at least one question" });
      }
      for (const [i, q] of questions.entries()) {
        if (!q.text?.trim() || !Array.isArray(q.options) || q.options.filter((o) => String(o).trim()).length < 2) {
          return res.status(400).json({ success: false, message: `Question ${i + 1} is incomplete` });
        }
        if (typeof q.correctIndex !== "number" || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
          return res.status(400).json({ success: false, message: `Pick the correct answer for question ${i + 1}` });
        }
      }
      quiz.questions = questions.map((q) => ({
        text: String(q.text).trim(),
        options: q.options.map((o) => String(o).trim()).filter(Boolean),
        correctIndex: q.correctIndex,
        points: Number(q.points) || 10,
      }));
    }

    await quiz.save();
    res.json({ success: true, quiz: sanitizeQuiz(quiz, true) });
  } catch (error) {
    console.error("Update quiz error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update quiz" });
  }
};

// POST /api/quizzes/:id/publish  (draft → live)
exports.publishQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate("event", EVENT_FIELDS);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
    if (!(await canManageEvent(req.user, quiz.event))) {
      return res.status(403).json({ success: false, message: "Only the event organizer can publish quizzes" });
    }
    if (quiz.status !== "draft") return res.status(400).json({ success: false, message: "Only draft quizzes can go live" });

    quiz.status = "live";
    quiz.startedAt = new Date();
    await quiz.save();
    res.json({ success: true, quiz: sanitizeQuiz(quiz, true) });
  } catch (error) {
    console.error("Publish quiz error:", error.message);
    res.status(500).json({ success: false, message: "Failed to publish quiz" });
  }
};

// POST /api/quizzes/:id/end  (live → ended)
exports.endQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate("event", EVENT_FIELDS);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
    if (!(await canManageEvent(req.user, quiz.event))) {
      return res.status(403).json({ success: false, message: "Only the event organizer can end quizzes" });
    }
    if (quiz.status !== "live") return res.status(400).json({ success: false, message: "Quiz is not live" });

    quiz.status = "ended";
    quiz.endedAt = new Date();
    await quiz.save();
    res.json({ success: true, quiz: sanitizeQuiz(quiz, true) });
  } catch (error) {
    console.error("End quiz error:", error.message);
    res.status(500).json({ message: "Failed to end quiz" });
  }
};

// DELETE /api/quizzes/:id  (draft or ended)
exports.deleteQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate("event", EVENT_FIELDS);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
    if (!(await canManageEvent(req.user, quiz.event))) {
      return res.status(403).json({ success: false, message: "Only the event organizer can delete quizzes" });
    }
    if (quiz.status === "live") {
      return res.status(400).json({ success: false, message: "End the quiz before deleting it" });
    }
    await QuizParticipation.deleteMany({ quiz: quiz._id });
    await quiz.deleteOne();
    res.json({ success: true });
  } catch (error) {
    console.error("Delete quiz error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete quiz" });
  }
};

/* ── public / participant ───────────────────────────────── */

// GET /api/quizzes/event/:eventId
exports.getEventQuizzes = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId)
      .select("_id visibility createdBy organizerType organizerId")
      .lean();
    if (!event || !(await canAccessPrivateEvent(req.user, event))) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    const quizzes = await Quiz.find({ event: event._id }).sort({ createdAt: -1 }).lean();
    const list = await Promise.all(
      quizzes.map(async (q) => ({
        _id: q._id,
        title: q.title,
        description: q.description,
        status: q.status,
        questionCount: q.questions.length,
        participantCount: await QuizParticipation.countDocuments({ quiz: q._id }),
        startedAt: q.startedAt,
        endedAt: q.endedAt,
      }))
    );
    res.json({ success: true, quizzes: list });
  } catch (error) {
    console.error("Get event quizzes error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load quizzes" });
  }
};

// GET /api/quizzes/:id  (role-aware: managers see the answer key)
exports.getQuizById = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate("event", EVENT_FIELDS).lean();
    if (!quiz || !quiz.event || !(await canAccessPrivateEvent(req.user, quiz.event))) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    const isManager = await canManageEvent(req.user, quiz.event);
    const participation = req.user
      ? await QuizParticipation.findOne({ quiz: quiz._id, user: req.user.id }).lean()
      : null;

    res.json({
      success: true,
      quiz: sanitizeQuiz(quiz, isManager),
      isManager,
      myParticipation: participation,
    });
  } catch (error) {
    console.error("Get quiz error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load quiz" });
  }
};

// POST /api/quizzes/:id/answer  { questionIndex, optionIndex }
exports.submitAnswer = async (req, res) => {
  try {
    const { questionIndex, optionIndex } = req.body;
    const quiz = await Quiz.findById(req.params.id).populate("event", EVENT_FIELDS);
    if (!quiz || !quiz.event || !(await canAccessPrivateEvent(req.user, quiz.event))) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }
    if (quiz.status !== "live") {
      return res.status(400).json({ success: false, message: "This quiz isn't live right now" });
    }

    const q = quiz.questions[questionIndex];
    if (!q) return res.status(400).json({ success: false, message: "Invalid question" });
    if (typeof optionIndex !== "number" || optionIndex < 0 || optionIndex >= q.options.length) {
      return res.status(400).json({ success: false, message: "Invalid option" });
    }

    let participation = await QuizParticipation.findOne({ quiz: quiz._id, user: req.user.id });
    if (participation?.answers.some((a) => a.questionIndex === questionIndex)) {
      return res.status(400).json({ success: false, message: "You already answered this question" });
    }

    const correct = optionIndex === q.correctIndex;
    const points = correct ? q.points : 0;
    const at = new Date();

    if (!participation) {
      participation = await QuizParticipation.create({
        quiz: quiz._id,
        user: req.user.id,
        answers: [{ questionIndex, optionIndex, correct, points, at }],
        score: points,
        lastAnswerAt: at,
      });
    } else {
      participation.answers.push({ questionIndex, optionIndex, correct, points, at });
      participation.score += points;
      participation.lastAnswerAt = at;
      await participation.save();
    }

    res.json({
      success: true,
      correct,
      correctIndex: q.correctIndex,
      points,
      score: participation.score,
      answered: participation.answers.length,
    });
  } catch (error) {
    console.error("Submit answer error:", error.message);
    res.status(500).json({ success: false, message: "Failed to submit answer" });
  }
};

// GET /api/quizzes/:id/leaderboard
exports.getLeaderboard = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .select("status event")
      .populate("event", EVENT_FIELDS)
      .lean();
    if (!quiz || !quiz.event || !(await canAccessPrivateEvent(req.user, quiz.event))) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }
    const board = await leaderboardFor(req.params.id, req.user?.id);
    res.json({ success: true, ...board });
  } catch (error) {
    console.error("Leaderboard error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load leaderboard" });
  }
};
