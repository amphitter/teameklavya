/**
 * EventHub Activity Routes (Part 4, Phase 1) — Activity Builder + Questions.
 * Mounted at /api (paths are fully qualified to live beside event.routes).
 * Every handler authorizes the organizer server-side (canManageEvent).
 */
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth.middleware");
const activityController = require("../controllers/activity.controller");

router.get("/events/:eventId/activities", requireAuth, activityController.getActivities);
router.post("/events/:eventId/activities", requireAuth, activityController.createActivity);
router.put("/events/:eventId/activities/order", requireAuth, activityController.reorderActivities);
router.put("/activities/:id", requireAuth, activityController.updateActivity);
router.delete("/activities/:id", requireAuth, activityController.deleteActivity);
router.post("/activities/:id/validate", requireAuth, activityController.validateActivityEndpoint);
router.post("/activities/:id/generate-quiz", requireAuth, activityController.generateQuiz);
router.get("/activities/:id/questions", requireAuth, activityController.getQuestions);
router.post("/activities/:id/questions", requireAuth, activityController.createQuestion);
router.put("/activities/:id/questions/order", requireAuth, activityController.reorderQuestions);
router.post("/questions/:id/duplicate", requireAuth, activityController.duplicateQuestion);
router.put("/questions/:id", requireAuth, activityController.updateQuestion);
router.delete("/questions/:id", requireAuth, activityController.deleteQuestion);

module.exports = router;
