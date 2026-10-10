"use client";

import { useCallback, useState } from "react";
import Cropper, { Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { X, ZoomIn, Check } from "lucide-react";

interface ImageCropEditorProps {
  imageSrc: string; // object URL or data URL
  aspect: number; // 1 for square logo, 16/9 or 3/1 for cover
  cropShape?: "rect" | "round";
  onCancel: () => void;
  onComplete: (croppedBlob: Blob, previewUrl: string) => void;
  title?: string;
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    img.setAttribute("crossOrigin", "anonymous");
    img.src = url;
  });
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area, outputWidth = 512): Promise<{ blob: Blob; previewUrl: string }> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  // Determine output size preserving aspect, but ensure square for logo is 512x512, cover e.g. 1200x400
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  // For square, output 512x512; for landscape, output width 1200, height derived
  const isSquare = Math.abs(pixelCrop.width - pixelCrop.height) < 2;
  let outW = outputWidth;
  let outH = outputWidth;
  if (!isSquare) {
    const aspect = pixelCrop.width / pixelCrop.height;
    outW = 1200;
    outH = Math.round(1200 / aspect);
  }

  canvas.width = outW;
  canvas.height = outH;

  // Fill transparent for PNG handling – white background for JPEG? We'll keep transparent for PNG
  ctx.fillStyle = "transparent";
  ctx.fillRect(0, 0, outW, outH);

  ctx.drawImage(
    image,
    pixelCrop.x * scaleX,
    pixelCrop.y * scaleY,
    pixelCrop.width * scaleX,
    pixelCrop.height * scaleY,
    0,
    0,
    outW,
    outH
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas empty"));
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        resolve({ blob, previewUrl });
      },
      "image/png",
      0.92
    );
  });
}

export function ImageCropEditor({ imageSrc, aspect, cropShape = "rect", onCancel, onComplete, title }: ImageCropEditorProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    setProcessing(true);
    try {
      const { blob, previewUrl } = await getCroppedImg(imageSrc, croppedAreaPixels, aspect === 1 ? 512 : 1200);
      onComplete(blob, previewUrl);
    } catch (e) {
      console.error("crop failed", e);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
      <div className="flex items-center justify-between p-3 text-white">
        <h3 className="text-sm font-medium">{title || (aspect === 1 ? "Crop logo – square" : "Crop cover – landscape")}</h3>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-white hover:bg-white/10" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative flex-1 bg-black">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={cropShape}
          onCropChange={setCrop}
          onCropComplete={onCropComplete}
          onZoomChange={setZoom}
          showGrid={false}
          objectFit="contain"
        />
      </div>

      <div className="border-t border-white/10 bg-zinc-900 p-4">
        <div className="mx-auto max-w-md space-y-4">
          <div className="flex items-center gap-3">
            <ZoomIn className="h-4 w-4 text-white/60" />
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-white" />
            <span className="w-10 text-right text-xs text-white/60">{zoom.toFixed(1)}x</span>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 bg-white/10 text-white hover:bg-white/20 border-white/20" onClick={onCancel} disabled={processing}>
              Cancel
            </Button>
            <Button className="flex-1 gap-1.5" onClick={handleConfirm} disabled={processing || !croppedAreaPixels}>
              {processing ? "Processing…" : <><Check className="h-4 w-4" /> Confirm crop</>}
            </Button>
          </div>

          <p className="text-center text-[11px] text-white/50">
            {aspect === 1 ? "Square crop – logo will be displayed 1:1. Drag to reposition, pinch or slider to zoom." : "Landscape – drag to set focal point, zoom to frame. Final cover preserves this aspect, no stretch."}
          </p>
        </div>
      </div>
    </div>
  );
}
