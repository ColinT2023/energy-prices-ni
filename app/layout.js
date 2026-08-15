import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata = {
  title: "NI Energy Prices",
  description:
    "Northern Ireland's SEM electricity auction prices, pulled live from SEMOpx.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en-GB"
      className={`${spaceGrotesk.variable} ${inter.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <header className="site-header">
          <Link href="/" className="site-title">
            NI Energy Prices
          </Link>
          <nav className="site-nav">
            <Link href="/">Home</Link>
            <Link href="/help" className="nav-chip">
              Help
            </Link>
          </nav>
        </header>
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
