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

/* The canonical sizes the frontend renders (§6). The minimums leave room for a
 * smaller future canonical size without loosening the contract to "anything
 * square" — a 64×64 avatars would look broken at 800px. */
const MIN_CANONICAL_AVATAR_PX = 128;
const MAX_CANONICAL_PX = 4096;

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

  // §28 — the file is a real image of the declared type. Now check it is not a
  // decompression bomb: a valid 60 000x60 000 PNG is a few KB on the wire.
  const dimensionError = validateDimensions(buffer);
  if (dimensionError) return dimensionError;

  return null;
}


/**
 * Read an image's pixel dimensions from its header (§28).
 *
 * Magic bytes prove a file IS a PNG; they say nothing about how big it is. A
 * 60 000 × 60 000 PNG is a few kilobytes on the wire and several gigabytes
 * once decoded — the classic decompression bomb. The byte-size ceiling does
 * not catch it, because the wire size is tiny by design.
 *
 * Only the header is parsed. We deliberately never decode the image, because
 * decoding is where the bomb goes off.
 *
 * @returns {{width:number,height:number}|null} null when the header is
 *          unrecognisable — which validateImageBuffer already rejects via
 *          magic bytes, so this is belt-and-braces only.
 */
function readDimensions(buffer) {
  // No global minimum length here: the formats need different amounts (GIF 10
  // bytes, PNG 24, JPEG more), and one shared floor silently disables the
  // check for the shortest format — which is the one an attacker would pick.
  if (!buffer || buffer.length < 10) return null;

  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length < 24) return null;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  // GIF: "GIF8" then width/height as little-endian uint16.
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    if (buffer.length < 10) return null;
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // WebP: "RIFF"...."WEBP", then a chunk. VP8/VP8L/VP8X each encode
  // dimensions differently; VP8X carries the true canvas size.
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" &&
      buffer.slice(8, 12).toString("ascii") === "WEBP") {
    const fmt = buffer.slice(12, 16).toString("ascii");
    try {
      if (fmt === "VP8X" && buffer.length >= 30) {
        // 24-bit canvas width-1 / height-1, little-endian.
        const w = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
        const h = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
        return { width: w, height: h };
      }
      if (fmt === "VP8 " && buffer.length >= 30) {
        // Lossy: 14-bit width/height after the 3-byte frame tag.
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }
      if (fmt === "VP8L" && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    } catch {
      return null;
    }
    return null;
  }

  // JPEG: scan segments for SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15,
  // which carry height (uint16 BE) then width.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      // Standalone markers carry no length field.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2; continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) {
        if (offset + 9 >= buffer.length) return null;
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return null;
  }

  return null;
}

/**
 * §28 dimensions ceiling. Width and height are capped individually — a
 * 10 000 × 10 pixel strip is not a photo — and total pixels are capped too,
 * because memory at decode time scales with pixels, not with either side.
 */
const MAX_DIMENSION_PX = 12000;      // per side
const MAX_TOTAL_PIXELS = 80_000_000; // ~80 MP; well beyond any real photo

function validateDimensions(buffer) {
  const dims = readDimensions(buffer);
  if (!dims) return null; // magic-byte check already handles unrecognised files

  const { width, height } = dims;
  if (width <= 0 || height <= 0) return "That image has invalid dimensions";
  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
    return `Image dimensions are too large (max ${MAX_DIMENSION_PX}px per side)`;
  }
  if (width * height > MAX_TOTAL_PIXELS) {
    return "Image has too many pixels to process safely";
  }
  return null;
}

/**
 * §6 — enforce the CANONICAL SHAPE the uploader declares.
 *
 * The crop editor renders avatars and Event logos as squares, and covers as
 * 3:1, before uploading. Checking it here makes "canonical" a property of the
 * stored asset rather than a promise made by the client: a build that forgot to
 * crop, or a script posting straight to this endpoint, gets a clear 400 instead
 * of quietly storing a non-square avatar/logo that each surface crops differently.
 *
 * This is a CONTRACT check, not a security boundary, and it is deliberately
 * opt-in (`?purpose=`): every security-relevant property — real content type
 * from magic bytes, per-folder size limits, decompression-bomb guard and
 * dimension ceilings — is enforced on every upload regardless of what the
 * caller declares. Shape is validated when declared because this contract
 * protects the user's declared profile/Event asset from inconsistent crops.
 *
 * @returns a user-facing message, or null when the shape is acceptable
 */
function validateShape(buffer, purpose) {
  if (!purpose) return null;

  const dims = readDimensions(buffer);
  if (!dims) return null; // unreachable: validateDimensions ran first
  const { width, height } = dims;

  /* 2% tolerance: the canonical 1600×533 cover is 3.0019:1, not exactly 3:1 —
     rounding to whole pixels means a strict equality check would reject the
     very file this project generates. */
  const TOLERANCE = 0.02;

  if (purpose === "avatar" || purpose === "logo") {
    const ratio = width / height;
    if (Math.abs(ratio - 1) > TOLERANCE) {
      return purpose === "logo"
        ? `An event logo is uploaded as a square, but that one is ${width}×${height}. Crop it first.`
        : `A profile photo is uploaded as a square, but that one is ${width}×${height}. Crop it first.`;
    }
    if (width < MIN_CANONICAL_AVATAR_PX) {
      return purpose === "logo"
        ? `An event logo needs to be at least ${MIN_CANONICAL_AVATAR_PX}×${MIN_CANONICAL_AVATAR_PX}.`
        : `A profile photo needs to be at least ${MIN_CANONICAL_AVATAR_PX}×${MIN_CANONICAL_AVATAR_PX}.`;
    }
    if (width > MAX_CANONICAL_PX) {
      return purpose === "logo"
        ? `An event logo should be at most ${MAX_CANONICAL_PX}px per side.`
        : `A profile photo should be at most ${MAX_CANONICAL_PX}px — it is rendered at 512px.`;
    }
    return null;
  }

  if (purpose === "cover") {
    const ratio = width / height;
    if (Math.abs(ratio - 3) > 3 * TOLERANCE + 0.01) {
      return `A cover photo is uploaded in a 3:1 frame, but that one is ${width}×${height}. Crop it first.`;
    }
    if (width > MAX_CANONICAL_PX) {
      return `A cover photo should be at most ${MAX_CANONICAL_PX}px wide.`;
    }
    return null;
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
  /* "avatar" | "cover" | "logo" when the caller uploads a CANONICAL render
   * (§6). Absent for every other upload, which then keeps the rules it had. */
  shape = null,
}) {
  const validationError = validateImageBuffer(buffer, mimetype, folder);
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  const shapeError = validateShape(buffer, shape);
  if (shapeError) {
    const err = new Error(shapeError);
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
  if (!publicId) return false;
  try {
    const result = await MediaAsset.updateOne(
      { publicId },
      { $set: { status: "active", attachedTo: String(attachedTo || null), cleanupAfter: null, cleanupReason: null } }
    );
    return Boolean(result.matchedCount);
  } catch (err) {
    console.warn("[media] markAttached failed:", err?.message || err);
    return false;
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
  validateDimensions,
  validateShape,
  readDimensions,
  MAX_DIMENSION_PX,
  MAX_TOTAL_PIXELS,
  markAttached,
  markCleanupPending,
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  VARIANT_PRESETS,
  CloudinaryProvider,
};
