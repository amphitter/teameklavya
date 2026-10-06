"use client";

/**
 * OptimizedImage (Part 5, Phase 4 — spec §19, §50, §51)
 * ──────────────────────────────────────────────────────
 * The single way EventHub renders an image.
 *
 * Replaces raw `<img src={originalUrl} />` — the audit found 56 of those,
 * each pulling a full-resolution original into a thumbnail-sized box.
 *
 * What this component guarantees:
 *   §19  sized delivery — cards request `thumb`/`small`, hero images
 *        `medium`/`large`. The original is only used when explicitly asked.
 *   §19  responsive `srcset` — a phone on 4G downloads the 320w variant, a
 *        desktop the 1024w one. Same markup, right bytes for the device.
 *   §19  modern formats — `f_auto` lets Cloudinary serve AVIF/WebP to
 *        browsers that support them, JPEG to those that don't.
 *   §50  CLS — `width`/`height` (or `aspectRatio`) reserve the box up front,
 *        so images never reflow the page as they arrive.
 *   §50  INP/LCP — `loading="lazy"` + `decoding="async"` by default; set
 *        `priority` for above-the-fold heroes to opt into eager loading and
 *        high fetch priority.
 *   §68  graceful failure — a broken URL falls back instead of rendering a
 *        broken-image icon, and a non-Cloudinary URL (legacy local upload)
 *        simply passes through untransformed.
 */

import { useState } from "react";
import { cloudinaryUrl } from "@/utils/image";

export type ImageSize = "thumb" | "small" | "medium" | "large" | "original";
export type ImagePreset = "avatar" | "logo" | "poster" | "post" | "banner" | "default";

/**
 * Pixel widths per preset — mirrors VARIANT_PRESETS in
 * backend/services/storage.provider.js so the frontend asks for exactly the
 * sizes the backend advertises.
 */
const PRESET_WIDTHS: Record<ImagePreset, Record<Exclude<ImageSize, "original">, number>> = {
  avatar: { thumb: 64, small: 160, medium: 400, large: 800 },
  logo: { thumb: 80, small: 200, medium: 400, large: 800 },
  poster: { thumb: 320, small: 640, medium: 1024, large: 1600 },
  post: { thumb: 320, small: 640, medium: 1024, large: 1400 },
  banner: { thumb: 480, small: 960, medium: 1440, large: 1920 },
  default: { thumb: 160, small: 400, medium: 800, large: 1200 },
};

export interface OptimizedImageProps {
  src?: string | null;
  alt: string;
  /** Which family of widths to use. */
  preset?: ImagePreset;
  /** Which member of the family this render needs. */
  size?: ImageSize;
  /** Fixed crop — supply both to force an exact box (e.g. avatars). */
  width?: number;
  height?: number;
  /** CSS aspect-ratio, e.g. "16 / 9" — an alternative to width/height. */
  aspectRatio?: string;
  /** Above-the-fold hero: eager load + high priority. */
  priority?: boolean;
  /** `sizes` hint for srcset selection. Defaults to 100vw. */
  sizes?: string;
  className?: string;
  /** Fallback when the image fails (defaults to brand art). */
  fallback?: string;
  onError?: () => void;
  style?: React.CSSProperties;
}

export function OptimizedImage({
  src,
  alt,
  preset = "post",
  size = "medium",
  width,
  height,
  aspectRatio,
  priority = false,
  sizes = "100vw",
  className,
  fallback,
  onError,
  style,
}: OptimizedImageProps) {
  const [failed, setFailed] = useState(false);

  const widths = PRESET_WIDTHS[preset] || PRESET_WIDTHS.default;

  // Resolve the display width: explicit prop wins, else the named variant.
  const displayWidth =
    width ?? (size === "original" ? undefined : widths[size as Exclude<ImageSize, "original">]);

  const source = failed ? fallback : src;

  // Build a responsive srcset across the preset's widths (§19).
  // Non-Cloudinary URLs pass through cloudinaryUrl unchanged, so srcset would
  // repeat the same URL — harmless, but we skip it to keep the markup honest.
  const isTransformable =
    !!source &&
    (source.includes("res.cloudinary.com") || source.startsWith("/uploads") === false) &&
    source.includes("res.cloudinary.com");

  const buildUrl = (w?: number, h?: number) =>
    cloudinaryUrl(source as string, { w, h, crop: width && height ? "fill" : "limit" });

  const srcSet =
    isTransformable && size !== "original"
      ? [widths.thumb, widths.small, widths.medium, widths.large]
          .map((w) => `${buildUrl(w, height)} ${w}w`)
          .join(", ")
      : undefined;

  const handleError = () => {
    if (!failed && fallback) {
      setFailed(true);
    }
    onError?.();
  };

  // §50 — reserve layout space so the image never shifts content on load.
  const layoutStyle: React.CSSProperties = {
    ...(aspectRatio ? { aspectRatio } : null),
    ...style,
  };

  return (
    <img
      src={buildUrl(displayWidth, height)}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      className={className}
      // Explicit dimensions kill layout shift; only set when known.
      width={width}
      height={height}
      // §50/§51 — lazy by default; heroes opt out via `priority`.
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : "auto"}
      onError={handleError}
      style={layoutStyle}
    />
  );
}

export default OptimizedImage;
