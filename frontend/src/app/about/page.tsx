import type { Metadata } from "next";
import AboutPage from "../about/About";

export const metadata: Metadata = {
  title: {
    default: "About | Team Eklavya – Innovators Building the Future",
    template: "%s | Team Eklavya",
  },
  description: "Meet Team Eklavya - a passionate student-led community driving innovation through hackathons, workshops, and collaborative projects. Learn about our mission, team, and values.",

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
    title: "About | Team Eklavya – Innovators Building the Future",
    description: "Discover Team Eklavya's mission, vision, and the passionate team behind India's fastest-growing student innovation community.",
    url: "https://iteameklavya.vercel.app/about",
    siteName: "Team Eklavya",
    images: [
      {
        url: "https://iteameklavya.vercel.app/og-about.png",
        width: 1200,
        height: 630,
        alt: "Team Eklavya - About Our Innovation Community",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  // ✅ Twitter Cards
  twitter: {
    card: "summary_large_image",
    title: "About | Team Eklavya – Innovators Building the Future",
    description: "Meet the innovators behind Team Eklavya — empowering students through technology, collaboration, and creativity across India.",
    creator: "@iteameklavya",
    site: "@iteameklavya",
    images: ["https://iteameklavya.vercel.app/og-about.png"],
  },

  // ✅ Base URL
  metadataBase: new URL("https://iteameklavya.vercel.app"),

  // ✅ SEO Keywords
  keywords: [
    "About Team Eklavya",
    "Team Eklavya Team",
    "Student Innovation Community",
    "Hackathons India",
    "Student Workshops",
    "Tech Education",
    "Student Leadership",
    "Youth Empowerment",
    "AR VR Education",
    "Coding Community",
    "Student Projects",
    "Innovation Hub",
    "Tech Mentorship",
    "Student Developers",
    "Programming Community",
    "STEM Education India",
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
    canonical: "https://iteameklavya.vercel.app/about",
  },

  // ✅ Additional optimizations
  category: "education",
  classification: "Student Innovation Community",
  abstract: "Team Eklavya - About Our Student Innovation Community",
};

export default function About() {
  return <AboutPage />;
}