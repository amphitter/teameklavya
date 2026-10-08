"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Highlighter, PenLine, Redo2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DrawStroke } from "@/components/stories/story-layer";

/**
 * Story drawing (Part 9 §19).
 *
 * Freehand ink on the story canvas itself — no separate page, no separate step:
 * the strokes are drawn straight onto the canvas the user is composing, which is
 * what "user can draw directly with finger" has to mean.
 *
 * Strokes are kept as VECTOR points (normalised to the 9:16 canvas), not as a
 * bitmap, so:
 *   · the eraser can remove a stroke cleanly instead of painting background
 *     over it (a bitmap eraser on a transparent overlay leaves nothing to
 *     remove, and on a photo it would smear white);
 *   · undo/redo is exact;
 *   · the published story re-renders the ink crisply at any size (§21).
 *
 * Point capture is throttled by distance, not by time: a stroke only stores a
 * point when the finger has moved ~0.4% of the canvas. A slow, careful line
 * costs a few dozen points instead of hundreds, which keeps the metadata small
 * and the line smooth.
 */

const MIN_POINT_DISTANCE = 0.004;

export type DrawTool = "pen" | "marker" | "highlighter" | "eraser";

const PEN_COLOR = "#ffffff";

export function useStoryInk(initial: DrawStroke[] = []) {
  const [strokes, setStrokes] = useState<DrawStroke[]>(initial);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [color, setColor] = useState(PEN_COLOR);
  const [width, setWidth] = useState(0.012);

  /* Undo/redo as two stacks of whole-stroke-list snapshots. The lists are tiny
     (a stroke is a few hundred numbers), so snapshots are simpler and more
     reliable than inverse operations — and they can never drift out of sync. */
  const past = useRef<DrawStroke[][]>([]);
  const future = useRef<DrawStroke[][]>([]);
  const drawing = useRef<DrawStroke | null>(null);

  const commit = useCallback((next: DrawStroke[]) => {
    setStrokes((prev) => {
      past.current.push(prev);
      future.current = [];
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setStrokes((prev) => {
      const last = past.current.pop();
      if (!last) return prev;
      future.current.push(prev);
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setStrokes((prev) => {
      const next = future.current.pop();
      if (!next) return prev;
      past.current.push(prev);
      return next;
    });
  }, []);

  const clear = useCallback(() => commit([]), [commit]);

  /** Erase every stroke the pointer touches, within the eraser's radius. */
  const eraseAt = useCallback((p: { x: number; y: number }, radius: number) => {
    setStrokes((prev) => {
      const kept = prev.filter((s) => !s.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) <= radius));
      if (kept.length === prev.length) return prev;
      past.current.push(prev);
      future.current = [];
      return kept;
    });
  }, []);

  return {
    strokes,
    setStrokes,
    commit,
    tool,
    setTool,
    color,
    setColor,
    width,
    setWidth,
    undo,
    redo,
    clear,
    eraseAt,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    drawing,
  };
}

/** The palette — a small, deliberate set that works on photos. */
const COLORS = ["#ffffff", "#0b1116", "#ff3b5c", "#ffb300", "#25d366", "#00b8d9", "#7c4dff", "#ff62b0"];

export const DRAW_WIDTHS: { id: string; label: string; value: number }[] = [
  { id: "thin", label: "Thin", value: 0.006 },
  { id: "medium", label: "Medium", value: 0.012 },
  { id: "thick", label: "Thick", value: 0.024 },
];

/**
 * The ink layer that sits over the media while drawing.
 *
 * `touch-action: none` is what stops the canvas from scrolling the page or
 * zooming the viewport mid-stroke (§19 "drawing must remain inside the story
 * canvas", and Part 11's rule that a manipulative surface must not scroll).
 */
export function StoryDrawSurface({
  ink,
  active,
  onDrawEnd,
}: {
  ink: ReturnType<typeof useStoryInk>;
  active: boolean;
  onDrawEnd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<DrawStroke | null>(null);

  useEffect(() => {
    if (!active) setLive(null);
  }, [active]);

  const toCanvas = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  };

  if (!active) return null;

  const finish = () => {
    const stroke = ink.drawing.current;
    ink.drawing.current = null;
    setLive(null);
    if (stroke && stroke.points.length > 1) {
      ink.commit([...ink.strokes, stroke]);
    }
    onDrawEnd?.();
  };

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-20"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toCanvas(e);
        if (ink.tool === "eraser") {
          ink.eraseAt(p, Math.max(0.02, ink.width * 1.4));
          return;
        }
        ink.drawing.current = { mode: ink.tool, color: ink.color, width: ink.width, points: [p] };
        setLive(ink.drawing.current);
      }}
      onPointerMove={(e) => {
        const p = toCanvas(e);
        if (ink.tool === "eraser") {
          if (e.buttons) ink.eraseAt(p, Math.max(0.02, ink.width * 1.4));
          return;
        }
        const stroke = ink.drawing.current;
        if (!stroke) return;
        const last = stroke.points[stroke.points.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_DISTANCE) return;
        stroke.points.push(p);
        setLive({ ...stroke, points: [...stroke.points] });
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      aria-label="Draw on your story"
    >
      {/* Committed strokes */}
      <svg
        viewBox="0 0 1000 1778"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        {/* Only the stroke in progress is painted here. Every COMMITTED stroke
            lives in the story's draw layer and is rendered by StoryLayers, so
            there is exactly one place that draws finished ink — the preview and
            the published story render it through the same component. */}
        {live ? (
          <path
            d={live.points.map((p, j) => `${j === 0 ? "M" : "L"}${(p.x * 1000).toFixed(1)} ${(p.y * 1778).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={live.color}
            strokeWidth={Math.max(0.5, live.width * 1000)}
            strokeLinecap="round"
            strokeOpacity={live.mode === "highlighter" ? 0.42 : 1}
          />
        ) : null}
      </svg>
    </div>
  );
}

/** The draw toolbar: tools, palette, brush size, undo/redo. */
export function StoryDrawToolbar({ ink }: { ink: ReturnType<typeof useStoryInk> }) {
  const tools: { id: DrawTool; icon: typeof PenLine; label: string }[] = [
    { id: "pen", icon: PenLine, label: "Pen" },
    { id: "marker", icon: PenLine, label: "Marker" },
    { id: "highlighter", icon: Highlighter, label: "Highlighter" },
    { id: "eraser", icon: Eraser, label: "Eraser" },
  ];

  return (
    <div className="space-y-2 rounded-2xl bg-black/55 p-2 backdrop-blur-md" role="toolbar" aria-label="Drawing tools">
      <div className="flex items-center gap-1">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => ink.setTool(t.id)}
            aria-pressed={ink.tool === t.id}
            aria-label={t.label}
            className={cn(
              "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-[11px] font-bold transition",
              ink.tool === t.id ? "bg-white text-navy" : "text-white/80 hover:bg-white/10"
            )}
          >
            <t.icon className="h-4 w-4" />
            <span className="hidden xs:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {ink.tool !== "eraser" ? (
        <>
          <div className="flex items-center justify-between gap-1 px-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => ink.setColor(c)}
                aria-label={`Colour ${c}`}
                aria-pressed={ink.color === c}
                className={cn(
                  "h-7 w-7 rounded-full border transition",
                  ink.color === c ? "border-white ring-2 ring-white/70" : "border-white/30"
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            {DRAW_WIDTHS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => ink.setWidth(w.value)}
                aria-pressed={ink.width === w.value}
                aria-label={`${w.label} brush`}
                className={cn(
                  "flex h-9 flex-1 items-center justify-center rounded-lg transition",
                  ink.width === w.value ? "bg-white/20" : "hover:bg-white/10"
                )}
              >
                <span
                  className="rounded-full bg-white"
                  style={{ width: 4 + w.value * 260, height: 4 + w.value * 260 }}
                />
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="px-1 pb-1 text-[11px] text-white/70">Drag over a line to remove it.</p>
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={ink.undo}
          disabled={!ink.canUndo}
          aria-label="Undo"
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold text-white/85 disabled:opacity-35 hover:bg-white/10"
        >
          <Undo2 className="h-4 w-4" /> Undo
        </button>
        <button
          type="button"
          onClick={ink.redo}
          disabled={!ink.canRedo}
          aria-label="Redo"
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold text-white/85 disabled:opacity-35 hover:bg-white/10"
        >
          <Redo2 className="h-4 w-4" /> Redo
        </button>
      </div>
    </div>
  );
}
