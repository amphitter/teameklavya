/**
 * EventHub Media Service — the ONLY place application code touches storage.
 * ─────────────────────────────────────────────────────────────────────────
 * Application code calls uploadImage / deleteImage / getOptimizedImageUrl /
 * imageVariants and never depends on provider specifics (§66). The concrete
 * provider lives in `services/storage.provider.js`.
 *
 * Part 5 Phase 4 additions:
 *   • §19  `imageVariants()` — canonical responsive sets (thumb/small/medium/
 *          large) so list and card UIs NEVER load a full-resolution original.
 *   • §20  per-folder size ceilings, so an avatar upload can't burn the same
 *          budget as an event banner.
 *   • §55  `trackAsset()` / `markAttached()` / `markCleanupPending()` — orphan
 *          tracking. If an upload succeeds but the database write fails, the
 *          asset is marked `cleanup_pending` and reclaimed later by
 *          `scripts/media-sweeper.js` instead of leaking forever.
 *   • §62  magic-byte validation — the browser-supplied MIME type is not
 *          trusted; the real file signature must agree.
 *
 * Env vars (backend only — secrets never reach the browser):
 *   CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 *
 * Without credentials the app falls back to local disk so dev still works.
 */

const {
  provider,
  CloudinaryProvider,
  VARIANT_PRESETS,
  ALLOWED_MIME_TYPES,
  folderLimit,
  sniffMime,
} = require("./storage.provider");

const { StorageUploadError } = require("../utils/app-error");
const metrics = require("./metrics.service");

const MediaAsset = require("../models/mediaAsset.model");

const MAX_FILE_BYTES = 8 * 1024 * 1024; // hard ceiling for any single upload

/* ── Validation (§62, §63) ───────────────────────────────────────────── */

/**
 * Validate a buffer's real content against its declared type.
 * Returns a user-facing message, or null when the file is acceptable.
 *
 * Two checks:
 *   1. declared MIME must be one we support
 *   2. the magic bytes must actually match that type (anti-spoofing)
 */
function validateImageBuffer(buffer, mimetype, folder = "misc") {
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    return "Only JPEG, PNG, WebP or GIF images are allowed";
  }
  if (!buffer || !buffer.length) {
    return "Empty file";
  }

  const limit = folderLimit(folder);
  if (buffer.length > limit) {
    const mb = (limit / (1024 * 1024)).toFixed(0);
    return `Image is too large for this upload type (max ${mb} MB)`;
  }

  const actual = sniffMime(buffer);
  if (!actual) {
    return "That file doesn't look like a valid image";
  }
  if (actual !== mimetype) {
    // Not leaked to the client in detail — just a clean rejection (§61).
    return "File contents don't match the declared image type";
  }
  return null;
}

/** Validate for multer's fileFilter, which runs before bytes are read. */
function validateImageMimetype(mimetype) {
  return mimetype && ALLOWED_MIME_TYPES.has(mimetype)
    ? null
    : "Only JPEG, PNG, WebP or GIF images are allowed";
}

/** Legacy signature kept for compatibility with existing call sites. */
function validateImageFile({ mimetype, size }) {
  if (!mimetype || !ALLOWED_MIME_TYPES.has(mimetype)) {
    return "Only JPEG, PNG, WebP or GIF images are allowed";
  }
  if (!size || size > MAX_FILE_BYTES) {
    return "Image must be 8 MB or smaller";
  }
  return null;
}

const isConfigured = () => provider.name !== "local";

/* ── Upload (§20, §55) ───────────────────────────────────────────────── */

/**
 * Upload an image and register it for orphan tracking.
 *
 * The asset is recorded as `pending` BEFORE the upload. Callers that attach
 * it to a domain object then call `markAttached()`; if they never do (the
 * request failed, the DB write threw), the record stays `pending` and the
 * sweeper reclaims it. This is the §55 rule: never delete immediately, mark
 * and reclaim safely later.
 *
 * @returns {Promise<{provider, url, publicId, width?, height?, bytes?}>}
 */
