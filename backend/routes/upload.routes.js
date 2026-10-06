/**
 * EventHub Upload Routes — Cloudinary-backed (replaces the old image host)
 * ──────────────────────────────────────────────────────────
 *  POST /api/upload/event/:eventId   (admin)  event poster/banner
 *  POST /api/upload/image            (auth)   general image upload
 *                                              ?folder=posters|avatars|organizers|registration-files
 */
const express = require("express");
const multer = require("multer");

const router = express.Router();

const Event = require("../models/event.model");
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");
const media = require("../services/media.service");

// Memory storage — files go straight to Cloudinary, never linger on disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: media.MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    // NOTE: multer's fileFilter runs BEFORE the bytes are read — `file` has no
    // `size` here (only fieldname/originalname/encoding/mimetype). So we check
    // the mimetype only; the size cap is enforced by limits.fileSize above and
    // re-checked on the buffer inside media.uploadImage.
    const error = media.validateImageMimetype(file.mimetype);
    cb(error ? new Error(error) : null, !error);
  },
});

const FOLDER_WHITELIST = new Set([
  "posters",
  "avatars",
  "organizers",
  "registration-files",
  "posts",
  "questions", // Live engine question media (Part 4)
]);

// Upload an event poster/banner and attach it to the event
router.post("/event/:eventId", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const result = await media.uploadImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      folder: `events/${eventId}`,
    });

    // Store URL + Cloudinary public id (so we can delete/replace later)
    event.bannerUrl = result.url;
    if (event.bannerPublicId && event.bannerPublicId !== result.publicId) {
      await media.deleteImage(event.bannerPublicId);
    }
    event.bannerPublicId = result.publicId;
    await event.save();

    res.status(200).json({
      success: true,
      eventId,
      url: result.url,
      publicId: result.publicId,
      provider: result.provider,
    });
  } catch (error) {
    console.error("Event poster upload error:", error.message);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// General authenticated image upload (poster drafts, avatars, organizer logos)
router.post("/image", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const folder = FOLDER_WHITELIST.has(req.query.folder) ? String(req.query.folder) : "misc";

    const result = await media.uploadImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      folder,
    });

    res.status(200).json({ success: true, url: result.url, publicId: result.publicId, provider: result.provider });
  } catch (error) {
    console.error("Image upload error:", error.message);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// Multer-specific error handling (bad type / too large)
router.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image must be 5 MB or smaller"
        : "Upload failed: " + error.message;
    return res.status(400).json({ success: false, message });
  }
  if (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: "Upload failed" });
});

module.exports = router;
