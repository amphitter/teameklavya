/**
 * EventHub Upload Routes — provider-agnostic (Part 5, Phase 4)
 * ──────────────────────────────────────────────────────────
 *  POST /api/upload/event/:eventId   (admin)  event poster/banner
 *  POST /api/upload/image            (auth)   general image upload
 *                                              ?folder=posters|avatars|organizers|posts…
 *
 * Phase 4 changes:
 *   §20  per-folder size ceilings (an avatar upload can't cost what a banner
 *        costs) and magic-byte validation so a spoofed MIME type is rejected.
 *   §23  upload-session limits — mounted globally in server.js
 *        (UPLOAD_BURST 15/10min + UPLOAD_HOURLY 10/hour), stricter than the
 *        generic API bucket, so a malicious client can't open thousands of
 *        upload sessions.
 *   §55  orphan lifecycle: every upload is tracked. If the database write
 *        that consumes it fails, the asset is marked `cleanup_pending` and
 *        reclaimed by scripts/media-sweeper.js — never leaked, never deleted
 *        instantly (a transient DB error must not destroy a user's upload).
 *   §68  a storage failure returns a clean StorageUploadError and never
 *        takes down the request pipeline.
 */
const express = require("express");
const multer = require("multer");

const router = express.Router();

const Event = require("../models/event.model");
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");
const media = require("../services/media.service");

// Memory storage — files stream straight to the provider, never linger on disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: media.MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    // NOTE: multer's fileFilter runs BEFORE the bytes are read — `file` has no
    // `size` here. We check the declared mimetype only; size and the REAL
    // content type are validated on the buffer inside media.uploadImage.
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
  "stories",   // Part 8 — 9:16 portrait story media
]);

/** Map an upload folder onto the responsive-variant preset used to serve it. */
const PURPOSE_BY_FOLDER = {
  avatars: "avatar",
  organizers: "logo",
  posters: "poster",
  posts: "post",
  questions: "post",
  stories: "post",
};

// Upload an event poster/banner and attach it to the event
router.post("/event/:eventId", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  let uploaded = null;
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    uploaded = await media.uploadImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      folder: `events/${eventId}`,
      uploadedBy: req.user.id,
      purpose: "poster",
    });

    // Store URL + provider public id (so we can delete/replace later)
    const previousPublicId = event.bannerPublicId;
    event.bannerUrl = uploaded.url;
    event.bannerPublicId = uploaded.publicId;
    await event.save();

    // The new banner is referenced by the event → it is now permanent content.
    await media.markAttached(uploaded.publicId, `event:${eventId}`);

    // Replace (not orphan) the asset this upload displaced.
    if (previousPublicId && previousPublicId !== uploaded.publicId) {
      await media.deleteImage(previousPublicId);
    }

    res.status(200).json({
      success: true,
      eventId,
      url: uploaded.url,
      variants: media.imageVariants(uploaded.url, "poster"),
      publicId: uploaded.publicId,
      provider: uploaded.provider,
    });
  } catch (error) {
    // §55 — the upload succeeded but the DB write (or validation) failed.
    // Mark for safe reclamation instead of leaking the asset.
    if (uploaded?.publicId) {
      await media.markCleanupPending(uploaded.publicId, "event_attach_failed");
    }
    console.error("Event poster upload error:", error.message);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// General authenticated image upload (poster drafts, avatars, organizer logos)
router.post("/image", requireAuth, upload.single("file"), async (req, res) => {
  let uploaded = null;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const folder = FOLDER_WHITELIST.has(req.query.folder) ? String(req.query.folder) : "misc";

    uploaded = await media.uploadImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      folder,
      uploadedBy: req.user.id,
      purpose: PURPOSE_BY_FOLDER[folder] || "default",
    });

    // Unlike the event route, nothing consumes this asset yet — the client is
    // expected to reference the URL in a follow-up write (create post, update
    // profile). It stays `pending` until then, and the sweeper reclaims it if
    // that write never happens (e.g. the user abandons the compose screen).
    res.status(200).json({
      success: true,
      url: uploaded.url,
      variants: media.imageVariants(uploaded.url, PURPOSE_BY_FOLDER[folder] || "default"),
      publicId: uploaded.publicId,
      provider: uploaded.provider,
    });
  } catch (error) {
    if (uploaded?.publicId) {
      await media.markCleanupPending(uploaded.publicId, "upload_failed");
    }
    console.error("Image upload error:", error.message);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

/**
 * Confirm an asset is in use (§55).
 * The client calls this after it has persisted a URL — e.g. post created.
 * Without it the asset would look abandoned and be reclaimed after 24h.
 */
router.post("/attach", requireAuth, express.json({ limit: "64kb" }), async (req, res) => {
  try {
    const { publicId, attachedTo } = req.body || {};
    if (!publicId || typeof publicId !== "string") {
      return res.status(400).json({ success: false, message: "publicId is required" });
    }
    await media.markAttached(publicId, attachedTo || null);
    res.json({ success: true });
  } catch (error) {
    console.error("Attach asset error:", error.message);
    res.status(500).json({ success: false, message: "Could not confirm upload" });
  }
});

// Multer-specific error handling (bad type / too large)
router.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image must be 8 MB or smaller"
        : "Upload failed: " + error.message;
    return res.status(400).json({ success: false, message });
  }
  if (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: "Upload failed" });
});

module.exports = router;
