/**
 * Crop geometry — the maths behind the profile-photo editor.
 *
 * Kept pure and framework-free on purpose: this is the part that decides what
 * ends up inside a person's profile picture, so it is the part worth testing
 * without a browser. `tests/crop.test.js` exercises every function here.
 *
 * The model
 * ---------
 * An image (iw × ih source pixels) sits behind a fixed window (boxW × boxH CSS
 * pixels) — the crop frame. The image is always scaled to *cover* the window,
 * then the user pans (`offset`) and zooms (`zoom`, a multiplier over the
 * cover-fit scale). The window is what gets saved, so the window's position
 * over the source pixels is the whole story:
 *
 *     source rect = window mapped back through the current view
 *
 * Every value the editor produces is expressed twice:
 *   • as source pixels, to draw the final canvas
 *   • as a 0–1 fraction of the original, to store and to re-open later
 */

export interface CropRect {
  /** Left edge, as a fraction of the source width (0–1). */
  x: number;
  /** Top edge, as a fraction of the source height (0–1). */
  y: number;
  /** Width, as a fraction of the source width (0–1). */
  w: number;
  /** Height, as a fraction of the source height (0–1). */
  h: number;
}

/** Source-pixel window, i.e. the part of the original that becomes the avatar. */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Scale that makes a `iw × ih` image exactly cover a `boxW × boxH` frame.
 * `max` (not `min`) is what "cover" means: one axis overflows, and that
 * overflow is the room the user pans around in.
 */
export function coverScale(iw: number, ih: number, boxW: number, boxH: number): number {
  if (!iw || !ih || !boxW || !boxH) return 1;
  return Math.max(boxW / iw, boxH / ih);
}

/**
 * How far the image may be dragged before its edge would come inside the frame.
 * Returned as the maximum absolute offset, in CSS pixels, on each axis.
 */
export function offsetLimits(
  iw: number,
  ih: number,
  effectiveScale: number,
  boxW: number,
  boxH: number
): { maxX: number; maxY: number } {
  const dw = iw * effectiveScale;
  const dh = ih * effectiveScale;
  return {
    maxX: Math.max(0, (dw - boxW) / 2),
    maxY: Math.max(0, (dh - boxH) / 2),
  };
}

/** Keep a pan inside the limits — the frame can never show past an edge. */
export function clampOffset(
  offset: { x: number; y: number },
  iw: number,
  ih: number,
  effectiveScale: number,
  boxW: number,
  boxH: number
): { x: number; y: number } {
  const { maxX, maxY } = offsetLimits(iw, ih, effectiveScale, boxW, boxH);
  return { x: clamp(offset.x, -maxX, maxX), y: clamp(offset.y, -maxY, maxY) };
}

/**
 * The window's rectangle in SOURCE pixels — what the canvas draws.
 *
 * Derivation: the image's top-left in frame coordinates is
 *   left = boxW/2 - dw/2 + offset.x
 * so a frame pixel at x maps to source pixel (x - left) / effectiveScale.
 * The window starts at frame x = 0 and is boxW wide.
 */
export function sourceRectFromView({
  iw,
  ih,
  effectiveScale,
  offset,
  boxW,
  boxH,
}: {
  iw: number;
  ih: number;
  effectiveScale: number;
  offset: { x: number; y: number };
  boxW: number;
  boxH: number;
}): SourceRect {
  const dw = iw * effectiveScale;
  const dh = ih * effectiveScale;
  const left = boxW / 2 - dw / 2 + offset.x;
  const top = boxH / 2 - dh / 2 + offset.y;
  return {
    sx: clamp(-left / effectiveScale, 0, Math.max(0, iw - boxW / effectiveScale)),
    sy: clamp(-top / effectiveScale, 0, Math.max(0, ih - boxH / effectiveScale)),
    sw: boxW / effectiveScale,
    sh: boxH / effectiveScale,
  };
}

/** Source pixels → the storable 0–1 fraction. */
export function normalizedFromSourceRect(rect: SourceRect, iw: number, ih: number): CropRect {
  return {
    x: rect.sx / iw,
    y: rect.sy / ih,
    w: rect.sw / iw,
    h: rect.sh / ih,
  };
}

/** The storable fraction → source pixels, for drawing. */
export function sourceRectFromNormalized(crop: CropRect, iw: number, ih: number): SourceRect {
  return {
    sx: crop.x * iw,
    sy: crop.y * ih,
    sw: crop.w * iw,
    sh: crop.h * ih,
  };
}

/**
 * Re-open a saved crop in the editor.
 *
 * Returns the zoom multiplier and pan that reproduce `crop` exactly, so the
 * "re-crop this photo" flow starts from what the user chose last time rather
 * than from a fresh centre crop.
 */
export function viewFromNormalized(
  crop: CropRect,
  iw: number,
  ih: number,
  boxW: number,
  boxH: number
): { zoom: number; offset: { x: number; y: number } } {
  const base = coverScale(iw, ih, boxW, boxH);
  const { sx, sy, sw, sh } = sourceRectFromNormalized(crop, iw, ih);
  // Ignore a degenerate crop rather than dividing by zero.
  if (!sw || !sh) return { zoom: 1, offset: { x: 0, y: 0 } };

  // Match the horizontal window (avatar) or the vertical one (wide cover) —
  // whichever the crop actually constrains — then clamp the pan to legal range.
  const scaleForW = boxW / sw;
  const scaleForH = boxH / sh;
  const scaleForAspect = boxW / boxH >= iw / ih ? scaleForW : scaleForH;
  const effectiveScale = scaleForAspect;
  const zoom = effectiveScale / base;

  const dw = iw * effectiveScale;
  const dh = ih * effectiveScale;
  const offset = clampOffset(
    { x: dw / 2 - boxW / 2 - sx * effectiveScale, y: dh / 2 - boxH / 2 - sy * effectiveScale },
    iw,
    ih,
    effectiveScale,
    boxW,
    boxH
  );
  return { zoom, offset };
}

/**
 * Vertical focal point (0–100) for the banner's `object-position`.
 *
 * A 1600×533 cover is displayed in boxes ranging from ~3.5:1 on a phone to
 * ~6:1 on a desktop, so `object-fit: cover` trims different amounts at each
 * breakpoint. Anchoring on the *centre of the user's own crop* is what keeps
 * the visible slice the same composition everywhere, instead of every
 * breakpoint centring on its own.
 */
export function focalYFromNormalized(crop: CropRect): number {
  return clamp(Math.round((crop.y + crop.h / 2) * 100), 0, 100);
}

/** Zoom bounds. 1 = exactly covering the frame; 4 = 4× that. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export const clampZoom = (z: number) => clamp(z, MIN_ZOOM, MAX_ZOOM);
