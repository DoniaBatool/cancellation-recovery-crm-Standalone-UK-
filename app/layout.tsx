import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Geist Sans (guide §11), self-hosted: no request to Google Fonts, so no visitor IP is sent
// to a third party and the build needs no network. Licence: app/fonts/GEIST-LICENSE.txt (SIL OFL 1.1).
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SlotRefill",
    template: "%s · SlotRefill",
  },
  description: "Fill cancelled appointment slots from your waitlist. Admin tool for clinic reception.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e3a5f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={geistSans.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
