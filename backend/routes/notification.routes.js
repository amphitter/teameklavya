const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth.middleware");
const notificationController = require("../controllers/notification.controller");

router.get("/", requireAuth, notificationController.getNotifications);
router.get("/unread-count", requireAuth, notificationController.getUnreadCount);
router.get("/preferences", requireAuth, notificationController.getPreferences);
router.put("/preferences", requireAuth, notificationController.updatePreferences);
router.post("/read-all", requireAuth, notificationController.markAllRead);
router.post("/clear-read", requireAuth, notificationController.clearRead);
router.post("/:id/read", requireAuth, notificationController.markRead);
router.delete("/:id", requireAuth, notificationController.deleteNotification);

module.exports = router;
