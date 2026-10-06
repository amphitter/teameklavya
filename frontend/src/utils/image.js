import React, { useState } from "react";

// Build a fully-qualified image URL from a possibly-relative path
export const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith("http")) return imagePath;

  // Relative paths served by the backend (legacy local uploads)
  if (imagePath.startsWith("/uploads")) {
    const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
    return `${baseURL}${imagePath}`;
  }
  return imagePath;
};

/**
 * Cloudinary URL with on-the-fly transformations (§ Cloudinary UI integration).
 * No-op for non-Cloudinary URLs (local/legacy uploads pass through).
 * Usage: cloudinaryUrl(url, { w: 400, h: 300 }) → .../upload/q_auto,f_auto,w_400,h_300,c_fill/...
 * @param {string|null} imagePath
 * @param {{ w?: number, h?: number, crop?: string, q?: string }} [opts]
 */
export const cloudinaryUrl = (imagePath, { w, h, crop = "fill", q = "auto" } = {}) => {
  const full = getImageUrl(imagePath);
  if (!full || !full.includes("res.cloudinary.com") || !full.includes("/image/upload/")) return full;
  const t = [`q_${q}`, "f_auto"];
  if (w) t.push(`w_${w}`);
  if (h) t.push(`h_${h}`);
  if (w && h) t.push(`c_${crop}`);
  return full.replace("/image/upload/", `/image/upload/${t.join(",")}/`);
};

// Fallback image component
export const ImageWithFallback = ({ src, alt, className, fallbackSrc = "/brand/eventhub-art.png" }) => {
  const [imgSrc, setImgSrc] = useState(getImageUrl(src));
  const [hasError, setHasError] = useState(false);

  const handleError = () => {
    if (!hasError) {
      setHasError(true);
      setImgSrc(fallbackSrc);
    }
  };

  return <img src={imgSrc} alt={alt} className={className} onError={handleError} />;
};
