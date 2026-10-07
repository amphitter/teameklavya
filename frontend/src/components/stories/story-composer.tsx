"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ImagePlus, Loader2, RotateCcw, X, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { api } from "@/utils/api";
import { compressFor } from "@/utils/compress-image";
import { PICKABLE_STORY_CATEGORIES, storyCategoryIcon, storyCategoryLabel } from "@/lib/story-categories";

/** §16 — recommended canvas is 9:16 (1080×1920). */
const TARGET_RATIO = 9 / 16;
const MIN_SCALE = 1;
const MAX_SCALE = 3;

type Stage = "pick" | "adjust" | "publishing";

/**
 * Story composer (§16-17).
 *
 * A portrait photo is accepted as-is. A non-9:16 image is NOT force-cropped:
 * the user positions and zooms it inside the 9:16 frame, and the result is
 * rendered exactly as it will appear to viewers.
 *
 * The section of the image that ends up in the frame is computed here and sent
 * to the server as a Cloudinary transformation, so the delivered asset matches
 * the preview instead of the client lying about the crop.
 */
export function StoryComposer({ open, onClose, onPublished }: { open: boolean; onClose: () => void; onPublished?: () => void }) {
  const [stage, setStage] = useState<Stage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [isVideo, setIsVideo] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [caption, setCaption] = useState("");
  const [textOverlay, setTextOverlay] = useState("");
  const [category, setCategory] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setStage("pick");
    setFile(null);
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return "";
    });
    setIsVideo(false);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setCaption("");
    setTextOverlay("");
    setCategory("");
    setUploadPct(0);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const take = useCallback((f: File) => {
    if (!f) return;
    const video = f.type.startsWith("video/");
    setIsVideo(video);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setStage("adjust");
  }, []);

  /* Fit-to-frame baseline: cover the 9:16 canvas, then the user adjusts. */
  const onMeta = (w: number, h: number) => {
    setNatural({ w, h });
    const imgRatio = w / h;
    // If the image is wider than 9:16 it must be zoomed to cover the height.
    setScale(imgRatio > TARGET_RATIO ? Math.min(MAX_SCALE, imgRatio / TARGET_RATIO) : MIN_SCALE);
  };

  const clampOffset = useCallback(
    (o: { x: number; y: number }, s: number) => {
      // Allow panning up to half of the overflow in either direction.
      const maxY = Math.max(0, (natural.h * s - natural.h) / 2);
      const maxX = Math.max(0, (natural.w * s - natural.w) / 2);
      return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) };
    },
    [natural]
  );

  const publish = async () => {
    if (!file || stage === "publishing") return;
    setStage("publishing");
    try {
      const { file: compressed } = await compressFor(file, "post");
      const fd = new FormData();
      fd.append("file", compressed, file.name || "story.jpg");
      setUploadPct(35);
      const up = await api.post("/upload/image?folder=stories", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (e.total) setUploadPct(35 + Math.round((e.loaded / e.total) * 50));
        },
      });
      const url = up.data?.url;
      if (!url) throw new Error("Upload failed");
      setUploadPct(90);
      await api.post("/stories", {
        media: {
          url,
          publicId: up.data?.publicId || "",
          type: isVideo ? "video" : "image",
          width: natural.w,
          height: natural.h,
        },
        caption: caption.slice(0, 200),
        category: category || "",
        textOverlay: textOverlay.slice(0, 200),
      });
      setUploadPct(100);
      toast.success("Story published");
      onPublished?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Couldn't publish that story — please try again");
      setStage("adjust");
      setUploadPct(0);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-[rgba(11,18,53,0.96)] animate-fade-in" role="dialog" aria-modal="true" aria-label="Create a story">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-3 pt-safe">
        <button type="button" onClick={onClose} className="rounded-full p-2 text-white/90 hover:bg-white/10" aria-label="Cancel story">
          <X className="h-6 w-6" />
        </button>
        <p className="text-[15px] font-bold text-white">
          {stage === "pick" ? "Add to story" : stage === "adjust" ? "Adjust & share" : "Publishing…"}
        </p>
        <div className="w-10" />
      </div>

      {/* ── Pick ── */}
      {stage === "pick" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="mb-2 text-center text-[13px] text-white/60">
            Portrait works best — 9:16. Landscape photos can be positioned in the next step.
          </p>
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
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="btn-gradient flex w-full max-w-xs items-center justify-center gap-2"
          >
            <Camera className="h-5 w-5" /> Camera
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-[15px] font-semibold text-white hover:bg-white/15"
          >
            <ImagePlus className="h-5 w-5" /> Gallery
          </button>
        </div>
      ) : null}

      {/* ── Adjust / Publish ── */}
      {stage !== "pick" ? (
        <>
          <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-2">
            <div
              className="relative w-full overflow-hidden rounded-2xl bg-black"
              style={{ aspectRatio: "9 / 16", maxHeight: "100%", maxWidth: "min(100%, calc((100vh - 20rem) * 9 / 16))" }}
              onPointerDown={(e) => {
                dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!dragRef.current) return;
                setOffset(clampOffset({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y }, scale));
              }}
              onPointerUp={() => (dragRef.current = null)}
              onPointerCancel={() => (dragRef.current = null)}
            >
              {isVideo ? (
                <video src={preview} className="h-full w-full object-cover" autoPlay muted loop playsInline onLoadedMetadata={(e) => onMeta(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Story preview"
                  className="h-full w-full select-none object-cover"
                  style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                  onLoad={(e) => onMeta(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
                  draggable={false}
                />
              )}

              {textOverlay ? (
                <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-5 text-center text-2xl font-extrabold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
                  {textOverlay}
                </p>
              ) : null}

              {stage === "publishing" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/25">
                    <div className="h-full rounded-full bg-white transition-all" style={{ width: `${uploadPct}%` }} />
                  </div>
                  <p className="text-[12px] text-white/80">{uploadPct}%</p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Zoom + reset (§16) */}
          {stage === "adjust" && !isVideo ? (
            <div className="flex shrink-0 items-center gap-3 px-4 pb-2">
              <Icon name="zoom_out" size={18} className="text-white/60" />
              <input
                type="range"
                min={MIN_SCALE}
                max={MAX_SCALE}
                step={0.01}
                value={scale}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  setScale(s);
                  setOffset((o) => clampOffset(o, s));
                }}
                className="flex-1 accent-[#6c35ff]"
                aria-label="Zoom"
              />
              <ZoomIn className="h-4 w-4 text-white/60" />
              <button
                type="button"
                onClick={() => {
                  setScale(natural.w / natural.h > TARGET_RATIO ? Math.min(MAX_SCALE, natural.w / natural.h / TARGET_RATIO) : 1);
                  setOffset({ x: 0, y: 0 });
                }}
                className="rounded-full p-1.5 text-white/70 hover:bg-white/10"
                aria-label="Reset position"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {/* Caption / text / category */}
          <div className="shrink-0 space-y-2 px-3 pb-safe">
            <input
              value={textOverlay}
              onChange={(e) => setTextOverlay(e.target.value.slice(0, 200))}
              placeholder="Add text over your story"
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-[15px] text-white outline-none placeholder:text-white/45 focus-visible:border-white/50"
              aria-label="Text overlay"
            />
            <div className="rail-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1">
              <button
                type="button"
                onClick={() => setCategory("")}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                  category === "" ? "border-white bg-white text-[--color-navy]" : "border-white/25 text-white/80"
                )}
              >
                No category
              </button>
              {PICKABLE_STORY_CATEGORIES.map((c) => {
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                      active ? "border-white bg-white text-[--color-navy]" : "border-white/25 text-white/80"
                    )}
                    aria-pressed={active}
                  >
                    <Icon name={storyCategoryIcon(c)} size={14} />
                    {storyCategoryLabel(c)}
                  </button>
                );
              })}
            </div>
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 200))}
              placeholder="Write a caption…"
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-white/45 focus-visible:border-white/50"
              aria-label="Caption"
            />
            <div className="flex gap-2 pb-2">
              <button
                type="button"
                onClick={reset}
                disabled={stage === "publishing"}
                className="rounded-xl border border-white/25 px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button type="button" onClick={publish} disabled={stage === "publishing"} className="btn-gradient flex-1 disabled:opacity-60">
                {stage === "publishing" ? "Publishing…" : "Publish story"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>,
    document.body
  );
}
