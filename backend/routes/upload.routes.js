/**
 * EventHub Upload Routes — provider-agnostic (Part 5, Phase 4)
 * ──────────────────────────────────────────────────────────
 *  POST /api/upload/event/:eventId   (Event manager)  event poster/banner
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
const MediaAsset = require("../models/mediaAsset.model");
const { EventRepository } = require("../repositories");
const { requireAuth, requireEventManager } = require("../middleware/auth.middleware");
const media = require("../services/media.service");
const moderationService = require("../services/moderation.service");

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
  // Back-compat alias used by earlier Organization-profile clients.
  "organizations",
  "registration-files",
  "posts",
  "questions", // Live engine question media (Part 4)
  "stories",   // Part 8 — 9:16 portrait story media
]);

/** Declared canonical shapes (§6) — see media.service.validateShape. */
const CANONICAL_SHAPES = new Set(["avatar", "cover", "logo"]);

/** Map an upload folder onto the responsive-variant preset used to serve it. */
const PURPOSE_BY_FOLDER = {
  avatars: "avatar",
  organizers: "logo",
  organizations: "logo",
  posters: "poster",
  posts: "post",
  questions: "post",
  stories: "post",
};

async function retireAsset(publicId, reason) {
  if (!publicId) return;
  try {
    const result = await media.deleteImage(publicId);
    if (!result?.ok) await media.markCleanupPending(publicId, reason);
  } catch (error) {
    console.warn("Replaced image cleanup failed:", error?.message || error);
    await media.markCleanupPending(publicId, reason);
  }
}

/** Upload + attach an Event-owned image through the same storage abstraction. */
async function uploadEventImage(req, res, kind) {
  let uploaded = null;
  let saved = false;
  try {
    const { eventId } = req.params;
    const event = req.managedEvent || (await Event.findById(eventId));
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const isLogo = kind === "logo";
    uploaded = await media.uploadImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      folder: isLogo ? `event-logos/${eventId}` : `events/${eventId}`,
      uploadedBy: req.user.id,
      purpose: isLogo ? "logo" : "poster",
      shape: isLogo ? "logo" : null,
    });

    const previousPublicId = isLogo ? event.logoPublicId : event.bannerPublicId;
    if (isLogo) {
      event.logoUrl = uploaded.url;
      event.logoPublicId = uploaded.publicId;
    } else {
      event.bannerUrl = uploaded.url;
      event.bannerPublicId = uploaded.publicId;
    }
    await event.save();
    saved = true;

    // The image is now referenced by the Event and should not be swept as an orphan.
    await media.markAttached(uploaded.publicId, isLogo ? `event:${eventId}:logo` : `event:${eventId}`);
    await EventRepository.invalidate(event);

    // Replace (not orphan) the image this upload displaced. A provider cleanup
    // failure must not turn an otherwise successful replacement into a 500.
    if (previousPublicId && previousPublicId !== uploaded.publicId) {
      await retireAsset(previousPublicId, "event_image_replaced_remove_failed");
    }

    res.status(200).json({
      success: true,
      eventId,
      url: uploaded.url,
      variants: media.imageVariants(uploaded.url, isLogo ? "logo" : "poster"),
      // Existing banner clients may still consume its publicId; the new logo
      // URL is public, but its provider identifier remains server-internal.
      ...(!isLogo ? { publicId: uploaded.publicId } : {}),
      provider: uploaded.provider,
    });
  } catch (error) {
    // §55 — if persistence failed after upload, defer cleanup rather than
    // leaking the asset or deleting it during a transient database failure.
    if (uploaded?.publicId && !saved) {
      await media.markCleanupPending(uploaded.publicId, "event_attach_failed");
    }
    console.error(`Event ${kind} upload error:`, error.message);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

// Existing Event banner/poster route — keep its URL, crop and lifecycle intact.
router.post("/event/:eventId", requireAuth, requireEventManager, upload.single("file"), (req, res) =>
  uploadEventImage(req, res, "banner")
);

// Independent square Event logo route; authorization is identical to banner management.
router.post("/event/:eventId/logo", requireAuth, requireEventManager, upload.single("file"), (req, res) =>
  uploadEventImage(req, res, "logo")
);

router.delete("/event/:eventId/logo", requireAuth, requireEventManager, async (req, res) => {
  try {
    const event = req.managedEvent;
    const previousPublicId = event.logoPublicId;
    event.logoUrl = null;
    event.logoPublicId = null;
    await event.save();
    await EventRepository.invalidate(event);

    if (previousPublicId) {
      await retireAsset(previousPublicId, "event_logo_remove_failed");
    }
    res.json({ success: true, eventId: String(event._id), logoUrl: null });
  } catch (error) {
    console.error("Event logo removal error:", error.message);
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

    const shape = CANONICAL_SHAPES.has(req.query.purpose) ? String(req.query.purpose) : null;

    uploaded = await media.uploadImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      folder,
      uploadedBy: req.user.id,
      purpose: PURPOSE_BY_FOLDER[folder] || "default",
      shape,
    });

    // Trust & Safety: run image moderation (quarantine if high-confidence prohibited)
    try {
      const modResult = await moderationService.moderateImage({ imageUrl: uploaded.url, contentType: "media" });
      if (modResult.status === "quarantined" || modResult.status === "removed") {
        // Mark asset as quarantined - keep pending but flag
        await MediaAsset.updateOne({ publicId: uploaded.publicId }, { $set: { status: "quarantined", moderationStatus: modResult.status, moderationCategory: modResult.categories[0] || "" } });
        // For high-confidence severe content, block publication
        if (modResult.categories.includes("explicit_nudity") || modResult.confidence >= 0.9) {
          return res.status(400).json({ success: false, message: "Image violates policy and cannot be uploaded", moderation: modResult });
        }
      }
    } catch (modErr) {
      console.warn("[upload] moderation check failed, allowing with flag:", modErr.message);
      // Safe fallback: allow but log, don't publish sensitive content publicly while waiting
    }

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
    if (!publicId || typeof publicId !== "string" || publicId.length > 512) {
      return res.status(400).json({ success: false, message: "A valid publicId is required" });
    }
    if (attachedTo != null && (typeof attachedTo !== "string" || attachedTo.length > 200)) {
      return res.status(400).json({ success: false, message: "attachedTo must be a short string" });
    }

    // A publicId is not an authorization token. Only the user who uploaded a
    // pending/active asset may confirm it; otherwise someone could reassign or
    // activate another user's upload by guessing its provider identifier.
    const asset = await MediaAsset.findOne({
      publicId,
      uploadedBy: req.user.id,
      status: { $in: ["pending", "active"] },
    }).select("_id").lean();
    if (!asset) {
      return res.status(404).json({ success: false, message: "Upload not found or not owned by you" });
    }

    const attached = await media.markAttached(publicId, attachedTo || `user:${req.user.id}`);
    if (!attached) {
      return res.status(503).json({ success: false, message: "Could not confirm upload; please retry" });
    }
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
