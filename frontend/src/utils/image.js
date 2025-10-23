import React, { useState } from "react"; // ✅ Import useState

// Helper function to construct proper image URLs
export const getImageUrl = (imagePath) => {
  if (!imagePath) return '/api/placeholder/400/200';
  
  // If it's already a full URL, return as is
  if (imagePath.startsWith('http')) return imagePath;
  
  // If it's a relative path starting with /uploads, construct full URL
  if (imagePath.startsWith('/uploads')) {
    const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    return `${baseURL}${imagePath}`;
  }
  
  return imagePath;
};

// Fallback image component
export const ImageWithFallback = ({ src, alt, className, fallbackSrc = '/api/placeholder/400/200' }) => {
  const [imgSrc, setImgSrc] = useState(getImageUrl(src));
  const [hasError, setHasError] = useState(false);

  const handleError = () => {
    if (!hasError) {
      setHasError(true);
      setImgSrc(fallbackSrc);
    }
  };

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      onError={handleError}
    />
  );
};
