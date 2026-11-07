import type { Metadata, Viewport } from "next";
import { ServiceWorkerUpdateBanner } from "@/components/service-worker-update-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "BreedOps",
  description:
    "Plateforme d'opérations pour programmes d'amélioration végétale.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BreedOps",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d4a3a",
};

// Applied before first paint so the chosen theme never flashes.
const themeScript = `try{var t=localStorage.getItem("breedops-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ServiceWorkerUpdateBanner />
        {children}
      </body>
    </html>
  );
}
