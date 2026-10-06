import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/context/ThemeContext";
import { Toaster } from "sonner";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "EventHub — Discover events, participate, grow",
    template: "%s | EventHub",
  },
  description:
    "EventHub is the social platform for events. Discover what's happening around you, register in seconds, get your QR ticket, and build your event identity.",

  applicationName: "EventHub",
  authors: [{ name: "EventHub" }],
  keywords: [
    "EventHub",
    "events",
    "event discovery",
    "event registration",
    "tickets",
    "workshops",
    "hackathons",
    "conferences",
    "meetups",
  ],

  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" },
    ],
    shortcut: "/favicon.ico",
    apple: "/brand/apple-touch-icon.png",
  },

  openGraph: {
    title: "EventHub — Discover events, participate, grow",
    description:
      "Discover what's happening around you, register in seconds, get your QR ticket, and build your event identity.",
    url: SITE_URL,
    siteName: "EventHub",
    images: [
      {
        url: "/brand/og-image.png",
        width: 1200,
        height: 630,
        alt: "EventHub — the social platform for events",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "EventHub — Discover events, participate, grow",
    description:
      "Discover what's happening around you, register in seconds, get your QR ticket, and build your event identity.",
    images: ["/brand/og-image.png"],
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },

  alternates: {
    canonical: "/",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta property="og:site_name" content="EventHub" />
        <meta name="apple-mobile-web-app-title" content="EventHub" />
        {/* Material Symbols Outlined — same icon set as the home-feed reference */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>

        <Toaster
          position="top-center"
          richColors
          toastOptions={{
            style: {
              borderRadius: "10px",
              fontFamily: "var(--font-inter)",
            },
          }}
        />

        {/* WebSite structured data */}
        <Script
          id="website-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "EventHub",
              alternateName: "EventHub",
              url: SITE_URL,
              description:
                "EventHub — the social platform for events. Discover, participate, create, connect, grow.",
            }),
          }}
        />
      </body>
    </html>
  );
}
