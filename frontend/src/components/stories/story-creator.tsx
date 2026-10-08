"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Camera,
  Check,
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Share2,
  Smile,
  Sparkles,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { compressFor } from "@/utils/compress-image";
import { queryClient } from "@/lib/query";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { PICKABLE_STORY_CATEGORIES, storyCategoryIcon, storyCategoryLabel } from "@/lib/story-categories";
import {
  StoryLayerView,
  StoryLayers,
  type StoryLayer,
} from "@/components/stories/story-layer";
import { StoryDrawSurface, StoryDrawToolbar, useStoryInk } from "@/components/stories/story-draw";
import { StoryEmojiTray, StoryStickerSheet, type StickerChoice } from "@/components/stories/story-sticker-sheet";

/**
 * STORY CREATOR (Part 9 §14–§23).
 *
 * ── Why this replaces the old composer ────────────────────────────────────
 * The previous version was a form: buttons, then a text input, then a caption
 * input, then a Publish button — with the "text overlay" pinned to the centre of
 * the frame. It could not do the two things a story editor exists for: writing
 * anywhere, and drawing. There was no preview either, so what you published was
 * whatever the server happened to render.
 *
 * ── What it is now ────────────────────────────────────────────────────────
 * A full-screen canvas where every overlay is a LAYER with its own transform:
 * drag to move, pinch to scale, two fingers to rotate, tap to select, and a
 * delete control on the selection. Text is written with the real keyboard and
 * lands where you put it. Drawing happens straight on the canvas with pen,
 * marker, highlighter and an eraser that removes strokes rather than painting
 * over them.
 *
 * The published story is rendered by `StoryLayerView` — the SAME component as
 * the editor and the preview — so "the preview shows the exact final result" is
 * structural rather than a promise.
 *
 * ── Phone only (§14) ─────────────────────────────────────────────────────
 * Composing a 9:16 story with two-finger gestures is a phone interaction. On a
 * desktop this shows an honest message instead of a crippled approximation
 * (the previous version happily opened a desktop dialog whose pan gesture
 * fought the mouse). Detection is live (`matchMedia`), so rotating a tablet or
 * resizing a window re-evaluates it.
 *
 * The 24-hour lifetime, expiry and archive are already server-side
 * (`expiresAt`, `archivedAt`) — nothing here fakes a timer.
 */

type Stage = "pick" | "edit" | "preview" | "publishing";

const CANVAS_RATIO = 9 / 16;
const MIN_LAYER_SCALE = 0.3;
const MAX_LAYER_SCALE = 6;

