"use client";

import Link from "next/link";
import { MapPin, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Story layers (Part 9 §21) — the overlays a story is made of.
 *
 * ONE renderer, used by the editor canvas, the preview and the viewer. That is
 * the point: "the preview must show the exact final result" is only true if the
 * preview and the published story are the same code, and a second renderer
 * would drift the first time either one changed.
 *
 * ── Geometry ──────────────────────────────────────────────────────────────
 * Everything is normalised to the 9:16 canvas:
 *   x, y       0..1 — the layer's CENTRE, as a fraction of the canvas
 *   scale      multiplier on the layer's natural size
 *   rotation   degrees
 *   size       fraction of the canvas WIDTH (0.07 ≈ a 75px line on 1080)
 *
 * Sizes are expressed in `cqw` (container query units) so the same numbers
 * render correctly on a 320px phone and a 1080px canvas with no measurement, no
 * resize listener and no layout thrash: 1cqw is 1% of the canvas width.
 */

export type DrawStroke = {
  mode: "pen" | "marker" | "highlighter" | "eraser";
  color: string;
  /** Fraction of the canvas width. */
  width: number;
  /** Normalised 0..1 points. */
  points: { x: number; y: number }[];
};

export type StoryLayer = {
  type: "text" | "emoji" | "sticker" | "draw";
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /* text */
  text?: string;
  color?: string;
  size?: number;
  weight?: 400 | 700 | 800;
  align?: "left" | "center" | "right";
  background?: string;
  /* emoji */
  emoji?: string;
  /* sticker */
  kind?: "mention" | "location" | "event" | "hashtag";
  label?: string;
  payload?: {
    username?: string;
    userId?: string;
    eventId?: string;
    slug?: string;
    topic?: string;
  };
  /* draw */
  strokes?: DrawStroke[];
};

/** The drawing surface's coordinate space. Matches 9:16 (1000 × 1777.8). */
export const STORY_VIEWBOX = { w: 1000, h: 1778 };

/** Flatten strokes into SVG paths in the viewBox space. */
export function strokePath(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * STORY_VIEWBOX.w).toFixed(1)} ${(p.y * STORY_VIEWBOX.h).toFixed(1)}`)
    .join(" ");
}

/** One freehand layer, as an SVG the canvas scales without re-rasterising. */
export function DrawLayer({ strokes }: { strokes: DrawStroke[] }) {
  return (
    <svg
      viewBox={`0 0 ${STORY_VIEWBOX.w} ${STORY_VIEWBOX.h}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {strokes.map((s, i) => (
        <path
          key={i}
          d={strokePath(s.points)}
          fill="none"
          stroke={s.color}
          strokeWidth={Math.max(0.5, s.width * STORY_VIEWBOX.w)}
          strokeLinecap="round"
          strokeLinejoin="round"
          /* Highlighter reads as a marker rather than a pen: wider, translucent,
             and multiplied over the photo the way a real highlighter behaves. */
          strokeOpacity={s.mode === "highlighter" ? 0.42 : s.mode === "marker" ? 0.92 : 1}
          style={s.mode === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
        />
      ))}
    </svg>
  );
}

/**
 * A sticker's action — the thing that makes it more than a picture.
 *
 * Where EventHub already has a destination, the sticker links to it: a mention
 * opens the profile, an event sticker opens the event, a hashtag opens the
 * topic. A location is a label — EventHub has no place pages, and inventing a
 * dead link would be worse than an honest label.
 */
function stickerHref(layer: StoryLayer): string | null {
  const p = layer.payload || {};
  if (layer.kind === "mention" && (p.username || p.userId)) return `/profile/${p.username || p.userId}`;
  if (layer.kind === "event" && p.slug) return `/events/${p.slug}`;
  if (layer.kind === "hashtag" && p.topic) return `/explore?topic=${encodeURIComponent(p.topic)}`;
  return null;
}

/**
 * One layer.
 *
 * `interactive` is false in the viewer: a story should not swallow a tap meant
 * for "next story", except where a sticker genuinely has somewhere to go (a
 * link), which is why links are rendered only when there is a destination.
 *
 * `static` renders the layer WITHOUT positioning it, so the editor can place it
 * inside its own gesture-bearing box. The layer's own appearance — font, colour,
 * plate, size in cqw — still comes from here, which is what keeps the editor,
 * the preview and the viewer showing the same thing.
 */
export function StoryLayerView({
  layer,
  interactive = true,
  static: isStatic = false,
}: {
  layer: StoryLayer;
  interactive?: boolean;
  static?: boolean;
}) {
  const transform = `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${layer.scale})`;
  const anchor = isStatic ? {} : { left: `${layer.x * 100}%`, top: `${layer.y * 100}%`, transform };
  const place = isStatic ? "" : "absolute";

  if (layer.type === "draw") {
    return <DrawLayer strokes={layer.strokes || []} />;
  }

  if (layer.type === "emoji") {
    return (
      <span
        className={cn(place, "select-none leading-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]")}
        style={{ ...anchor, fontSize: `calc(${(layer.size || 0.14) * 100}cqw)` }}
      >
        {layer.emoji}
      </span>
    );
  }

  if (layer.type === "text") {
    const plate = layer.background && layer.background !== "transparent";
    return (
      <span
        className={cn(place, "block max-w-[86%] break-words text-center leading-tight [text-wrap:balance]")}
        style={{
          ...anchor,
          fontSize: `calc(${(layer.size || 0.07) * 100}cqw)`,
          color: layer.color || "#ffffff",
          fontWeight: layer.weight || 700,
          textAlign: layer.align || "center",
          textShadow: plate ? undefined : "0 2px 12px rgba(0,0,0,0.6)",
          ...(plate
            ? {
                background: layer.background,
                padding: `calc(${(layer.size || 0.07) * 100}cqw * 0.35) calc(${(layer.size || 0.07) * 100}cqw * 0.6)`,
                borderRadius: `calc(${(layer.size || 0.07) * 100}cqw * 0.5)`,
              }
            : {}),
        }}
      >
        {layer.text}
      </span>
    );
  }

  /* sticker */
  const href = stickerHref(layer);
  const inner = (
    <span
      className="flex max-w-[16rem] items-center gap-1.5 rounded-full bg-white/92 px-3 py-1.5 text-[13px] font-bold text-navy shadow-lg backdrop-blur-sm"
      style={{ fontSize: "calc(3.4cqw)" }}
    >
      {layer.kind === "location" ? <MapPin className="h-3.5 w-3.5 shrink-0" /> : <Sparkles className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{layer.label}</span>
    </span>
  );

  return (
    <span className={cn(place)} style={anchor}>
      {href && interactive ? (
        /* `pointer-events-auto` re-enables ONLY this sticker's own box: the
           layer container is deliberately inert so a tap anywhere else advances
           the story. A sticker with a real destination is tappable; everything
           else stays out of the way of the next/previous zones. */
        <Link href={href} onClick={(e) => e.stopPropagation()} className="pointer-events-auto block">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </span>
  );
}

/** Every layer of a story, in z-order (draw layers first, then the rest). */
export function StoryLayers({ layers, interactive = true }: { layers?: StoryLayer[] | null; interactive?: boolean }) {
  if (!Array.isArray(layers) || layers.length === 0) return null;
  return (
    <>
      {layers.map((l, i) => (
        <StoryLayerView key={i} layer={l} interactive={interactive} />
      ))}
    </>
  );
}
