"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { api } from "@/utils/api";
import { compressFor } from "@/utils/compress-image";
import { UserAvatar } from "@/components/user-avatar";

type Phase = "idle" | "uploading" | "success" | "error";

/**
 * Avatar / cover uploader (§21-22).
 *
 * Three states the brief requires and the previous UI never had:
 *   • upload progress
 *   • success
 *   • failure
 *
 * The URL is written straight through to /auth/me/profile, so the value the
 * user sees is the value the backend stored — not a local-only preview that
 * vanishes on reload (§22: "Store actual backend media URL. Do not only
 * update local UI").
 */

interface UploaderProps {
  /** Current stored URL, or "" when unset. */
  value?: string;
  onChange: (url: string) => void;
  /** Backend profile field to write. */
  field: "avatar" | "coverImage";
  disabled?: boolean;
}

/* §2-7 — "supports JPG/PNG/WEBP, size + MIME + dimension validation".
 * Checked HERE, before the upload starts, so an unusable file costs the user
 * nothing: no 4 MB round trip, no quota consumed, and an error that names the
 * actual problem instead of a generic "upload failed". */
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MIN_SIDE = 64;

async function validateImage(file: File, field: UploaderProps["field"]): Promise<string | null> {
  if (!ALLOWED_MIME.includes(file.type)) {
    return "Use a JPG, PNG or WEBP image.";
  }
  if (file.size > MAX_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`;
  }
  if (file.size === 0) return "That file is empty.";

  // Decode the header to learn the real dimensions. The declared MIME can
  // lie, so we also confirm the bytes actually decode as an image.
  const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });

  if (!dims) return "That file isn't a readable image.";
  if (dims.w < MIN_SIDE || dims.h < MIN_SIDE) {
    return `That image is ${dims.w}×${dims.h} — it needs to be at least ${MIN_SIDE}×${MIN_SIDE}.`;
  }
  if (field === "avatar") {
    // A non-square avatar is cropped to a circle; warn rather than silently
    // slicing someone's head off.
    const ratio = dims.w / dims.h;
    if (ratio < 0.5 || ratio > 2) {
      return "Profile photos look best roughly square — crop it and try again.";
    }
  }
  return null;
}

function useUpload(field: UploaderProps["field"], onChange: (url: string) => void) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);

  const upload = async (file: File, purpose: "avatar" | "poster") => {
    setPhase("uploading");
    setPct(0);
    const problem = await validateImage(file, field);
    if (problem) {
      setPhase("error");
      toast.error(problem);
      setTimeout(() => setPhase("idle"), 2600);
      return;
    }
    try {
      const { file: compressed } = await compressFor(file, purpose);
      const fd = new FormData();
      fd.append("file", compressed, file.name || "upload.jpg");
      setPct(25);
      const up = await api.post("/upload/image?folder=" + (field === "avatar" ? "avatars" : "posters"), fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => e.total && setPct(25 + Math.round((e.loaded / e.total) * 50)),
      });
      const url = up.data?.url;
      if (!url) throw new Error("No URL returned");
      setPct(80);
      // Persist immediately so a reload shows the same image.
      await api.put("/auth/me/profile", { [field]: url });
      setPct(100);
      setPhase("success");
      onChange(url);
      toast.success(field === "avatar" ? "Profile photo updated" : "Cover photo updated");
      setTimeout(() => setPhase("idle"), 1600);
    } catch (e: any) {
      setPhase("error");
      toast.error(e?.response?.data?.message || "Upload failed — please try again");
      setTimeout(() => setPhase("idle"), 2600);
    }
  };

  const remove = async () => {
    setPhase("uploading");
    try {
      await api.put("/auth/me/profile", { [field]: "" });
      setPhase("idle");
      onChange("");
      toast.success(field === "avatar" ? "Profile photo removed" : "Cover photo removed");
    } catch {
      setPhase("error");
      toast.error("Couldn't remove that image");
      setTimeout(() => setPhase("idle"), 2600);
    }
  };

  return { phase, pct, upload, remove };
}

/* ── Avatar ─────────────────────────────────────────────────────────────── */

export function AvatarUploader({ value, onChange, disabled }: { value?: string; onChange: (url: string) => void; disabled?: boolean }) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const { phase, pct, upload, remove } = useUpload("avatar", onChange);
  const busy = phase === "uploading" || disabled;

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <div className="rounded-full border-4 border-surface-container-lowest">
          <UserAvatar
            user={{ firstName: "A", lastName: "", profile: { avatar: value } }}
            size={80}
            className="!h-20 !w-20"
          />
        </div>
        {phase === "uploading" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-black/55">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
            <div className="mt-1 h-1 w-10 overflow-hidden rounded-full bg-white/30">
              <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
        {phase === "success" ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-success/25">
            <Icon name="check_circle" size={30} filled className="text-success" />
          </span>
        ) : null}
        {phase === "error" ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-destructive/30">
            <Icon name="error" size={30} filled className="text-destructive" />
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f, "avatar");
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f, "avatar");
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => galleryRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] font-semibold text-on-surface transition hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" /> Change photo
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] font-semibold text-on-surface transition hover:border-primary hover:text-primary disabled:opacity-50 sm:inline-flex"
        >
          <Camera className="h-4 w-4" /> Camera
        </button>
        {value ? (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ── Cover ──────────────────────────────────────────────────────────────── */

export function CoverUploader({
  value,
  onChange,
  disabled,
  position = 50,
  onPositionChange,
}: {
  value?: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  /** Vertical focal point, 0–100. Persisted by the caller (§7). */
  position?: number;
  onPositionChange?: (pct: number) => void;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const { phase, pct, upload, remove } = useUpload("coverImage", onChange);
  const busy = phase === "uploading" || disabled;
  const previewRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  /* ── Reposition (§7) ──────────────────────────────────────────────────
   * Drag anywhere on the preview to set the focal point, and the slider below
   * does the same thing for anyone who cannot or does not want to drag.
   *
   * Pointer events, not mouse+touch pairs: one code path covers mouse, touch
   * and pen, and `setPointerCapture` keeps the drag alive when the finger
   * leaves the element — which is what makes it usable on a phone.
   *
   * The drag is bounded to the preview and calls `preventDefault` only on
   * pointermove while a drag is actually in progress, so ordinary page
   * scrolling is never stolen from the user. */
  const applyFromPointer = (clientY: number) => {
    const el = previewRef.current;
    if (!el || !onPositionChange) return;
    const rect = el.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    onPositionChange(Math.min(100, Math.max(0, Math.round(ratio * 100))));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!value || !onPositionChange || busy) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyFromPointer(e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    applyFromPointer(e.clientY);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
  };

  return (
    <div className="space-y-2">
      <div
        ref={previewRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "relative h-28 w-full touch-none overflow-hidden rounded-xl border border-outline-variant sm:h-36",
          !value && "brand-gradient",
          value && !busy && onPositionChange && "cursor-grab active:cursor-grabbing"
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            draggable={false}
            /* The focal point is what makes a 1600×400 upload survive being
               shown as a 96px strip on a phone. */
            style={{ objectPosition: `50% ${position}%` }}
            className="h-full w-full select-none object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-[12px] font-semibold text-white/85">No cover yet</span>
          </div>
        )}
        {phase === "uploading" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
            <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-white/30">
              <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
        {phase === "success" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-success/25">
            <Icon name="check_circle" size={34} filled className="text-success" />
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-destructive/30">
            <Icon name="error" size={34} filled className="text-destructive" />
          </div>
        ) : null}
        {value && !busy && onPositionChange ? (
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Drag to reposition
          </span>
        ) : null}
      </div>

      {/* Keyboard/label-able equivalent of the drag — a drag is not
          reachable by keyboard, so the same value has a real control. */}
      {value && onPositionChange ? (
        <label className="flex items-center gap-2 text-[11px] font-semibold text-on-surface-variant">
          <span className="shrink-0">Position</span>
          <input
            type="range"
            min={0}
            max={100}
            value={position}
            disabled={busy}
            onChange={(e) => onPositionChange(Number(e.target.value))}
            aria-label="Cover vertical position"
            className="h-1.5 flex-1 accent-[var(--primary,#2563FF)]"
          />
          <span className="w-8 shrink-0 text-right tabular-nums">{Math.round(position)}%</span>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f, "poster");
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => galleryRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] font-semibold text-on-surface transition hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" /> {value ? "Change cover" : "Add cover"}
        </button>
        {value ? (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        ) : null}
      </div>
      <p className="text-[11px] text-on-surface-variant">
        Recommended 1600 × 400 or wider. Drag the preview to choose what stays visible when it&apos;s cropped.
      </p>
    </div>
  );
}
