import type { Metadata } from "next";
import Script from "next/script";
import AboutPage from "../about/About";

export const metadata: Metadata = {
  title: {
    default: "About | Team Eklavya – Innovators Building the Future",
    template: "%s | Team Eklavya",
  },
  description:
    "Meet Team Eklavya - a passionate student-led community driving innovation through hackathons, workshops, and collaborative projects.",

  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },

  authors: [{ name: "Team Eklavya", url: "https://www.teameklavya.xyz" }],

  openGraph: {
    title: "About | Team Eklavya – Innovators Building the Future",
    description:
      "Discover Team Eklavya's mission, vision, and the passionate team behind India's fastest-growing student innovation community.",
    url: "https://www.teameklavya.xyz/about",
    siteName: "Team Eklavya",
    images: [
      {
        url: "https://www.teameklavya.xyz/og-about.png",
        width: 1200,
        height: 630,
        alt: "Team Eklavya - About Our Innovation Community",
      },
    ],
    locale: "en_US",
    type: "article",
  },

  twitter: {
    card: "summary_large_image",
    title: "About | Team Eklavya – Innovators Building the Future",
    description:
      "Meet the innovators behind Team Eklavya — empowering students through technology, collaboration, and creativity across India.",
    creator: "@iteameklavya",
    images: ["https://www.teameklavya.xyz/og-about.png"],
  },

  metadataBase: new URL("https://www.teameklavya.xyz"),

  keywords: [
    "About Team Eklavya",
    "Team Eklavya Team",
    "Student Innovation Community",
    "Hackathons India",
    "Student Workshops",
    "Tech Education",
    "Student Leadership",
    "Youth Empowerment",
  ],

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
    canonical: "https://www.teameklavya.xyz/about",
  },
};

export default function About() {
  return (
    <>
      <AboutPage />

      {/* ✅ Page-Specific Structured Data (helps Discover show correct title) */}
      <Script
        id="about-page-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "About Team Eklavya – Innovators Building the Future",
            url: "https://www.teameklavya.xyz/about",
            description:
              "Learn about Team Eklavya’s mission to empower students through innovation, hackathons, and collaborative learning across India.",
            publisher: {
              "@type": "Organization",
              name: "Team Eklavya",
              url: "https://www.teameklavya.xyz",
              logo: {
                "@type": "ImageObject",
                url: "https://www.teameklavya.xyz/favicon.ico",
              },
            },
          }),
        }}
      />
    </>
  );
}
