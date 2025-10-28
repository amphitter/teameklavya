import Navbar from "../components/Navbar";
import "./globals.css";

export const metadata = {
  title: "Team Eklavya | Empowering Students, Enriching Futures",
  description:
    "Team Eklavya is a student-driven initiative fostering innovation, collaboration, and technical excellence through workshops, hackathons, and mentorship programs across India.",
  icons: {
    icon: "/favicon.ico",
  },
  authors: [{ name: "Team Eklavya", url: "https://iteameklavya.vercel.app/" }],
  
  openGraph: {
    title: "Team Eklavya | Empowering Students, Enriching Futures",
    description:
      "Join Team Eklavya – a community of learners, innovators, and leaders empowering the next generation through technology, creativity, and collaboration.",
    url: "https://iteameklavya.vercel.app/",
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

  twitter: {
    card: "summary_large_image",
    title: "Team Eklavya | Empowering Students, Enriching Futures",
    description:
      "Team Eklavya connects students and innovators through real-world projects, AR workshops, and technology-driven learning experiences.",
    creator: "@iteameklavya",
    images: ["https://iteameklavya.vercel.app/og-image.png"],
  },

  metadataBase: new URL("https://iteameklavya.vercel.app"),
  keywords: [
    "Team Eklavya",
    "Student Community",
    "Innovation",
    "Hackathons",
    "Workshops",
    "Technology",
    "Education",
    "AR VR",
    "Student Empowerment",
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
