"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
  }, []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("breedops-theme", next);
        } catch {
          // Storage can be unavailable (private mode); the theme still applies.
        }
        setTheme(next);
      }}
      aria-label={
        next === "dark" ? "Activer le thème sombre" : "Activer le thème clair"
      }
      title={next === "dark" ? "Thème sombre" : "Thème clair"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
