const express = require("express");
const router = express.Router();
const registrationController = require("../controllers/registration.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");
const RegistrationResponse = require("../models/registrationResponse.model");

// Public: get form to show on website
router.get("/form/:eventId", registrationController.getForm);

// User routes
router.post("/responses", requireAuth, registrationController.submitResponse);
router.get("/responses/status/:eventId", requireAuth, registrationController.getRegistrationStatus);

// Admin routes
router.get("/responses/:eventId", requireAuth, requireAdmin, registrationController.getEventResponses);
router.get("/responses/:eventId/export", requireAuth, requireAdmin, registrationController.exportRegistrations);
router.get("/responses/:eventId/count", requireAuth, registrationController.getRegistrationCount);
router.post("/responses/counts/batch", requireAuth, registrationController.getRegistrationCounts);
router.get("/responses/:id/stats", requireAuth, requireAdmin, registrationController.getRegistrationStats);

// User events route
router.get("/user/events", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log("🔍 Fetching user events via registration route for user:", userId);
    
    const responses = await RegistrationResponse.find({ userId })
      .populate("eventId")
      .sort({ createdAt: -1 });

    const events = responses.map(response => response.eventId);

    res.json({ success: true, events });
  } catch (error) {
    console.error("Get user events error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;