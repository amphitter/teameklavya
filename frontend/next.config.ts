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
/**
 * Optional same-origin API proxy — every switch below is inert unless
 * BACKEND_PROXY_URL is set, so production (Vercel → Render) is untouched: no
 * rewrites are emitted, the trailing-slash behaviour is unchanged, and the
 * browser still talks to NEXT_PUBLIC_API_URL directly.
 *
 * Why it exists: a phone preview served from one sandbox origin cannot call
 * the API on a second sandbox port (the cross-port host is token-gated), and
 * the sandbox browser has no egress to Render. Proxying server-side gives the
 * browser exactly one origin — no CORS preflight, no second port, and the same
 * URLs the app already uses.
 */
const backendProxy = process.env.BACKEND_PROXY_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  ...(backendProxy ? { skipTrailingSlashRedirect: true } : {}),

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

  async rewrites() {
    if (!backendProxy) return [];
    /* The slash-less source is the one that matters: the browser asks for
       "/socket.io/?EIO=…", Next matches that against "/socket.io/:path*" and
       drops both the capture and the slash, so the socket server — which only
       answers on the trailing-slash form — saw "/socket.io" and 404'd. The
       destination is therefore written literally, with the slash. */
    return [
      { source: "/api/:path*", destination: `${backendProxy}/api/:path*` },
      { source: "/socket.io", destination: `${backendProxy}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${backendProxy}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;
