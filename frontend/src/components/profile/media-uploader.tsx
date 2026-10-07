"use client";

import { useRef, useState } from "react";
import { Camera, Crop, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { api } from "@/utils/api";
import { UserAvatar } from "@/components/user-avatar";
import { CropEditor, type CropEditorResult } from "@/components/media/crop-editor";
import { AVATAR_CANONICAL_PX, COVER_CANONICAL_H, COVER_CANONICAL_W } from "@/utils/canonical-image";
import { updateSessionUser, useSessionUser } from "@/components/shell/use-session-user";
import type { CropRect } from "@/lib/crop";

type Phase = "idle" | "cropping" | "uploading" | "success" | "error";

/**
 * Avatar / cover uploader (§5, §7, §8, §22, §25).
 *
 * What changed in the profile rebuild, and why
 * -------------------------------------------
 * This component used to upload the compressed ORIGINAL and store its URL.
 * That is where "only a nose on one device, the whole face on another" came
 * from: the stored asset was the whole photo, and every surface cropped it
 * independently — different containers, different breakpoints, different
 * device pixel ratios, different crops of the same file.
 *
 * Now the flow is: pick → crop → **canonical render** → upload → store.
 * The uploaded file is already the user's chosen square (or cover), so every
 * surface is scaling one asset instead of deciding its own crop. The maths is
 * in `lib/crop.ts`, the rendering in `utils/canonical-image.ts`, and the
 * editor in `components/media/crop-editor.tsx`.
 *
 * The crop the user chose is stored alongside (`avatarCrop`), so "re-crop"
 * re-opens on their framing rather than starting from scratch.
 */

interface UploaderProps {
  /** Current stored URL, or "" when unset. */
  value?: string;
  onChange: (url: string, meta?: UploadMeta) => void;
  /** Backend profile field to write. */
  field: "avatar" | "coverImage";
  disabled?: boolean;
  /** Stored crop, to re-open the editor on the user's own framing. */
  initialCrop?: CropRect | null;
}

/** What the uploader tells the caller to persist next to the URL. */
export interface UploadMeta {
  crop: CropRect;
  focalY: number;
  /** Bumped only when the asset actually changes (§27). */
  version: number;
}

/* §25 — "supports JPG/PNG/WEBP, size + MIME + dimension validation".
 * Checked HERE, before anything is uploaded, so an unusable file costs the
 * user nothing: no 8 MB round trip, no quota consumed, and an error that names
 * the actual problem instead of a generic "upload failed". The backend repeats
 * every one of these checks on the bytes themselves — this half exists to give
 * a fast, specific answer, not to be the only line of defence. */
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MIN_SIDE = 64;

/** The smallest input worth cropping: at 4× zoom a 400px source is unusable. */
const MIN_CROP_SOURCE = 400;
const AVATAR_MIN_SOURCE = 200;

async function validateImage(file: File, field: UploaderProps["field"]): Promise<string | null> {
  if (!ALLOWED_MIME.includes(file.type)) {
    return "Use a JPG, PNG or WEBP image.";
  }
  if (file.size > MAX_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`;
  }
  if (file.size === 0) return "That file is empty.";

  // Decode the header to learn the real dimensions. The declared MIME can lie,
  // so this also confirms the bytes actually decode as an image — and it is
  // what makes the crop editor safe to open (it needs real width/height).
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
    /* The old code rejected anything outside 0.5–2 aspect. With a real crop
       step that advice is obsolete — a panorama can be cropped into a square
       perfectly well. What still matters is having enough pixels to fill the
       circle without upscaling. */
    if (Math.min(dims.w, dims.h) < AVATAR_MIN_SOURCE) {
      return `For a crisp profile photo, pick one at least ${AVATAR_MIN_SOURCE}px on its shorter side (this one is ${Math.min(dims.w, dims.h)}px).`;
    }
  } else if (Math.min(dims.w, dims.h) < MIN_CROP_SOURCE / 2) {
    return "That image is too small for a cover — try one at least 800×400.";
  }
  return null;
}

function useUpload(field: UploaderProps["field"], onChange: UploaderProps["onChange"]) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  /* The session copy of the identity — the header, the nav and every cached
     author label read THIS, not the API. */
  const { user } = useSessionUser();

  /**
   * Publish the new image to the session, exactly as a profile save does.
   *
   * Without this the upload was written to the server and the profile page
   * showed it, while the top-bar avatar next to it kept rendering the old
   * initials — the header reads the session, the profile reads the API, and
   * only one of them had been told. `updateSessionUser` merges and fires the
   * session event, so every `useSessionUser` consumer re-reads on the same
   * frame (§7 — the same photo on every surface, without a reload).
   */
  const announce = (patch: Record<string, unknown>) => {
    const profile = { ...((user?.profile as Record<string, unknown>) || {}), ...patch };
    updateSessionUser({ profile } as never);
  };

  /** Validate, then hand off to the crop editor. No upload happens yet. */
  const begin = async (file: File, setCropping: (f: File | null) => void) => {
    setPhase("idle");
    const problem = await validateImage(file, field);
    if (problem) {
      setPhase("error");
      toast.error(problem);
      setTimeout(() => setPhase("idle"), 2600);
      return;
    }
    setCropping(file);
    setPhase("cropping");
  };

  /** The canonical file the editor produced — upload and persist it. */
  const commit = async (result: CropEditorResult, setCropping: (f: File | null) => void) => {
    setPhase("uploading");
    setPct(0);
    setCropping(null);
    try {
      const fd = new FormData();
      fd.append("file", result.file, result.file.name);
      setPct(15);
      /* `purpose=` declares that these bytes are a CANONICAL render, which
       * makes the server check the shape it received (square for an avatar,
       * 3:1 for a cover). If a future refactor uploads an uncropped original
       * by mistake, the request fails loudly here instead of quietly storing
       * something every surface then crops differently. */
      const query =
        field === "avatar" ? "folder=avatars&purpose=avatar" : "folder=posters&purpose=cover";
      const up = await api.post(
        "/upload/image?" + query,
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (e) => e.total && setPct(15 + Math.round((e.loaded / e.total) * 60)),
        }
      );
      const url = up.data?.url;
      if (!url) throw new Error("No URL returned");
      setPct(80);

      /* Persist immediately, together with the crop and a fresh version.
       *
       * The version only changes when the asset changes (§27) — it is not a
       * render-time timestamp. It travels as `?v=` on every avatar URL so a
       * replaced photo is never served from a CDN or browser cache, while an
       * unchanged one stays cached indefinitely. */
      const version = Date.now();
      const body =
        field === "avatar"
          ? { avatar: url, avatarCrop: result.crop, avatarVersion: version }
          : { coverImage: url, coverCrop: result.crop, coverVersion: version, coverPosition: result.focalY };
      await api.put("/auth/me/profile", body);
      setPct(100);

      announce(
        field === "avatar"
          ? { avatar: url, avatarCrop: result.crop, avatarVersion: version }
          : { coverImage: url, coverCrop: result.crop, coverVersion: version, coverPosition: result.focalY }
      );
      setPhase("success");
      onChange(url, { crop: result.crop, focalY: result.focalY, version });
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
      await api.put("/auth/me/profile", {
        [field]: "",
        ...(field === "avatar"
          ? { avatarCrop: null, avatarVersion: Date.now() }
          : { coverCrop: null, coverVersion: Date.now(), coverPosition: 50 }),
      });
      announce(
        field === "avatar"
          ? { avatar: "", avatarCrop: null, avatarVersion: Date.now() }
          : { coverImage: "", coverCrop: null, coverVersion: Date.now(), coverPosition: 50 }
      );
      setPhase("idle");
      onChange("");
      toast.success(field === "avatar" ? "Profile photo removed" : "Cover photo removed");
    } catch {
      setPhase("error");
      toast.error("Couldn't remove that image");
      setTimeout(() => setPhase("idle"), 2600);
    }
  };

  return { phase, pct, setPhase, begin, commit, remove };
}

/* ── Avatar ─────────────────────────────────────────────────────────────── */

export function AvatarUploader({
  value,
  onChange,
  disabled,
  initialCrop,
}: {
  value?: string;
  onChange: (url: string, meta?: UploadMeta) => void;
  disabled?: boolean;
  initialCrop?: CropRect | null;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [recrop, setRecrop] = useState<string | null>(null);
  const { phase, pct, setPhase, begin, commit, remove } = useUpload("avatar", onChange);
  const busy = phase === "uploading" || disabled;

  /* A stored avatar with no crop predates the editor: it is the raw upload, so
     nothing guarantees what is inside the circle on a given device (§7 —
     "legacy profile image with no canonical crop"). Offering a re-crop is the
     migration: one tap, the editor opens on the same photo. */
  const needsRecrop = Boolean(value) && !initialCrop;

  /* A photo that ALREADY has a canonical crop can still be re-framed — this is
     what storing the crop next to the rendered square is for (§6). The editor
     re-opens on the stored photo with the user's own framing restored, so a
     nudge is a nudge and not a re-start. It works within the photo you have:
     the stored file is already the square the crop produced, which is why the
     hint below says so rather than implying the whole original is back. */
  const canRecrop = Boolean(value) && Boolean(initialCrop);

  const editorSrc = picked || recrop;

  return (
    <div className="flex items-center gap-4">
      {/* `shrink-0` is load-bearing: as a plain flex item this preview was
          squeezed to 25×80 by the row of buttons beside it — an oval standing
          in for the one thing the user is here to look at. */}
      <div className="relative shrink-0">
        <div className="shrink-0 rounded-full border-4 border-surface-container-lowest">
          <UserAvatar
            user={{ firstName: "A", lastName: "", profile: { avatar: value } }}
            size={80}
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
            if (f) begin(f, setPicked);
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
            if (f) begin(f, setPicked);
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
        {canRecrop ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPhase("cropping");
              setRecrop(value || null);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] font-semibold text-on-surface transition hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <Crop className="h-4 w-4" /> Re-crop
          </button>
        ) : null}
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

      {needsRecrop ? (
        <div className="w-full rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-[12px] font-semibold text-on-surface">This photo was uploaded before cropping</p>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">
            Every screen shows a different part of it. Re-crop it once and it stays the same everywhere.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPhase("cropping");
              setRecrop(value || null);
            }}
            className="mt-1.5 text-[12px] font-bold text-primary underline underline-offset-2 disabled:opacity-50"
          >
            Re-crop this photo
          </button>
        </div>
      ) : null}

      {editorSrc ? (
        <CropEditor
          src={editorSrc}
          aspect={1}
          outputWidth={AVATAR_CANONICAL_PX}
          outputHeight={AVATAR_CANONICAL_PX}
          circular
          title="Profile photo"
          confirmLabel="Use photo"
          busy={busy}
          initialCrop={picked ? null : initialCrop}
          onCancel={() => {
            setPicked(null);
            setRecrop(null);
            setPhase("idle");
          }}
          onConfirm={(result) => {
            setRecrop(null);
            commit(result, setPicked);
          }}
        />
      ) : null}

      {canRecrop ? (
        <p className="w-full text-[11px] text-on-surface-variant">
          Re-crop adjusts the framing of your current photo — pick Change photo to start from a new one.
        </p>
      ) : null}
    </div>
  );
}

/* ── Cover ──────────────────────────────────────────────────────────────── */

export function CoverUploader({
  value,
  onChange,
  disabled,
  position = 50,
  initialCrop,
}: {
  value?: string;
  onChange: (url: string, meta?: UploadMeta) => void;
  disabled?: boolean;
  /** Vertical focal point, 0–100. Derived from the crop, persisted by the caller. */
  position?: number;
  initialCrop?: CropRect | null;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [recrop, setRecrop] = useState<string | null>(null);
  const { phase, pct, setPhase, begin, commit, remove } = useUpload("coverImage", onChange);
  const busy = phase === "uploading" || disabled;
  const editorSrc = picked || recrop;

  return (
    <div className="space-y-2">
      <div className={cn("relative h-28 w-full overflow-hidden rounded-xl border border-outline-variant sm:h-36", !value && "brand-gradient")}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            draggable={false}
            /* The focal point from the crop keeps the composition stable across
               breakpoints: the same strip is visible on a phone and a desktop,
               which object-fit alone cannot do when their aspect differs. */
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
            if (f) begin(f, setPicked);
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
        {value && initialCrop ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPhase("cropping");
              setRecrop(value);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] font-semibold text-on-surface transition hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <Crop className="h-4 w-4" /> Re-crop
          </button>
        ) : null}
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
        You choose the frame — the same slice stays visible on every screen size.
      </p>

      {editorSrc ? (
        <CropEditor
          src={editorSrc}
          aspect={COVER_CANONICAL_W / COVER_CANONICAL_H}
          outputWidth={COVER_CANONICAL_W}
          outputHeight={COVER_CANONICAL_H}
          title="Cover photo"
          confirmLabel="Use cover"
          busy={busy}
          initialCrop={picked ? null : initialCrop}
          onCancel={() => {
            setPicked(null);
            setRecrop(null);
            setPhase("idle");
          }}
          onConfirm={(result) => {
            setRecrop(null);
            commit(result, setPicked);
          }}
        />
      ) : null}
    </div>
  );
}
