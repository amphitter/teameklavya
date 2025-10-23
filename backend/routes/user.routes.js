// routes/user.routes.js
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth.middleware");
const registrationController = require("../controllers/registration.controller");

// Get user's registered events
router.get("/events", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log("🔍 Fetching events for user:", userId);
    
    const responses = await RegistrationResponse.find({ userId })
      .populate("eventId")
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${responses.length} registrations`);
    
    const events = responses.map(response => response.eventId);

    res.json({ success: true, events });
  } catch (error) {
    console.error("❌ Get user events error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;