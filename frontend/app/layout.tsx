import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Noto_Sans_Devanagari, Noto_Sans_Telugu } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["opsz", "wdth"] });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-deva", display: "swap" });
const telu = Noto_Sans_Telugu({ subsets: ["telugu"], variable: "--font-telu", display: "swap" });

// Link previews (WhatsApp, Slack, X) fetch og.png from this absolute URL, so default to the live site.
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://mycopilot.qd.je";
const DESCRIPTION = "Reads a family's prescriptions, lab reports and discharge summaries, explains them in English, Hindi and Telugu, and keeps one ABDM-ready record per person.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Health Copilot", template: "%s · Health Copilot" },
  description: DESCRIPTION,
  applicationName: "Health Copilot",
  openGraph: {
    type: "website", siteName: "Health Copilot", title: "Health Copilot",
    description: DESCRIPTION, url: SITE,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Health Copilot: your family's prescriptions, lab reports and discharge papers, read and explained." }],
  },
  twitter: { card: "summary_large_image", title: "Health Copilot", description: DESCRIPTION, images: ["/og.png"] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Light by default; applies a saved choice before paint so there is no flash.
const themeScript = `try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=(t==='dark'?'dark':'light')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning className={`${display.variable} ${geist.variable} ${geistMono.variable} ${deva.variable} ${telu.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body suppressHydrationWarning className="min-h-[100dvh] font-sans text-base antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
