import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BreedOps",
  description:
    "Plateforme d'opérations pour programmes d'amélioration végétale.",
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
      <body>{children}</body>
    </html>
  );
}
