"use client";

import { ErrorState } from "@/components/ui";

export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="page">
      <ErrorState message="Une erreur empêche l’affichage de cette page." />
      <button onClick={reset}>Réessayer</button>
    </div>
  );
}
