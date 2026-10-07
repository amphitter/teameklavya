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

function useUpload(field: UploaderProps["field"], onChange: (url: string) => void) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);

  const upload = async (file: File, purpose: "avatar" | "poster") => {
    setPhase("uploading");
    setPct(0);
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

export function CoverUploader({ value, onChange, disabled }: { value?: string; onChange: (url: string) => void; disabled?: boolean }) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const { phase, pct, upload, remove } = useUpload("coverImage", onChange);
  const busy = phase === "uploading" || disabled;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "relative h-28 w-full overflow-hidden rounded-xl border border-outline-variant sm:h-36",
          !value && "brand-gradient"
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
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
        Recommended 1600 × 400 or wider. It&apos;s cropped to fit on mobile.
      </p>
    </div>
  );
}