/** Solid colours and gradients that read well behind text (user content, not chrome). */
const BACKGROUNDS: { id: string; label: string; css: string }[] = [
  { id: "sunset", label: "Sunset", css: "linear-gradient(160deg,#ff6a3d,#ff2d78 55%,#7b2ff7)" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(160deg,#00c2ff,#0057b8 60%,#0b1116)" },
  { id: "mint", label: "Mint", css: "linear-gradient(160deg,#2af598,#009efd)" },
  { id: "grape", label: "Grape", css: "linear-gradient(160deg,#8e2de2,#4a00e0)" },
  { id: "ink", label: "Ink", css: "linear-gradient(160deg,#232526,#0b1116)" },
  { id: "paper", label: "Paper", css: "linear-gradient(160deg,#f7f7f7,#d9dee5)" },
];

/** Fit / Fill for non-9:16 media (§17) — never an aggressive auto-crop. */
type FitMode = "fill" | "fit";

/** Gesture bookkeeping: one pointer drags, two pointers scale + rotate. */
interface GestureState {
  mode: "layer" | "media";
  index?: number;
  startDistance: number;
  startAngle: number;
  startMid: { x: number; y: number };
  layer?: StoryLayer;
  media?: { scale: number; x: number; y: number };
}

export function StoryCreator({
  open,
  onClose,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  onPublished?: () => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [isPhone, setIsPhone] = useState(true);

  /* Media */
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isVideo, setIsVideo] = useState(false);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [fit, setFit] = useState<FitMode>("fill");
  const [mediaTransform, setMediaTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [background, setBackground] = useState(BACKGROUNDS[0].css);

  /* Layers */
  const [layers, setLayers] = useState<StoryLayer[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<"none" | "draw" | "emoji" | "text">("none");

  /* Text editing: null = closed, { index } = editing an existing layer */
  const [textDraft, setTextDraft] = useState<{ value: string; index: number | null; color: string; weight: 400 | 700 | 800; align: "left" | "center" | "right"; plate: boolean } | null>(null);

  const [stickerOpen, setStickerOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [caption, setCaption] = useState("");
  const [uploadPct, setUploadPct] = useState(0);

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<GestureState | null>(null);
  const ink = useStoryInk();

  const draftKey = "eventhub:story-draft:v1";
  const [hasDraft, setHasDraft] = useState(false);

  /* ── Phone detection (§14) ────────────────────────────────────────────
     A coarse pointer AND a phone-sized viewport. Either alone is wrong: a
     touchscreen laptop is coarse but wide, and a narrow desktop window is
     narrow but mouse-driven. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const narrow = window.matchMedia("(max-width: 1023px)").matches;
      setIsPhone(coarse && narrow);
    };
    check();
    const mq = window.matchMedia("(max-width: 1023px)");
    mq.addEventListener("change", check);
    return () => mq.removeEventListener("change", check);
  }, []);

  /* ── Committed ink lives in the story's layers ────────────────────────
     The drawing tool owns its own undo history; this mirrors the finished
     strokes into the layer list, so the preview, the publish payload and the
     viewer all read ONE description of the story. */
  useEffect(() => {
    setLayers((prev) => {
      const without = prev.filter((l) => l.type !== "draw");
      if (!ink.strokes.length) return without.length === prev.length ? prev : without;
      const drawLayer: StoryLayer = { type: "draw", x: 0, y: 0, scale: 1, rotation: 0, strokes: ink.strokes };
      return [...without, drawLayer];
    });
  }, [ink.strokes]);

  /* ── Draft (§16/§22) — layers, caption and category, so an interrupted
     story is not lost. Stored locally per browser: a draft is not published
     content and has no business on the server until it is shared. */
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return setHasDraft(false);
      const d = JSON.parse(raw);
      setHasDraft(Array.isArray(d?.layers) && d.layers.length > 0);
    } catch {
      setHasDraft(false);
    }
  }, [open, draftKey]);

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ layers, caption, category, background, savedAt: Date.now() })
      );
      toast.success("Draft saved");
    } catch {
      toast.error("Couldn't save the draft on this device");
    }
  }, [draftKey, layers, caption, category, background]);

  const resumeDraft = useCallback(() => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (!d) return;
      setLayers(Array.isArray(d.layers) ? d.layers : []);
      setCaption(d.caption || "");
      setCategory(d.category || "");
      setBackground(d.background || BACKGROUNDS[0].css);
      setStage("edit");
    } catch {
      toast.error("That draft couldn't be read");
    }
  }, [draftKey]);

  const reset = useCallback(() => {
    setStage("pick");
    setFile(null);
    setPreviewUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return "";
    });
    setIsVideo(false);
    setNatural({ w: 0, h: 0 });
    setFit("fill");
    setMediaTransform({ scale: 1, x: 0, y: 0 });
    setLayers([]);
    setSelected(null);
    setTool("none");
    setTextDraft(null);
    setCategory("");
    setCaption("");
    setUploadPct(0);
    ink.setStrokes([]);
  }, [ink]);

  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !textDraft) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, textDraft]);

  const take = useCallback(
    (f: File) => {
      if (!f) return;
      setIsVideo(f.type.startsWith("video/"));
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
      setMediaTransform({ scale: 1, x: 0, y: 0 });
      setFit("fill");
      setStage("edit");
    },
    []
  );

  /* ── Gestures ─────────────────────────────────────────────────────────
     One implementation for both the media and the selected layer, because the
     maths is identical: a pinch is a distance ratio, a rotate is an angle
     delta, and a drag is a midpoint delta. Layer deltas are converted into the
     canvas's normalised space so a zoom/pan cannot drift the layer off-frame. */
  const beginGesture = (e: React.PointerEvent, target: { mode: "layer" | "media"; index?: number }) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const mid = pts.length > 1
      ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      : { x: e.clientX, y: e.clientY };
    gesture.current = {
      mode: target.mode,
      index: target.index,
      startDistance: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      startAngle: pts.length > 1 ? Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) : 0,
      startMid: mid,
      layer: target.mode === "layer" && typeof target.index === "number" ? { ...layers[target.index] } : undefined,
      media: target.mode === "media" ? { ...mediaTransform } : undefined,
    };
  };

  const moveGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    const box = canvasRef.current?.getBoundingClientRect();
    if (!g || !box) return;
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const mid = pts.length > 1
      ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      : { x: e.clientX, y: e.clientY };

    if (g.mode === "media") {
      const scale = pts.length > 1 && g.startDistance > 0
        ? Math.min(4, Math.max(0.5, (g.media!.scale * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g.startDistance))
        : g.media!.scale;
      setMediaTransform({
        scale,
        x: g.media!.x + (mid.x - g.startMid.x) / box.width,
        y: g.media!.y + (mid.y - g.startMid.y) / box.height,
      });
      return;
    }

    const i = g.index!;
    const base = g.layer!;
    setLayers((prev) => {
      const next = [...prev];
      const cur = next[i];
      if (!cur) return prev;
      let scale = base.scale;
      let rotation = base.rotation;
      if (pts.length > 1 && g.startDistance > 0) {
        scale = Math.min(MAX_LAYER_SCALE, Math.max(MIN_LAYER_SCALE, (base.scale * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g.startDistance));
        const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
        rotation = base.rotation + ((angle - g.startAngle) * 180) / Math.PI;
      }
      next[i] = {
        ...cur,
        x: Math.min(1.2, Math.max(-0.2, base.x + (mid.x - g.startMid.x) / box.width)),
        y: Math.min(1.2, Math.max(-0.2, base.y + (mid.y - g.startMid.y) / box.height)),
        scale,
        rotation,
      };
      return next;
    });
  };

  const endGesture = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    else {
      // A finger lifted mid-gesture: re-baseline from the remaining pointer so
      // the layer does not jump when the pinch becomes a drag.
      const [only] = [...pointers.current.values()];
      const g = gesture.current;
      if (g && only) {
        g.startMid = only;
        g.startDistance = 0;
        g.startAngle = 0;
        if (g.mode === "layer" && typeof g.index === "number") g.layer = { ...layers[g.index] };
        if (g.mode === "media") g.media = { ...mediaTransform };
      }
    }
  };

  /* ── Layers ─────────────────────────────────────────────────────────── */

  const addLayer = (layer: StoryLayer) => {
    setLayers((prev) => {
      const next = [...prev, layer];
      setSelected(next.length - 1);
      return next;
    });
    setTool("none");
  };

  const updateLayer = (i: number, patch: Partial<StoryLayer>) =>
    setLayers((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const removeLayer = (i: number) => {
    setLayers((prev) => prev.filter((_, idx) => idx !== i));
    setSelected(null);
  };

  const commitText = () => {
    if (!textDraft) return;
    const value = textDraft.value.trim();
    if (!value) {
      setTextDraft(null);
      return;
    }
    const patch: StoryLayer = {
      type: "text",
      x: 0.5,
      y: textDraft.index === null ? 0.45 : layers[textDraft.index]?.x ?? 0.5,
      scale: textDraft.index === null ? 1 : layers[textDraft.index]?.scale ?? 1,
      rotation: textDraft.index === null ? 0 : layers[textDraft.index]?.rotation ?? 0,
      text: value,
      color: textDraft.color,
      size: 0.075,
      weight: textDraft.weight,
      align: textDraft.align,
      background: textDraft.plate ? "rgba(0,0,0,0.55)" : "transparent",
    };
    if (textDraft.index === null) addLayer(patch);
    else {
      updateLayer(textDraft.index, patch);
      setSelected(textDraft.index);
    }
    setTextDraft(null);
  };

  /* ── Publish (§23) ────────────────────────────────────────────────────
     A story needs media. A text-only story gets one honestly: its chosen
     background is rendered to a 1080×1920 PNG and uploaded like any photo, so
     every existing consumer (rail, viewer, archive) works unchanged and the
     server never sees a story without a picture. */
  const renderBackgroundToFile = async (): Promise<File> => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d")!;
    if (background.startsWith("linear-gradient")) {
      const stops = background.match(/#[0-9a-f]{3,8}/gi) || ["#0b1116", "#0b1116"];
      const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
      stops.forEach((c, i) => grad.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = background;
    }
    ctx.fillRect(0, 0, 1080, 1920);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
    return new File([blob], "story-background.png", { type: "image/png" });
  };

  const publish = async () => {
    if (stage === "publishing") return;
    setStage("publishing");
    setUploadPct(10);
    try {
      let upload: File;
      if (file) {
        const { file: compressed } = await compressFor(file, "post");
        upload = compressed;
      } else {
        upload = await renderBackgroundToFile();
      }
      const fd = new FormData();
      fd.append("file", upload, upload.name || "story.jpg");
      const up = await api.post("/upload/image?folder=stories", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (e.total) setUploadPct(10 + Math.round((e.loaded / e.total) * 70));
        },
      });
      const url = up.data?.url;
      if (!url) throw new Error("Upload failed");
      setUploadPct(85);

      /* Mentions become real user tags: the sticker carries the id, the story
         stores it, and the profile link in the viewer is genuinely that user. */
      const mentions = layers
        .filter((l) => l.type === "sticker" && l.kind === "mention" && l.payload?.userId)
        .map((l) => l.payload!.userId);

      await api.post("/stories", {
        media: {
          url,
          publicId: up.data?.publicId || "",
          type: isVideo ? "video" : "image",
          width: isVideo ? natural.w : 1080,
          height: isVideo ? natural.h : 1920,
        },
        caption: caption.slice(0, 200),
        category,
        layers,
        mentions: Array.from(new Set(mentions)).slice(0, 20),
      });

      setUploadPct(100);
      queryClient.invalidateQueries(["/stories"]);
      queryClient.invalidateQueries(["/stories/categories"]);
      queryClient.invalidateQueries(["/stories/archive"]);
      try {
        localStorage.removeItem(draftKey);
        setHasDraft(false);
      } catch {
        /* a draft we cannot clear is not worth failing a published story over */
      }
      toast.success("Story published — live for 24 hours");
      onPublished?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Couldn't publish that story — please try again");
      setStage("preview");
      setUploadPct(0);
    }
  };

  const canvasBox = (
    <div
      ref={canvasRef}
      /* The canvas is a container so every layer's size can be expressed in
         `cqw` — 1% of the canvas width — which is what makes one set of
         normalised numbers render identically here, in the preview and in a
         follower's viewer. */
      className="relative select-none overflow-hidden"
      style={{
        aspectRatio: "9 / 16",
        maxHeight: "100%",
        width: "auto",
        maxWidth: "100%",
        height: "100%",
        margin: "0 auto",
        containerType: "inline-size",
        background: file ? "#000" : background,
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        if (tool === "draw") return; // the ink surface owns the pointer
        const hitLayer = (e.target as HTMLElement).closest?.("[data-layer]");
        if (hitLayer) return; // the layer's own handler starts it
        setSelected(null);
        beginGesture(e, { mode: "media" });
      }}
      onPointerMove={(e) => {
        if (tool === "draw") return;
        moveGesture(e);
      }}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      {/* Media, positioned by the user (§17) — never auto-cropped. */}
      {file ? (
        isVideo ? (
          <video
            src={previewUrl}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{
              objectFit: fit === "fill" ? "cover" : "contain",
              transform: `translate(${mediaTransform.x * 100}%, ${mediaTransform.y * 100}%) scale(${mediaTransform.scale})`,
            }}
            autoPlay
            muted
            loop
            playsInline
            onLoadedMetadata={(e) => setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{
              objectFit: fit === "fill" ? "cover" : "contain",
              transform: `translate(${mediaTransform.x * 100}%, ${mediaTransform.y * 100}%) scale(${mediaTransform.scale})`,
            }}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
        )
      ) : null}

      {/* Committed layers — the same renderer as the viewer. */}
      <div className="pointer-events-none absolute inset-0">
        <StoryLayers layers={layers.filter((l) => l.type === "draw")} />
      </div>

      {/* Editable layers: each in its own gesture-bearing box. */}
      {layers.map((l, i) =>
        l.type === "draw" ? null : (
          <div
            key={i}
            data-layer={i}
            className="absolute left-1/2 top-1/2 cursor-move"
            style={{
              transform: `translate(-50%,-50%) rotate(${l.rotation}deg) scale(${l.scale})`,
              left: `${l.x * 100}%`,
              top: `${l.y * 100}%`,
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              if (tool === "draw") return;
              e.stopPropagation();
              setSelected(i);
              beginGesture(e, { mode: "layer", index: i });
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (selected === i) moveGesture(e);
            }}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            <div
              className={cn(
                "relative rounded-md",
                selected === i && "outline outline-2 outline-dashed outline-white/90"
              )}
            >
              <StoryLayerView layer={{ ...l, x: 0.5, y: 0.5, scale: 1, rotation: 0 }} static />
            </div>
            {selected === i ? (
              <div className="absolute -top-11 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/75 px-1 py-1 backdrop-blur">
                {l.type === "text" ? (
                  <button
                    type="button"
                    aria-label="Edit text"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() =>
                      setTextDraft({
                        value: l.text || "",
                        index: i,
                        color: l.color || "#ffffff",
                        weight: (l.weight as 400 | 700 | 800) || 700,
                        align: (l.align as "left" | "center" | "right") || "center",
                        plate: Boolean(l.background && l.background !== "transparent"),
                      })
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/15"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Delete layer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => removeLayer(i)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/15"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        )
      )}

      <StoryDrawSurface ink={ink} active={tool === "draw"} />
    </div>
  );

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex flex-col bg-[rgba(8,12,26,0.97)]"
      role="dialog"
      aria-modal="true"
      aria-label="Create a story"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between px-3 py-1">
        <button
          type="button"
          onClick={stage === "edit" ? () => setStage("pick") : onClose}
          aria-label={stage === "edit" ? "Back" : "Close story creator"}
          className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
        >
          {stage === "edit" ? <ChevronLeft className="h-6 w-6" /> : <X className="h-6 w-6" />}
        </button>
        <p className="text-[15px] font-bold text-white">
          {stage === "pick" ? "Add to story" : stage === "edit" ? "Your story" : stage === "preview" ? "Preview" : "Publishing…"}
        </p>
        {stage === "edit" || stage === "preview" ? (
          <button
            type="button"
            onClick={saveDraft}
            className="flex h-11 items-center rounded-full px-3 text-[12px] font-bold text-white/80 hover:bg-white/10"
          >
            Draft
          </button>
        ) : (
          <div className="w-11" />
        )}
      </div>

      {/* ── Desktop / mouse: say so, don't fake it (§14) ── */}
      {!isPhone ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="rounded-2xl bg-white/10 p-4 text-white">
            <Icon name="smartphone" size={32} />
          </span>
          <h2 className="text-lg font-extrabold text-white">Stories are created on the phone</h2>
          <p className="max-w-xs text-[13px] leading-relaxed text-white/70">
            The story editor is built around a camera, your gallery and touch gestures — drag, pinch and draw
            with your finger. Open <span className="font-bold text-white">eventhub.app</span> on your phone,
            or tap the story ring there.
          </p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.origin).then(
                () => toast.success("Link copied — open it on your phone"),
                () => toast.info(window.location.origin)
              );
            }}
            className="rounded-xl border border-white/25 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-white/10"
          >
            Copy the link for my phone
          </button>
          <button type="button" onClick={onClose} className="text-[13px] font-semibold text-white/60 underline">
            Close
          </button>
        </div>
      ) : null}

      {/* ── Pick (§15) ── */}
      {isPhone && stage === "pick" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) take(f);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) take(f);
              e.target.value = "";
            }}
          />
          {(
            [
              { id: "camera", icon: Camera, label: "Camera", hint: "Take a photo or video", onClick: () => cameraRef.current?.click() },
              { id: "gallery", icon: ImageIcon, label: "Gallery", hint: "Choose from your photos", onClick: () => galleryRef.current?.click() },
              { id: "text", icon: Type, label: "Text", hint: "A text story on a background", onClick: () => { setFile(null); setStage("edit"); setTool("text"); setTextDraft({ value: "", index: null, color: "#ffffff", weight: 700, align: "center", plate: false }); } },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={o.onClick}
              className="flex w-full max-w-sm items-center gap-3 rounded-2xl border border-white/15 bg-white/8 p-3.5 text-left transition active:scale-[0.99] hover:bg-white/12"
            >
              <span className="rounded-xl bg-white/12 p-2.5 text-white">
                <o.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold text-white">{o.label}</span>
                <span className="block text-[12px] text-white/60">{o.hint}</span>
              </span>
            </button>
          ))}
          {hasDraft ? (
            <button
              type="button"
              onClick={resumeDraft}
              className="mt-1 text-[13px] font-bold text-white/80 underline"
            >
              Resume saved draft
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ── Edit (§16–§21) ── */}
      {isPhone && stage === "edit" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 gap-2 px-2">
            <div className="min-h-0 flex-1">{canvasBox}</div>

            {/* Right toolbar (§16) */}
            <div className="flex shrink-0 flex-col gap-2 py-1">
              {(
                [
                  { id: "text" as const, icon: Type, label: "Text", onClick: () => setTextDraft({ value: "", index: null, color: "#ffffff", weight: 700, align: "center", plate: false }) },
                  { id: "draw" as const, icon: Pencil, label: "Draw", onClick: () => setTool(tool === "draw" ? "none" : "draw") },
                  { id: "sticker" as const, icon: Sparkles, label: "Sticker", onClick: () => setStickerOpen(true) },
                  { id: "emoji" as const, icon: Smile, label: "Emoji", onClick: () => setTool(tool === "emoji" ? "none" : "emoji") },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={t.onClick}
                  aria-pressed={tool === t.id}
                  aria-label={t.label}
                  className={cn(
                    "flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[9px] font-bold transition",
                    tool === t.id ? "bg-white text-navy" : "bg-white/12 text-white/85"
                  )}
                >
                  <t.icon className="h-4.5 w-4.5" />
                  {t.label}
                </button>
              ))}
              {file ? (
                <button
                  type="button"
                  onClick={() => {
                    setFit((f) => (f === "fill" ? "fit" : "fill"));
                    setMediaTransform({ scale: 1, x: 0, y: 0 });
                  }}
                  aria-label={fit === "fill" ? "Show the whole photo (Fit)" : "Fill the frame"}
                  className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-2xl bg-white/12 text-[9px] font-bold text-white/85"
                >
                  {fit === "fill" ? <Minimize2 className="h-4.5 w-4.5" /> : <Maximize2 className="h-4.5 w-4.5" />}
                  {fit === "fill" ? "Fit" : "Fill"}
                </button>
              ) : null}
            </div>
          </div>

          {/* Tool surfaces */}
          <div className="shrink-0 space-y-2 px-2">
            {tool === "draw" ? <StoryDrawToolbar ink={ink} /> : null}
            {tool === "emoji" ? (
              <StoryEmojiTray
                onPick={(e) => addLayer({ type: "emoji", x: 0.5, y: 0.5, scale: 1, rotation: 0, emoji: e, size: 0.16 })}
              />
            ) : null}

            {/* Backgrounds for a story without media (§16) */}
            {!file ? (
              <div className="flex gap-2 overflow-x-auto px-1 pb-1">
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBackground(b.css)}
                    aria-label={`Background ${b.label}`}
                    aria-pressed={background === b.css}
                    className={cn(
                      "h-10 w-10 shrink-0 rounded-full border-2 transition",
                      background === b.css ? "border-white" : "border-white/25"
                    )}
                    style={{ background: b.css }}
                  />
                ))}
              </div>
            ) : null}

            {/* Category — drives the rail's ring icon (§26) */}
            <div className="flex gap-1.5 overflow-x-auto px-1">
              <button
                type="button"
                onClick={() => setCategory("")}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold",
                  category === "" ? "border-white bg-white text-navy" : "border-white/25 text-white/80"
                )}
              >
                No category
              </button>
              {PICKABLE_STORY_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-bold",
                    category === c ? "border-white bg-white text-navy" : "border-white/25 text-white/80"
                  )}
                >
                  <Icon name={storyCategoryIcon(c)} size={13} />
                  {storyCategoryLabel(c)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pb-1">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 200))}
                placeholder="Write a caption…"
                aria-label="Caption"
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-3 text-[14px] text-white outline-none placeholder:text-white/45 focus-visible:border-white/50"
              />
              <button
                type="button"
                onClick={() => setStage("preview")}
                className="btn-gradient h-11 shrink-0 rounded-xl px-5 text-[14px] font-bold"
              >
                Preview
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Preview (§22) ── */}
      {isPhone && (stage === "preview" || stage === "publishing") ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 px-2">{canvasBox}</div>
          <div className="shrink-0 space-y-2 px-3 pb-3 pt-2">
            {/* Audience: EventHub's existing model — a story is shown to your
                followers for 24 hours. No selector is offered that the backend
                could not honour. */}
            <p className="flex items-center justify-center gap-1.5 text-[12px] text-white/70">
              <Icon name="group" size={14} /> Your followers can see this for 24 hours
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStage("edit")}
                disabled={stage === "publishing"}
                className="h-12 rounded-xl border border-white/25 px-5 text-[15px] font-bold text-white disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={stage === "publishing"}
                className="btn-gradient flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-bold disabled:opacity-70"
              >
                {stage === "publishing" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {uploadPct}%
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" /> Share to story
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Text tool (§18) ── */}
      {textDraft ? (
        <div className="absolute inset-x-0 bottom-0 z-30 space-y-2 border-t border-white/10 bg-[rgba(8,12,26,0.98)] p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          <textarea
            autoFocus
            value={textDraft.value}
            onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value.slice(0, 220) })}
            placeholder="Type something…"
            aria-label="Story text"
            rows={2}
            className="w-full resize-none rounded-xl border border-white/20 bg-white/10 p-3 text-[16px] text-white outline-none placeholder:text-white/45 focus-visible:border-white/50"
          />
          <div className="flex items-center gap-2 overflow-x-auto">
            {["#ffffff", "#0b1116", "#ffb300", "#ff3b5c", "#00d0ff", "#7c4dff"].map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Text colour ${c}`}
                aria-pressed={textDraft.color === c}
                onClick={() => setTextDraft({ ...textDraft, color: c })}
                className={cn("h-8 w-8 shrink-0 rounded-full border-2", textDraft.color === c ? "border-white" : "border-white/25")}
                style={{ background: c }}
              />
            ))}
            <button
              type="button"
              aria-label="Toggle text background"
              aria-pressed={textDraft.plate}
              onClick={() => setTextDraft({ ...textDraft, plate: !textDraft.plate })}
              className={cn("h-8 shrink-0 rounded-full border px-3 text-[11px] font-bold", textDraft.plate ? "border-white bg-white text-navy" : "border-white/25 text-white/80")}
            >
              Plate
            </button>
            {(
              [
                { w: 400 as const, label: "Regular" },
                { w: 700 as const, label: "Bold" },
                { w: 800 as const, label: "Heavy" },
              ]
            ).map((o) => (
              <button
                key={o.w}
                type="button"
                aria-label={`Weight ${o.label}`}
                aria-pressed={textDraft.weight === o.w}
                onClick={() => setTextDraft({ ...textDraft, weight: o.w })}
                className={cn("h-8 shrink-0 rounded-full border px-3 text-[11px] font-bold", textDraft.weight === o.w ? "border-white bg-white text-navy" : "border-white/25 text-white/80")}
                style={{ fontWeight: o.w }}
              >
                {o.label}
              </button>
            ))}
            {(
              [
                { a: "left" as const, Icon: AlignLeft, label: "Align left" },
                { a: "center" as const, Icon: AlignCenter, label: "Align centre" },
                { a: "right" as const, Icon: AlignRight, label: "Align right" },
              ]
            ).map((o) => (
              <button
                key={o.a}
                type="button"
                aria-label={o.label}
                aria-pressed={textDraft.align === o.a}
                onClick={() => setTextDraft({ ...textDraft, align: o.a })}
                className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", textDraft.align === o.a ? "border-white bg-white text-navy" : "border-white/25 text-white/80")}
              >
                <o.Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTextDraft(null)}
              className="h-11 rounded-xl border border-white/25 px-4 text-[14px] font-bold text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitText}
              className="btn-gradient flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold"
            >
              <Check className="h-4 w-4" /> {textDraft.index === null ? "Place text" : "Update text"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Sticker tray (§20) ── */}
      <StoryStickerSheet
        open={stickerOpen}
        onClose={() => setStickerOpen(false)}
        onPick={(choice: StickerChoice) =>
          addLayer({
            type: "sticker",
            x: 0.5,
            y: 0.35,
            scale: 1,
            rotation: 0,
            kind: choice.kind,
            label: choice.label,
            payload: choice.payload,
          })
        }
      />
    </div>,
    document.body
  );
}
