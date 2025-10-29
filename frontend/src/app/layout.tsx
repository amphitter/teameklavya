import Navbar from "../components/Navbar";
import "./globals.css";
import Script from "next/script"; // ✅ for structured data

export const metadata = {
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
      "Join Team Eklavya — a community of learners, innovators, and leaders empowering the next generation through technology, creativity, and collaboration.",
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
  ],

  // ✅ Robots & indexing rules
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      maxSnippet: -1,
      maxImagePreview: "large",
      maxVideoPreview: -1,
    },
  },

  // ✅ Canonical URL
  alternates: {
    canonical: "https://iteameklavya.vercel.app",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <Navbar />
        <main>{children}</main>

        {/* ✅ Add Structured Data (for Google Knowledge Panel & rich results) */}
        <Script
          id="structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Team Eklavya",
              url: "https://iteameklavya.vercel.app",
              logo: "https://iteameklavya.vercel.app/logo.png",
              sameAs: [
                "https://www.linkedin.com/company/team-eklavya/",
                "https://www.instagram.com/iteameklavya/",
              ],
              description:
                "Team Eklavya is a student-driven organization promoting innovation, collaboration, and technical excellence through workshops, hackathons, and mentorship across India.",
              founder: {
                "@type": "Person",
                name: "Team Eklavya Members",
              },
            }),
          }}
        />
      </body>
    </html>
  );
}
