import type { MetadataRoute } from "next";

// Native Next.js App Router manifest route (serves at /manifest.webmanifest).
// Reuses the existing BreedOps brand mark (public/icons/*) -- no second
// brand identity is introduced for the PWA.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BreedOps",
    short_name: "BreedOps",
    description:
      "Plateforme d'opérations pour programmes d'amélioration végétale.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#eef2ee",
    theme_color: "#1d4a3a",
    lang: "fr",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
