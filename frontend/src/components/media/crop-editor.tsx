"use client";

/**
 * CropEditor (§5, §8, §24) — the profile-photo editor.
 *
 *   ┌─────────────────┐
 *   │   ◯ image       │   ← the frame is the crop; what is inside it is saved
 *   │  [ crop area ]  │
 *   └─────────────────┘
 *   Zoom ──────●──────
 *   [Cancel]       [Use photo]
 *
 * Gestures, all one code path via pointer events:
 *   drag        pan          (mouse, touch, pen)
 *   pinch       zoom         (two fingers)
 *   wheel       zoom         (desktop trackpads and mice)
 *   double-tap  reset        (the gesture people try when they get lost)
 *   arrows/+/-  pan and zoom (a drag is not reachable by keyboard)
 *
 * `touch-action: none` on the frame is load-bearing: without it the browser
 * claims the gesture for scrolling and the crop jumps around under the finger
 * (§24 — "do not let the browser page scroll while manipulating the canvas").
 *
 * Only the frame is saved. Everything outside it is dimmed, not discarded
 * until the user confirms — and Cancel costs nothing, because nothing has been
 * uploaded or written yet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampOffset,
  clampZoom,
  coverScale,
  focalYFromNormalized,
  normalizedFromSourceRect,
  sourceRectFromView,
  viewFromNormalized,
  type CropRect,
} from "@/lib/crop";
import {
  loadImage,
  renderCanonical,
  type LoadedImage,
} from "@/utils/canonical-image";

export interface CropEditorResult {
  /** The canonical, cropped, metadata-free file — this is what gets uploaded. */
  file: File;
  /** Where the crop sits in the ORIGINAL, so the editor can re-open on it. */
  crop: CropRect;
  /** Vertical focal point (0–100) for wide assets. */
  focalY: number;
  width: number;
  height: number;
}

export interface CropEditorProps {
  /** A freshly picked file, or an existing URL for the re-crop flow. */
  src: File | string;
  /** Frame shape. 1 = square avatar; 3 = 3:1 cover. */
  aspect?: number;
  /** Output pixels. The long edge wins if the aspect says otherwise. */
  outputWidth?: number;
  outputHeight?: number;
  /** Show the circular avatar mask over the frame. */
  circular?: boolean;
  title?: string;
  confirmLabel?: string;
  /** An existing crop to start from (re-editing a stored avatar). */
  initialCrop?: CropRect | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: CropEditorResult) => void;
}

const FRAME_MAX = 420; // px, the frame never grows past this on desktop

