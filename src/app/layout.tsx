import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BreedOps",
  description:
    "Plateforme d'opérations pour programmes d'amélioration végétale.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
