import Navbar from "../components/Navbar";
import "./globals.css";
export const metadata = {
  title: "Team Eklavya",
  description: "Empowering Students, Enriching Futures - Team Eklavya",
  icons: {
    icon: "/favicon.ico",
  },
  authors: [{ name: "Team Eklavya", url: "https://teameklavya.com/team" }],
  
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
