import type { Metadata } from "next";
import ContactPage from "../contact/Contact";

export const metadata: Metadata = {
  title: {
    default: "Contact Team Eklavya | Get in Touch with Our Innovation Community",
    template: "%s | Team Eklavya",
  },
  description:
    "Reach out to Team Eklavya for collaborations, inquiries, or to join our community. We're here to help with projects, events, and innovation opportunities.",

  // ✅ Icon and branding
  icons: {
    icon: "/logo.png",
    shortcut: "/favicon.ico",
    apple: "/logo.png",
  },

  // ✅ Author info
  authors: [{ name: "Team Eklavya", url: "https://www.teameklavya.xyz" }],

  // ✅ Open Graph (for Facebook, LinkedIn, Bing previews)
  openGraph: {
    title:
      "Contact Team Eklavya | Get in Touch with Our Innovation Community",
    description:
      "Connect with Team Eklavya for collaborations, project inquiries, event partnerships, or to join our growing community of student innovators.",
    url: "https://www.teameklavya.xyz/contact",
    siteName: "Team Eklavya",
    images: [
      {
        url: "https://www.teameklavya.xyz/og-contact.png",
        width: 1200,
        height: 630,
        alt: "Contact Team Eklavya - Innovation Community",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  // ✅ Twitter Cards
  twitter: {
    card: "summary_large_image",
    title:
      "Contact Team Eklavya | Get in Touch with Our Innovation Community",
    description:
      "Reach out to Team Eklavya for collaborations, event partnerships, or to join our student innovation community. Quick responses guaranteed!",
    creator: "@iteameklavya",
    site: "@iteameklavya",
    images: ["https://www.teameklavya.xyz/og-contact.png"],
  },

  // ✅ Base URL
  metadataBase: new URL("https://www.teameklavya.xyz"),

  // ✅ SEO Keywords
  keywords: [
    "Contact Team Eklavya",
    "Team Eklavya Contact",
    "Student Innovation Contact",
    "Collaboration Opportunities",
    "Hackathon Partnerships",
    "Workshop Inquiries",
    "Tech Community Contact",
    "Student Projects",
    "Innovation Partnerships",
    "Event Collaboration",
    "Join Student Community",
    "Tech Mentorship Contact",
    "AR VR Projects",
    "Coding Workshops",
    "Student Innovation Hub",
  ],

  // ✅ Robots & indexing rules (TypeScript-safe)
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
    canonical: "https://www.teameklavya.xyz/contact",
  },

  // ✅ Additional optimizations
  category: "education",
  classification: "Student Innovation Community Contact",
  abstract: "Contact Team Eklavya - Student Innovation Community",
};

export default function Contact() {
  return <ContactPage />;
}
