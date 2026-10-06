import type { NextConfig } from "next";

/**
 * Part 5, Phase 4 (§19, §49) — image + asset delivery configuration.
 *
 * Remote patterns: allows next/image to optimize Cloudinary-hosted assets if
 * a screen opts into it. Our OptimizedImage component uses Cloudinary's own
 * transformation pipeline (f_auto/q_auto) by default because it avoids a
 * double-optimization round trip through the Next server, but having the
 * patterns configured keeps next/image available where it fits better.
 *
 * Formats: AVIF → WebP → original. On a mobile-first product (§51) this is
 * typically a 30–50% byte reduction over JPEG for identical visual quality.
 */
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
    // Serve the smallest modern format each browser supports.
    formats: ["image/avif", "image/webp"],
    // Responsive breakpoints used when next/image generates a srcset.
    deviceSizes: [360, 480, 640, 828, 1080, 1440, 1920],
    imageSizes: [64, 96, 160, 240, 320, 400],
    // Cache optimized images for a year — Cloudinary URLs are immutable.
    minimumCacheTTL: 60 * 60 * 24 * 365,
  },

  // §49 — skip the X-Powered-By header (small payload win + less fingerprinting).
  poweredByHeader: false,

  // §49 — tree-shake large icon/animation barrels that would otherwise pull
  // thousands of unused modules into the client bundle.
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "react-icons"],
  },
};

export default nextConfig;
