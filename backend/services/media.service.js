/**
 * EventHub Media Service — Cloudinary
 * ───────────────────────────────────
 * The ONLY place in the codebase that talks to Cloudinary.
 * Application code calls uploadImage / deleteImage / getOptimizedImageUrl
 * and never depends on upload-provider specifics.
 *
 * Env vars (backend only — secrets are never exposed to the browser):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * If Cloudinary is not configured (e.g. local dev), uploads fall back to
 * local disk storage under /uploads so the app keeps working.
 */
const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// Part 5, Phase 1 (§31/§68): Cloudinary sits behind a circuit breaker with
// a hard timeout. Provider failures surface as StorageUploadError — clean,
// retryable, never leaking provider internals (§61). Metrics feed the
// admin infrastructure dashboard (Phase 7).
const { createCircuitBreaker } = require("../utils/with-timeout");
const { StorageUploadError } = require("../utils/app-error");
const metrics = require("./metrics.service");

function rawCloudinaryUpload(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) =>
      error ? reject(error) : resolve(result)
    );
    stream.end(buffer);
  });
}

const cloudinaryBreaker = createCircuitBreaker("cloudinary", rawCloudinaryUpload, {
  failureThreshold: 4,
  cooldownMs: 30_000,
  timeoutMs: 20_000,
});

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");

const isConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

if (isConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Validate an incoming file before anything else touches it. */
function validateImageFile({ mimetype, size }) {
  if (!mimetype || !ALLOWED_MIME_TYPES.has(mimetype)) {
    return "Only JPEG, PNG, WebP or GIF images are allowed";
  }
  if (!size || size > MAX_FILE_BYTES) {
    return "Image must be 5 MB or smaller";
  }
  return null;
}

/**
 * Validate mimetype only — for multer's fileFilter, where the file object
 * carries no `size` yet (bytes haven't been read). Size is enforced separately
 * by multer's `limits.fileSize` and re-checked on the buffer in uploadImage.
 */
function validateImageMimetype(mimetype) {
  return mimetype && ALLOWED_MIME_TYPES.has(mimetype)
    ? null
    : "Only JPEG, PNG, WebP or GIF images are allowed";
}

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Upload an image buffer.
 * @returns {Promise<{provider:'cloudinary', url:string, publicId:string, width:number, height:number}>|
 *           {provider:'local', url:string, publicId:string}>}
 */
async function uploadImage({ buffer, mimetype, folder = "misc", publicId }) {
  const validationError = validateImageFile({ mimetype, size: buffer.length });
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  const safeFolder = String(folder).replace(/[^a-z0-9/_-]/gi, "") || "misc";
  const id = publicId || `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

  if (isConfigured()) {
    let result;
    try {
      result = await cloudinaryBreaker.invoke(buffer, {
        folder: `eventhub/${safeFolder}`,
        public_id: id,
        resource_type: "image",
      });
    } catch (error) {
      // Breaker open / timeout / provider error → clean surface, real
      // cause stays in server logs (§61), upload metric recorded (§57).
      console.error("Cloudinary upload failed:", error?.message || error);
      metrics.recordUploadFailure();
      throw new StorageUploadError();
    }
    return {
      provider: "cloudinary",
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    };
  }

  // Local fallback (dev only) — keep the app usable without Cloudinary creds
  console.warn("⚠ Cloudinary not configured — storing upload on local disk (dev fallback)");
  const dir = path.join(UPLOADS_DIR, safeFolder);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${id}.${EXT_BY_MIME[mimetype] || "jpg"}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return {
    provider: "local",
    url: `/uploads/${safeFolder}/${filename}`,
    publicId: `local/${safeFolder}/${filename}`,
  };
}

/**
 * Delete an uploaded image by its public id (Cloudinary only; local files
 * are ephemeral dev artifacts).
 */
async function deleteImage(publicId) {
  if (!publicId || !isConfigured() || publicId.startsWith("local/")) return { ok: true };
  try {
    await cloudinary.uploader.destroy(publicId);
    return { ok: true };
  } catch (error) {
    console.error("Cloudinary delete error:", error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Get an optimized/transformed image URL.
 * Pass a full Cloudinary URL or a public id; non-Cloudinary URLs are
 * returned untouched (with a cache-busting-free passthrough).
 */
function getOptimizedImageUrl(urlOrId, { width = 800, height, quality = "auto", format = "auto" } = {}) {
  if (!urlOrId) return urlOrId;

  // Already a Cloudinary delivery URL → inject/replace transformations
  const match = urlOrId.match(
    /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload)(?:\/[^/]*)(\/.+)$/
  );
  const transformation = `c_limit,w_${width}${height ? `,h_${height}` : ""},q_${quality},f_${format}`;

  if (match) {
    return `${match[1]}/${transformation}${match[2]}`;
  }
  if (isConfigured() && !urlOrId.startsWith("http") && !urlOrId.startsWith("/")) {
    // Bare public id
    return cloudinary.url(urlOrId, {
      secure: true,
      transformation: [{ width, crop: "limit", quality, fetch_format: format }],
    });
  }
  return urlOrId;
}

module.exports = {
  isConfigured,
  uploadImage,
  deleteImage,
  getOptimizedImageUrl,
  validateImageFile,
  validateImageMimetype,
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
};
