/**
 * EventHub Quiz Routes — live event quizzes & leaderboard
 * ────────────────────────────────────────────────────────
 *  POST   /api/quizzes                     create (event organizer)
 *  PUT    /api/quizzes/:id                 edit draft (organizer)
 *  POST   /api/quizzes/:id/publish         draft → live (organizer)
 *  POST   /api/quizzes/:id/end             live → ended (organizer)
 *  DELETE /api/quizzes/:id                 delete draft/ended (organizer)
 *  GET    /api/quizzes/event/:eventId      quizzes for an event (auth)
 *  GET    /api/quizzes/:id                 quiz details (role-aware)
 *  POST   /api/quizzes/:id/answer          submit an answer (auth, while live)
 *  GET    /api/quizzes/:id/leaderboard     rankings (optional auth)
 */
const express = require("express");
const { idempotencyWindow } = require("../middleware/idempotency");
const router = express.Router();
const { requireAuth, optionalUser } = require("../middleware/auth.middleware");
const quizController = require("../controllers/quiz.controller");

router.post("/", requireAuth, quizController.createQuiz);
router.put("/:id", requireAuth, quizController.updateQuiz);
router.post("/:id/publish", requireAuth, quizController.publishQuiz);
router.post("/:id/end", requireAuth, quizController.endQuiz);
router.delete("/:id", requireAuth, quizController.deleteQuiz);
router.get("/event/:eventId", optionalUser, quizController.getEventQuizzes);
router.get("/:id/leaderboard", optionalUser, quizController.getLeaderboard);
router.post("/:id/answer", requireAuth, idempotencyWindow, quizController.submitAnswer);
router.get("/:id", optionalUser, quizController.getQuizById);

module.exports = router;
