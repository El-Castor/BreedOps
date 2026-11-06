"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Served by the service worker as the navigation fallback (see src/app/sw.ts)
// whenever an uncached, online-only BreedOps route is requested while
// offline. Deliberately static and unauthenticated: it is precached at
// service-worker install time, so it must never depend on a live session or
// database read, and it must render correctly even when nothing else in the
// app can reach the network.
export default function OfflinePage() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <main className="offline-shell">
      <div className="card offline-card">
        <p className="offline-status" aria-live="polite">
          <span
            className={`status-dot ${online ? "status-dot-ok" : "status-dot-warn"}`}
            aria-hidden="true"
          />
          {online === null
            ? "Vérification de la connexion…"
            : online
              ? "Connexion rétablie — cette page reste accessible même hors ligne."
              : "Vous êtes actuellement hors ligne."}
        </p>
        <h1>Cette page nécessite une connexion</h1>
        <p>
          La page demandée n&apos;a pas pu être chargée car votre appareil
          n&apos;a pas de connexion réseau utilisable pour le moment. Certaines
          fonctionnalités de BreedOps restent toutefois disponibles hors ligne.
        </p>
        <div className="offline-columns">
          <section>
            <h2>Disponible hors ligne</h2>
            <ul>
              <li>Essais préalablement préparés pour le terrain</li>
              <li>Saisie de phénotypes sur les essais préparés</li>
              <li>
                Consultation des évaluations en attente de synchronisation
              </li>
            </ul>
          </section>
          <section>
            <h2>Nécessite une connexion</h2>
            <ul>
              <li>Analyses statistiques et décisions de sélection</li>
              <li>Administration et gestion des utilisateurs</li>
              <li>Import / export et configuration des programmes</li>
              <li>Synchronisation des évaluations en attente</li>
            </ul>
          </section>
        </div>
        <Link className="button-link" href="/field">
          Ouvrir l&apos;espace terrain hors ligne
        </Link>
      </div>
    </main>
  );
}
