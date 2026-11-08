"use client";

import { useEffect, useState } from "react";
import {
  applyServiceWorkerUpdate,
  watchForServiceWorkerUpdate,
} from "@/lib/offline/sw-update";

/** Mounted once in the root layout (src/app/layout.tsx) so it covers every
 * route, including /field and /offline. Shown only once a new service
 * worker is actually waiting to activate - the reload it triggers is
 * always the user's own choice (V2-07 §27), never automatic, so it never
 * discards an in-progress offline form on its own. */
export function ServiceWorkerUpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(
    () => watchForServiceWorkerUpdate(() => setUpdateAvailable(true)),
    [],
  );

  if (!updateAvailable) return null;

  return (
    <div role="alert" className="sw-update-banner">
      <span>Une nouvelle version de BreedOps est disponible.</span>
      <button
        type="button"
        disabled={updating}
        onClick={() => {
          setUpdating(true);
          void applyServiceWorkerUpdate();
        }}
      >
        {updating ? "Mise à jour…" : "Mettre à jour maintenant"}
      </button>
      <button
        type="button"
        className="quiet"
        onClick={() => setUpdateAvailable(false)}
      >
        Plus tard
      </button>
    </div>
  );
}
