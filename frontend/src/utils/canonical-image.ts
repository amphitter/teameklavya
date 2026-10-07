/**
 * Canonical image rendering (§6, §25, §26).
 *
 * This is the step that fixes "nose on device A, whole face on device B".
 *
 * Before: the original upload was stored as-is, and every surface asked the CDN
 * for its own crop of it — so what ended up inside the circle depended on the
 * container, the device pixel ratio and the breakpoint.
 *
 * After: the user's chosen crop is rendered ONCE, here, at a fixed size and a
 * 1:1 (or fixed) aspect. That file is what gets stored. Every surface then
 * scales *that* image, so the composition is a property of the asset rather
 * than of the viewer's device.
 *
 * Re-encoding through a canvas has a second, deliberate benefit: it drops
 * EXIF outright — including the GPS coordinates a phone camera writes into
 * every photo (§25). The bytes that leave the browser carry pixels and nothing
 * else. The backend does its own magic-byte, size and dimension validation on
 * top; this is the client half of that contract, not a replacement for it.
 */

import { sourceRectFromNormalized, type CropRect } from "@/lib/crop";

/** Canonical output sizes. One asset, many display sizes (§26). */
export const AVATAR_CANONICAL_PX = 512;
export const COVER_CANONICAL_W = 1600;
export const COVER_CANONICAL_H = 533; // 3:1 — the crop frame the editor shows

export interface LoadedImage {
  image: HTMLImageElement;
  width: number;
  height: number;
  /** Call when finished — releases the object URL (or just no-ops for a URL load). */
  revoke: () => void;
}

/**
 * Decode a File or a URL into an element we can draw.
 *
 * `crossOrigin="anonymous"` matters for the re-crop flow: a Cloudinary image
 * loaded without it taints the canvas, and `toBlob` then throws a SecurityError
 * that looks like a mystery failure. Cloudinary serves `Access-Control-Allow-
 * Origin: *`, so the cross-origin fetch succeeds — and if the asset is not
 * CORS-enabled the caller gets a clear error instead of a blank avatar.
 */
export function loadImage(src: File | string): Promise<LoadedImage> {
  const isFile = typeof src !== "string";
  const url = isFile ? URL.createObjectURL(src) : src;
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!isFile) image.crossOrigin = "anonymous";
    image.onload = () =>
      resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        revoke: () => {
          if (isFile) URL.revokeObjectURL(url);
        },
      });
    image.onerror = () => {
      if (isFile) URL.revokeObjectURL(url);
      reject(new Error("That image couldn't be opened."));
    };
    image.src = url;
  });
}

/**
 * Draw the cropped region at the canonical size and return it as a File.
 *
 * `mime` defaults to JPEG: a photo has no transparency worth keeping, and JPEG
 * at this quality is typically 3–6× smaller than PNG for the same picture on a
 * phone connection. WebP is used when the browser supports encoding it, which
 * is most of them and is smaller still.
 */
export async function renderCanonical(
  loaded: LoadedImage,
  crop: CropRect | null,
  outW: number,
  outH: number,
  opts: { quality?: number; mime?: string; fileName?: string } = {}
): Promise<File> {
  const { image, width, height } = loaded;
  const rect = crop
    ? sourceRectFromNormalized(crop, width, height)
    : // No crop supplied (legacy image, or a straight re-upload): a centred
      // window of the right aspect, which is the same thing a fresh editor
      // session starts on.
      centredSourceRect(width, height, outW / outH);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images.");
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(
    image,
    Math.round(rect.sx),
    Math.round(rect.sy),
    Math.round(rect.sw),
    Math.round(rect.sh),
    0,
    0,
    outW,
    outH
  );

  const mime = opts.mime || (supportsWebpEncoding() ? "image/webp" : "image/jpeg");
  const quality = opts.quality ?? 0.9;

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error("Couldn't process that image — please try another.");

  const ext = mime === "image/webp" ? "webp" : "jpg";
  return new File([blob], opts.fileName || `profile-${Date.now()}.${ext}`, { type: mime });
}

/** Centred window of the given aspect that fits inside the source. */
export function centredSourceRect(iw: number, ih: number, aspect: number) {
  const targetAspect = aspect || 1;
  let sw = iw;
  let sh = iw / targetAspect;
  if (sh > ih) {
    sh = ih;
    sw = ih * targetAspect;
  }
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh };
}

let webpSupport: boolean | null = null;
/** Canvas WebP encoding — widely supported, but not universally. */
export function supportsWebpEncoding(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpSupport = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/**
 * The crop the editor should open with when nothing is stored yet: the largest
 * centred square (or cover-aspect) window, i.e. the identity view. Expressed
 * normalized so it is device-independent.
 */
export function defaultCrop(iw: number, ih: number, aspect = 1): CropRect {
  const r = centredSourceRect(iw, ih, aspect);
  return { x: r.sx / iw, y: r.sy / ih, w: r.sw / iw, h: r.sh / ih };
}
