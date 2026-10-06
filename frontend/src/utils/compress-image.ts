/**
 * Client-side image compression (Part 5, Phase 4 — spec §20, §51)
 * ────────────────────────────────────────────────────────────────
 * "Do not upload a 10MB phone image if the UI only needs a 1200px image."
 *
 * A modern phone camera produces 4–12 MB photos. EventHub renders:
 *   avatars  at ≤400 px
 *   posters  at ≤1600 px
 *   feed photos at ≤1400 px
 *
 * Uploading the original wastes the user's mobile data (EventHub is
 * mobile-first — §51), our bandwidth, and Cloudinary storage/credits.
 *
 * Strategy (no new dependencies — canvas only):
 *   1. Decode the file into an <img> via an object URL.
 *   2. Downscale so the longest edge fits `maxDimension` (never upscale).
 *   3. Re-encode as JPEG/WebP at decreasing quality until the result fits
 *      `maxSizeBytes`, or we hit the quality floor.
 *   4. If anything fails, or compression doesn't help, return the ORIGINAL.
 *      A degraded path must never block an upload (§68).
 *
 * Deliberately skipped:
 *   • GIF  — re-encoding kills animation.
 *   • SVG  — vector, already tiny.
 *   • Already-small files — not worth the CPU on a low-end device.
 */

export interface CompressOptions {
  /** Longest edge of the output, in pixels. */
  maxDimension?: number;
  /** Target byte ceiling; quality is reduced until we fit (or hit the floor). */
  maxSizeBytes?: number;
  /** Starting quality 0–1 (default 0.82). */
  quality?: number;
  /** Lowest quality we're willing to go to (default 0.6). */
  minQuality?: number;
  /** Output mime (default image/jpeg). */
  mimeType?: string;
}

export interface CompressResult {
  file: File;
  originalBytes: number;
  resultBytes: number;
  /** True when we returned the original untouched. */
  skipped: boolean;
  reason?: string;
}

const SKIP_TYPES = new Set(["image/gif", "image/svg+xml"]);

/** Below this, compression costs more CPU than it saves bandwidth. */
const MIN_WORTHWHILE_BYTES = 200 * 1024; // 200 KB

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      mimeType,
      quality
    );
  });
}

/**
 * Downscale + re-encode a File.
 * Always resolves — failures fall through to the original file.
 */
export async function compressImage(
  file: File,
  {
    maxDimension = 1600,
    maxSizeBytes = 1.5 * 1024 * 1024, // 1.5 MB
    quality = 0.82,
    minQuality = 0.6,
    mimeType = "image/jpeg",
  }: CompressOptions = {}
): Promise<CompressResult> {
  const originalBytes = file.size;
  const bail = (reason: string): CompressResult => ({
    file,
    originalBytes,
    resultBytes: originalBytes,
    skipped: true,
    reason,
  });

  // Environment / type guards
  if (typeof window === "undefined" || typeof document === "undefined") {
    return bail("no browser environment");
  }
  if (!file.type.startsWith("image/")) return bail("not an image");
  if (SKIP_TYPES.has(file.type)) return bail(`${file.type} is not re-encoded`);
  if (originalBytes < MIN_WORTHWHILE_BYTES) return bail("already small enough");

  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await loadImage(objectUrl);

    const { width, height } = img;
    const longestEdge = Math.max(width, height);

    // Never upscale — if it already fits, only re-encode.
    const scale = longestEdge > maxDimension ? maxDimension / longestEdge : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return bail("canvas unavailable");

    // Smoother downscaling than the default in most browsers.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // JPEG has no alpha — fill white so transparent PNGs don't turn black.
    if (mimeType === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);

    // Reduce quality until we fit the target (or reach the floor).
    let q = quality;
    let blob: Blob | null = null;
    while (q >= minQuality) {
      blob = await canvasToBlob(canvas, mimeType, q);
      if (!blob) return bail("encoding failed");
      if (blob.size <= maxSizeBytes) break;
      q -= 0.08;
    }

    // Last resort: shrink the image instead of the quality, once.
    if (blob && blob.size > maxSizeBytes) {
      const shrink = Math.sqrt(maxSizeBytes / blob.size) * 0.95;
      const w2 = Math.max(1, Math.round(targetW * shrink));
      const h2 = Math.max(1, Math.round(targetH * shrink));
      canvas.width = w2;
      canvas.height = h2;
      ctx.fillStyle = "#ffffff";
      if (mimeType === "image/jpeg") ctx.fillRect(0, 0, w2, h2);
      ctx.drawImage(img, 0, 0, w2, h2);
      blob = await canvasToBlob(canvas, mimeType, minQuality);
    }

    if (!blob) return bail("encoding failed");

    // If we somehow made it bigger, keep the original (§68: never regress).
    if (blob.size >= originalBytes) return bail("compression did not help");

    const ext = mimeType === "image/webp" ? "webp" : "jpg";
    const compressed = new File([blob], file.name.replace(/\.[^.]+$/, `.${ext}`), {
      type: mimeType,
      lastModified: Date.now(),
    });

    return { file: compressed, originalBytes, resultBytes: compressed.size, skipped: false };
  } catch (err) {
    return bail(`compression failed: ${(err as Error)?.message || "unknown"}`);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** Presets matching the backend variant families (§19 + §20 alignment). */
export const COMPRESS_PRESETS = {
  /** Avatars render at 64–400 px. */
  avatar: { maxDimension: 512, maxSizeBytes: 400 * 1024, quality: 0.85 } as CompressOptions,
  /** Event posters/banners — the widest asset we serve. */
  poster: { maxDimension: 1920, maxSizeBytes: 2 * 1024 * 1024, quality: 0.82 } as CompressOptions,
  /** Feed photos. */
  post: { maxDimension: 1400, maxSizeBytes: 1.5 * 1024 * 1024, quality: 0.8 } as CompressOptions,
  /** Org / community logos. */
  logo: { maxDimension: 800, maxSizeBytes: 500 * 1024, quality: 0.85 } as CompressOptions,
};

export async function compressFor(
  file: File,
  purpose: keyof typeof COMPRESS_PRESETS
): Promise<CompressResult> {
  return compressImage(file, COMPRESS_PRESETS[purpose] || COMPRESS_PRESETS.post);
}