export function CropEditor({
  src,
  aspect = 1,
  outputWidth = 512,
  outputHeight = 512,
  circular = false,
  title = "Edit photo",
  confirmLabel = "Use photo",
  initialCrop = null,
  busy = false,
  onCancel,
  onConfirm,
}: CropEditorProps) {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [working, setWorking] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  /** Live pinch state — kept in a ref so gestures never wait on a re-render. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const lastTap = useRef(0);
  const dragStart = useRef<{ x: number; y: number; offset: { x: number; y: number } } | null>(null);

  /* ── Load ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    let handle: LoadedImage | null = null;
    setLoaded(null);
    setError(null);
    loadImage(src)
      .then((l) => {
        if (!alive) {
          l.revoke();
          return;
        }
        handle = l;
        setLoaded(l);
      })
      .catch((e) => alive && setError(e?.message || "Couldn't open that image."));
    return () => {
      alive = false;
      handle?.revoke();
    };
  }, [src]);

  /* ── Frame size ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const measure = () => {
      const el = frameRef.current;
      if (!el) return;
      const w = el.clientWidth;
      setFrame({ w, h: w / aspect });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [aspect, loaded]);

  /** Re-open on the stored crop once both the image and the frame are known. */
  useEffect(() => {
    if (!loaded || !frame.w || !initialCrop) return;
    const view = viewFromNormalized(initialCrop, loaded.width, loaded.height, frame.w, frame.h);
    setZoom(view.zoom);
    setOffset(view.offset);
  }, [loaded, frame.w, frame.h, initialCrop]);

  const baseScale = useMemo(
    () => (loaded ? coverScale(loaded.width, loaded.height, frame.w || 1, frame.h || 1) : 1),
    [loaded, frame.w, frame.h]
  );

  /** Apply zoom + pan together, always clamped to a legal view. */
  const apply = useCallback(
    (nextZoom: number, nextOffset: { x: number; y: number }) => {
      if (!loaded || !frame.w) return;
      const z = clampZoom(nextZoom);
      const eff = baseScale * z;
      setZoom(z);
      setOffset(clampOffset(nextOffset, loaded.width, loaded.height, eff, frame.w, frame.h));
    },
    [loaded, frame.w, frame.h, baseScale]
  );

  /** The current view in source pixels — used for the preview and the export. */
  const sourceRect = useMemo(() => {
    if (!loaded || !frame.w) return null;
    return sourceRectFromView({
      iw: loaded.width,
      ih: loaded.height,
      effectiveScale: baseScale * zoom,
      offset,
      boxW: frame.w,
      boxH: frame.h,
    });
  }, [loaded, frame.w, frame.h, baseScale, zoom, offset]);

  /* ── Gestures ───────────────────────────────────────────────────────────── */

  const panBy = (dx: number, dy: number) => apply(zoom, { x: offset.x + dx, y: offset.y + dy });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, offset };

      // Double tap / double click resets — cheaper than finding the slider.
      const now = Date.now();
      if (now - lastTap.current < 300) {
        apply(1, { x: 0, y: 0 });
        lastTap.current = 0;
        dragStart.current = null;
        return;
      }
      lastTap.current = now;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      dragStart.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart.current.distance > 0) {
        apply(pinchStart.current.zoom * (distance / pinchStart.current.distance), offset);
      }
      return;
    }

    const start = dragStart.current;
    if (start) {
      panBy(e.clientX - start.x, e.clientY - start.y);
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) dragStart.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    // Non-passive so the page doesn't scroll behind the editor.
    e.preventDefault();
    apply(zoom * Math.exp(-e.deltaY * 0.0015), offset);
  };

  /**
   * Keyboard parity: the frame is focusable and the arrows pan, +/- zoom.
   * A pointer-only editor is unusable for anyone without a mouse or a finger.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 12;
    const map: Record<string, () => void> = {
      ArrowLeft: () => panBy(-step, 0),
      ArrowRight: () => panBy(step, 0),
      ArrowUp: () => panBy(0, -step),
      ArrowDown: () => panBy(0, step),
      "+": () => apply(zoom * 1.1, offset),
      "=": () => apply(zoom * 1.1, offset),
      "-": () => apply(zoom / 1.1, offset),
      "0": () => apply(1, { x: 0, y: 0 }),
      Escape: onCancel,
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  const confirm = async () => {
    if (!loaded || !sourceRect || working || busy) return;
    setWorking(true);
    try {
      const crop = normalizedFromSourceRect(sourceRect, loaded.width, loaded.height);
      const file = await renderCanonical(loaded, crop, outputWidth, outputHeight, {
        fileName: circular ? "avatar.jpg" : "cover.jpg",
      });
      onConfirm({ file, crop, focalY: focalYFromNormalized(crop), width: outputWidth, height: outputHeight });
    } catch (e: any) {
      setError(e?.message || "Couldn't process that image.");
    } finally {
      setWorking(false);
    }
  };

  /* ── Preview transform ──────────────────────────────────────────────────── */
  // The same maths as the export, applied as a CSS transform, so what the user
  // frames is what the canvas will draw.
  const previewStyle = useMemo(() => {
    if (!loaded || !frame.w) return undefined;
    const eff = baseScale * zoom;
    const dw = loaded.width * eff;
    const dh = loaded.height * eff;
    return {
      width: dw,
      height: dh,
      left: (frame.w - dw) / 2 + offset.x,
      top: (frame.h - dh) / 2 + offset.y,
    };
  }, [loaded, frame.w, frame.h, baseScale, zoom, offset]);

  const maxFrame = Math.min(FRAME_MAX, 520);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[90] flex flex-col bg-black/85 backdrop-blur-[2px]"
    >
      <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-white">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
        >
          <X className="h-4 w-4" /> Cancel
        </button>
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={confirm}
          disabled={!loaded || working || busy}
          className="flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {confirmLabel}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4 pb-8">
        {error ? (
          <p className="max-w-xs text-center text-sm text-white/90">{error}</p>
        ) : !loaded ? (
          <Loader2 className="h-6 w-6 animate-spin text-white/80" />
        ) : (
          <>
            <div
              ref={frameRef}
              tabIndex={0}
              /* touch-action:none is what stops the page scrolling under the
                 finger while the user is positioning their face (§24). */
              className={cn(
                "relative touch-none select-none overflow-hidden bg-black/40 outline-none",
                circular ? "rounded-full" : "rounded-2xl",
                "ring-2 ring-white/70",
                "cursor-grab active:cursor-grabbing"
              )}
              style={{
                width: "100%",
                maxWidth: aspect >= 1 ? `${maxFrame}px` : "100%",
                aspectRatio: String(aspect),
                maxHeight: "62vh",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onWheel={onWheel}
              aria-label="Drag to reposition, pinch or use the slider to zoom"
            >
              {previewStyle ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={loaded.image.src}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute max-w-none origin-top-left"
                  style={{ width: previewStyle.width, height: previewStyle.height, left: previewStyle.left, top: previewStyle.top }}
                />
              ) : null}

              {/* Dim everything outside the frame so the crop reads clearly.
                  Pointer-events off: the dimmer must never eat a drag. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                  borderRadius: circular ? "9999px" : "1rem",
                }}
              />
            </div>

            <div className="flex w-full max-w-sm items-center gap-3 px-1 text-white">
              <ZoomOut className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => apply(Number(e.target.value), offset)}
                aria-label="Zoom"
                className="h-1.5 flex-1 accent-white"
              />
              <ZoomIn className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              <button
                type="button"
                onClick={() => apply(1, { x: 0, y: 0 })}
                className="flex h-9 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-white/90 transition hover:bg-white/10"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </div>

            <p className="max-w-xs text-center text-[11px] leading-relaxed text-white/70">
              Drag to move · pinch or slide to zoom · double-tap to reset
            </p>
          </>
        )}
      </div>
    </div>
  );
}
