/**
 * StorageProvider abstraction (Part 5, Phase 4 — spec §19–§23, §55, §66)
 * ─────────────────────────────────────────────────────────────────────────
 * ONE interface for every place EventHub stores a binary asset.
 *
 * Why this exists:
 *   §66 requires provider abstractions so a future migration (Cloudinary →
 *   R2/S3, or adding R2 for large files) is a change inside THIS file rather
 *   than a rewrite of every upload call site. The frontend must not change at
 *   all during such a migration.
 *
 *   §21 splits responsibilities by asset class:
 *     Cloudinary → small/optimized images (avatars, posters, social images)
 *     R2          → large files (certificates, CSV exports, documents)
 *   Only Cloudinary exists today. The interface below is deliberately shaped
 *   so an `R2Provider` can be dropped in later without touching callers:
 *   R2 simply has no transformation engine, so its `optimizeUrl`/`variants`
 *   degrade to returning the original URL — which the interface already
 *   permits.
 *
 * ── Interface contract ──────────────────────────────────────────────────
 *   name                                    provider identifier
 *   isConfigured()                          can this provider actually run?
 *   upload({buffer, mimetype, folder, publicId})
 *        → { provider, url, publicId, width?, height?, bytes }
 *   remove(publicId)                        → { ok }
 *   optimizeUrl(urlOrId, {width,height,crop,quality,format}) → string
 *   variants(urlOrId, presetName)           → { thumb, small, medium, large, original }
 *
 * Any new provider implements these six members and nothing else changes.
 */

const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { createCircuitBreaker } = require("../utils/with-timeout");
const metrics = require("./metrics.service");

/* ── Allowed image types ─────────────────────────────────────────────── */
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Per-folder size caps (§20, §63).
 * An avatar never needs 5 MB — it is rendered at ≤400 px. Letting clients
 * upload a 5 MB phone photo for a 64 px thumbnail wastes bandwidth, storage
 * and Cloudinary transformation credits, so each folder gets a ceiling that
 * matches how the image is actually used.
 */
const FOLDER_LIMITS = {
  avatars: 2 * 1024 * 1024, // 2 MB — rendered at 64–400 px
  organizers: 2 * 1024 * 1024, // logos
  posts: 5 * 1024 * 1024, // feed photos
  posters: 8 * 1024 * 1024, // event banners are the widest asset we serve
  questions: 3 * 1024 * 1024, // live-quiz question media
  "registration-files": 5 * 1024 * 1024,
  misc: 5 * 1024 * 1024,
};
const DEFAULT_LIMIT = 5 * 1024 * 1024;

const folderLimit = (folder) =>
  FOLDER_LIMITS[String(folder).split("/")[0]] || DEFAULT_LIMIT;

/**
 * Magic-byte sniffing (§62 — do not trust the client-declared MIME type).
 * `file.mimetype` comes straight from the browser and is trivially spoofed,
 * so a client could label a payload `image/png` while uploading something
 * else. This reads the actual file signature and we require the two to agree.
 */
function sniffMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  // WEBP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  // GIF: GIF87a / GIF89a
  const gif = buffer.subarray(0, 6).toString("ascii");
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  return null;
}

/* ══════════════════════════════════════════════════════════════════════
 * Cloudinary provider — small/optimized images (§19–§21)
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Where the local fallback writes. Overridable so tests (and ephemeral
 * environments) never pollute the repository with fixture images.
 */
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, "..", "uploads");

function rawCloudinaryUpload(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) =>
      error ? reject(error) : resolve(result)
    );
    stream.end(buffer);
  });
}

// §31/§68 — Cloudinary is an OPTIONAL dependency. Behind a circuit breaker
// and a hard timeout, a provider outage yields a clean StorageUploadError
// instead of hanging requests or crashing the app.
const cloudinaryBreaker = createCircuitBreaker("cloudinary", rawCloudinaryUpload, {
  failureThreshold: 4,
  cooldownMs: 30_000,
  timeoutMs: 20_000,
});

/**
 * Canonical responsive variant presets (§19).
 * Keys are the names the API and frontend speak — never ad-hoc pixel values.
 */
const VARIANT_PRESETS = {
  avatar: { thumb: 64, small: 160, medium: 400, large: 800 },
  logo: { thumb: 80, small: 200, medium: 400, large: 800 },
  poster: { thumb: 320, small: 640, medium: 1024, large: 1600 },
  post: { thumb: 320, small: 640, medium: 1024, large: 1400 },
  banner: { thumb: 480, small: 960, medium: 1440, large: 1920 },
  default: { thumb: 160, small: 400, medium: 800, large: 1200 },
};

/** Cloudinary delivery-URL matcher: captures everything before the path. */
const CLOUDINARY_URL_RE = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload)(\/.+)$/;

/**
 * Does this path segment look like a transformation rather than a folder?
 * Transformations are `key_value` pairs joined by commas (w_640,c_limit,…).
 */
function isTransformationSegment(seg) {
  return /^[a-z]{1,3}_[^/]*$/.test(seg) || seg.includes(",");
}

/**
 * Split a Cloudinary delivery URL so a NEW transformation can be injected
 * without destroying anything else in the path.
 *
 * Segments after /image/upload/ may contain, in order:
 *   1. an existing transformation (e.g. w_640,c_limit,q_auto,f_auto)
 *   2. an optional version marker      (e.g. v1712345678)
 *   3. the asset path                  (e.g. eventhub/posters/abc.jpg)
 *
 * The previous implementation used a single `\/[^\/]*` group that swallowed
 * whichever segment came first — which silently DELETED the version marker on
 * every call. Re-optimizing an image also stacked transformations instead of
 * replacing them. We now parse the segments explicitly: drop only the
 * transformation, and always preserve the version and asset path.
 */
