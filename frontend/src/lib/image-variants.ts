/**
 * Responsive image variant URLs — the shape rule.
 *
 * Extracted from `OptimizedImage` so it can be tested without a browser. The
 * rule it enforces is small and easy to get wrong, and getting it wrong is
 * invisible until someone notices their own face cropped differently on two
 * devices:
 *
 *   A **fixed box** (width AND height) is a CROP REQUEST. Every entry in its
 *   srcset must therefore ask for the same SHAPE — the height has to scale
 *   with the width. `w_64,h_40`, `w_160,h_40`, `w_400,h_40` are three
 *   different crops of the same photo; a browser on a 1× screen picks the
 *   first, one on a 3× screen picks the second, and the same avatar shows a
 *   different slice of the picture on each.
 *
 *   A **bare width** is a RESIZE — no crop — so nothing needs scaling and no
 *   height is sent.
 *
 * No imports: this module is pure so `tests/image-variants.test.js` can run it
 * in Node against the same source the app ships.
 */

export interface BoxShape {
  width?: number | null;
  height?: number | null;
}

/** A fixed box means "crop to exactly this"; a bare width means "scale to fit". */
export function isFixedBox(box: BoxShape): boolean {
  return Boolean(box.width && box.height);
}

/**
 * The height to request alongside `w`.
 *
 * For a fixed box the shape is preserved at every width, so a 3:1 banner asks
 * for 320×107, 640×213, 1024×341 — never 320×107, 640×107, 1024×107.
 */
export function heightForWidth(w: number, box: BoxShape): number | undefined {
  if (!isFixedBox(box)) {
    return box.height == null ? undefined : (box.height as number);
  }
  const ratio = (box.height as number) / (box.width as number);
  return Math.max(1, Math.round(w * ratio));
}

/**
 * Build a `srcset` from a preset's widths.
 *
 * `encode` turns a (width, height) pair into a URL — injected rather than
 * imported so this stays dependency-free and testable. Returning a falsy URL
 * drops the entry, which is how non-transformable sources (local/legacy
 * uploads) end up with no srcset at all instead of four copies of one URL.
 */
export function buildSrcset(
  widths: number[],
  box: BoxShape,
  encode: (w: number, h?: number) => string | null | undefined
): string | undefined {
  const entries: string[] = [];
  for (const w of widths) {
    const url = encode(w, heightForWidth(w, box));
    if (url) entries.push(`${url} ${w}w`);
  }
  return entries.length ? entries.join(", ") : undefined;
}