async function uploadImage({
  buffer,
  mimetype,
  folder = "misc",
  publicId,
  uploadedBy = null,
  purpose = "default",
}) {
  const validationError = validateImageBuffer(buffer, mimetype, folder);
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  let result;
  try {
    result = await provider.upload({ buffer, mimetype, folder, publicId });
  } catch (error) {
    console.error(`[media] upload failed (${provider.name}):`, error?.message || error);
    metrics.recordUploadFailure();
    throw new StorageUploadError();
  }

  metrics.recordUploadSuccess?.();

  // Orphan tracking — best effort, never blocks the upload.
  try {
    await MediaAsset.create({
      publicId: result.publicId,
      provider: result.provider,
      folder,
      purpose,
      url: result.url,
      bytes: result.bytes || buffer.length,
      uploadedBy: uploadedBy || null,
      status: "pending",
      // Reclaim anything still unattached after 24h.
      cleanupAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  } catch (assetErr) {
    // §68 — asset bookkeeping must never fail a successful upload.
    console.warn("[media] asset tracking failed:", assetErr?.message || assetErr);
  }

  return result;
}

/** Delete an uploaded image by public id. */
async function deleteImage(publicId) {
  if (!publicId) return { ok: true };
  const outcome = await provider.remove(publicId);
  if (outcome.ok) {
    try {
      await MediaAsset.updateOne(
        { publicId },
        { $set: { status: "deleted", deletedAt: new Date() } }
      );
    } catch (_err) {
      /* bookkeeping only */
    }
  }
  return outcome;
}

/* ── Delivery (§19) ──────────────────────────────────────────────────── */

/**
 * Optimized single-URL transform.
 * @param {string} urlOrId
 * @param {{width?:number,height?:number,crop?:string,quality?:string,format?:string}} opts
 */
function getOptimizedImageUrl(urlOrId, opts = {}) {
  return provider.optimizeUrl(urlOrId, opts);
}

/**
 * The responsive variant set for one image (§19).
 *
 * Cards and lists should use `thumb` or `small`; detail views use `medium`
 * or `large`. `original` exists only for explicit "view full size" actions —
 * serving it inside a feed is exactly the waste this phase removes.
 *
 * @param {string} urlOrId
 * @param {"avatar"|"logo"|"poster"|"post"|"banner"|"default"} preset
 * @returns {{thumb:string|null, small:string|null, medium:string|null,
 *            large:string|null, original:string|null}}
 */
function imageVariants(urlOrId, preset = "default") {
  return provider.variants(urlOrId, preset);
}

/* ── Orphan lifecycle (§55) ──────────────────────────────────────────── */

/** Confirm an asset is in use by a domain object (event, post, user…). */
async function markAttached(publicId, attachedTo) {
  if (!publicId) return;
  try {
    await MediaAsset.updateOne(
      { publicId },
      { $set: { status: "active", attachedTo: String(attachedTo || null), cleanupAfter: null } }
    );
  } catch (err) {
    console.warn("[media] markAttached failed:", err?.message || err);
  }
}

/**
 * Flag an asset for safe reclamation — used when the upload succeeded but the
 * subsequent database write failed. We never delete immediately: a transient
 * DB blip shouldn't destroy a user's upload, so it gets a grace window and is
 * removed by the sweeper instead.
 */
async function markCleanupPending(publicId, reason = "attach_failed") {
  if (!publicId) return;
  try {
    await MediaAsset.updateOne(
      { publicId },
      {
        $set: {
          status: "cleanup_pending",
          cleanupReason: String(reason).slice(0, 200),
          cleanupAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      }
    );
  } catch (err) {
    console.warn("[media] markCleanupPending failed:", err?.message || err);
  }
}

module.exports = {
  isConfigured,
  uploadImage,
  deleteImage,
  getOptimizedImageUrl,
  imageVariants,
  validateImageFile,
  validateImageBuffer,
  validateImageMimetype,
  markAttached,
  markCleanupPending,
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  VARIANT_PRESETS,
  CloudinaryProvider,
};