function splitCloudinaryUrl(url) {
  const match = String(url).match(CLOUDINARY_URL_RE);
  if (!match) return null;

  const [, prefix, rest] = match;
  const parts = rest.split("/").filter(Boolean);
  let i = 0;

  // 1. drop an existing transformation so re-optimizing is idempotent
  if (parts[i] && isTransformationSegment(parts[i])) i += 1;
  // 2. preserve the version marker (cache-busting / asset identity)
  let version = "";
  if (parts[i] && /^v\d+$/.test(parts[i])) {
    version = `/${parts[i]}`;
    i += 1;
  }
  // 3. everything else is the asset path
  const assetPath = `/${parts.slice(i).join("/")}`;
  return { prefix, version, assetPath };
}

const CloudinaryProvider = {
  name: "cloudinary",

  isConfigured() {
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
  },

  configure() {
    if (this.isConfigured()) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
      });
    }
  },

  async upload({ buffer, mimetype, folder = "misc", publicId }) {
    const safeFolder = String(folder).replace(/[^a-z0-9/_-]/gi, "") || "misc";
    const id = publicId || `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

    const result = await cloudinaryBreaker.invoke(buffer, {
      folder: `eventhub/${safeFolder}`,
      public_id: id,
      resource_type: "image",
    });

    return {
      provider: this.name,
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
    };
  },

  async remove(publicId) {
    if (!publicId || String(publicId).startsWith("local/")) return { ok: true };
    try {
      await cloudinary.uploader.destroy(publicId);
      return { ok: true };
    } catch (error) {
      console.error("Cloudinary delete error:", error.message);
      return { ok: false, error: error.message };
    }
  },

  /**
   * Build a transformed delivery URL (§19, §46).
   * Non-Cloudinary URLs pass through untouched so legacy/local assets still
   * render — a broken image is worse than an unoptimized one.
   */
  optimizeUrl(urlOrId, { width, height, crop = "limit", quality = "auto", format = "auto" } = {}) {
    if (!urlOrId) return urlOrId;

    const parts = [];
    if (width) parts.push(`w_${width}`);
    if (height) parts.push(`h_${height}`);
    if (width || height) parts.push(`c_${crop}`);
    parts.push(`q_${quality}`, `f_${format}`);
    const transformation = parts.join(",");

    const parsed = splitCloudinaryUrl(urlOrId);
    if (parsed) {
      const { prefix, version, assetPath } = parsed;
      return `${prefix}/${transformation}${version}${assetPath}`;
    }

    // Bare public id
    if (!String(urlOrId).startsWith("http") && !String(urlOrId).startsWith("/")) {
      try {
        return cloudinary.url(String(urlOrId), {
          secure: true,
          transformation: [{ width, height, crop, quality, fetch_format: format }],
        });
      } catch {
        return urlOrId;
      }
    }
    return urlOrId;
  },

  /**
   * The full responsive set for one image (§19).
   * `original` is retained for "open full size" affordances only — list and
   * card UIs must use `thumb`/`small`/`medium`.
   */
  variants(urlOrId, presetName = "default") {
    const preset = VARIANT_PRESETS[presetName] || VARIANT_PRESETS.default;
    const original = urlOrId || null;
    if (!original) {
      return { thumb: null, small: null, medium: null, large: null, original: null };
    }
    const build = (w) => this.optimizeUrl(original, { width: w });
    return {
      thumb: build(preset.thumb),
      small: build(preset.small),
      medium: build(preset.medium),
      large: build(preset.large),
      original,
    };
  },
};

/* ══════════════════════════════════════════════════════════════════════
 * Local provider — dev fallback (no Cloudinary credentials)
 * ══════════════════════════════════════════════════════════════════════ */

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const LocalProvider = {
  name: "local",

  isConfigured() {
    return true; // always available — keeps local dev working with no secrets
  },

  configure() {},

  async upload({ buffer, mimetype, folder = "misc", publicId }) {
    const safeFolder = String(folder).replace(/[^a-z0-9/_-]/gi, "") || "misc";
    const id = publicId || `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const dir = path.join(UPLOADS_DIR, safeFolder);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${id}.${EXT_BY_MIME[mimetype] || "jpg"}`;
    fs.writeFileSync(path.join(dir, filename), buffer);
    return {
      provider: this.name,
      url: `/uploads/${safeFolder}/${filename}`,
      publicId: `local/${safeFolder}/${filename}`,
      bytes: buffer.length,
    };
  },

  async remove(_publicId) {
    // Local files are ephemeral dev artifacts — nothing to reclaim.
    return { ok: true };
  },

  // No transformation engine locally: served as-is.
  optimizeUrl(urlOrId) {
    return urlOrId;
  },

  variants(urlOrId) {
    return {
      thumb: urlOrId || null,
      small: urlOrId || null,
      medium: urlOrId || null,
      large: urlOrId || null,
      original: urlOrId || null,
    };
  },
};

/* ── Provider selection (§66) ─────────────────────────────────────────── */

CloudinaryProvider.configure();

/** The active provider. Swap here (or by env) to migrate without touching callers. */
const provider = CloudinaryProvider.isConfigured() ? CloudinaryProvider : LocalProvider;

if (provider.name === "local") {
  console.warn("⚠ Storage: Cloudinary not configured — using LOCAL DISK fallback (dev only)");
}

module.exports = {
  provider,
  CloudinaryProvider,
  LocalProvider,
  VARIANT_PRESETS,
  ALLOWED_MIME_TYPES,
  FOLDER_LIMITS,
  folderLimit,
  sniffMime,
  cloudinaryBreaker,
  metrics,
};
