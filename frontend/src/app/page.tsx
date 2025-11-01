import type { Metadata } from "next";
import HomePage from "../components/Home";

export const metadata: Metadata = {
  title: {
    default: "Team Eklavya | Empowering Students, Enriching Futures",
    template: "%s | Team Eklavya",
  },
  description:
    "Team Eklavya empowers students through innovation, hackathons, and mentorship—building a community of future tech leaders across India.",

  // ✅ Icon and branding
  icons: {
    icon: "/logo.png",
    shortcut: "/favicon.ico",
    apple: "/logo.png",
  },

  // ✅ Author info
  authors: [{ name: "Team Eklavya", url: "https://iteameklavya.vercel.app" }],

  // ✅ Open Graph (for Facebook, LinkedIn, Bing previews)
  openGraph: {
    title: "Team Eklavya | Empowering Students, Enriching Futures",
    description:
      "Join Team Eklavya - a community of learners, innovators, and leaders empowering the next generation through technology, creativity, and collaboration.",
    url: "https://iteameklavya.vercel.app",
    siteName: "Team Eklavya",
    images: [
      {
        url: "https://iteameklavya.vercel.app/og-image.png",
        width: 1200,
        height: 630,
        alt: "Team Eklavya - Empowering Students, Enriching Futures",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  // ✅ Twitter Cards
  twitter: {
    card: "summary_large_image",
    title: "Team Eklavya | Empowering Students, Enriching Futures",
    description:
      "Team Eklavya connects students and innovators through real-world projects, AR workshops, and technology-driven learning experiences.",
    creator: "@iteameklavya",
    site: "@iteameklavya",
    images: ["https://iteameklavya.vercel.app/og-image.png"],
  },

  // ✅ Base URL
  metadataBase: new URL("https://iteameklavya.vercel.app"),

  // ✅ SEO Keywords
  keywords: [
    "Team Eklavya",
    "Eklavya India",
    "Student Innovation",
    "Technology Education",
    "Hackathons India",
    "Workshops",
    "Mentorship Programs",
    "AR VR Education",
    "STEM Students",
    "Educational Community",
    "Student Empowerment",
    "Coding Workshops",
    "Tech Community India",
    "Student Projects",
    "Innovation Hub",
  ],

  // ✅ Robots & indexing rules
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

  // ✅ Canonical URL
  alternates: {
    canonical: "https://iteameklavya.vercel.app",
  },

// ✅ Additional optimizations
  category: "education",
  classification: "Student Innovation Community",
  abstract: "Team Eklavya - Student Innovation and Technology Community",
};

export default function Home() {
  return <HomePage />;
}