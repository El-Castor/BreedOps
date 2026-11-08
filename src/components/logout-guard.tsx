"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import {
  clearProfileOfflineData,
  countUnsyncedOperationsForProfile,
} from "@/lib/offline/db";

const ACTIVE_PROFILE_KEY = "breedops-offline-active-profile";

/** Clears both the IndexedDB data and the remembered-profile localStorage
 * key together - leaving the key behind would let /field silently pick
 * the previous user's (by-then-empty) profile back up after a different
 * user signs in on the same device without ever visiting an authenticated
 * page first (V2-07 §24). */
async function clearProfileEverywhere(profileId: string) {
  await clearProfileOfflineData(profileId);
  try {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } catch {
    /* best-effort only - see docs/OFFLINE_PWA.md's local-storage trust model */
  }
}

/** Wraps the existing /auth/logout form with the user-scoped offline-data
 * guard V2-07 §24 requires: "Never expose user A's offline pack to user
 * B." On an ordinary logout with nothing unsynchronized, this clears the
 * profile's IndexedDB data (packs, outbox, sync state) before the real
 * POST goes through, so no cached scientific data belonging to the
 * previous user remains reachable from the UI. If unsynchronized
 * operations exist, logout is blocked by default - never silently erased
 * - with an explicit, strongly-confirmed "discard and log out anyway"
 * escape hatch for when the user genuinely wants it. */
export function LogoutForm({ profileId }: { profileId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const count = await countUnsyncedOperationsForProfile(profileId);
    if (count === 0) {
      await clearProfileEverywhere(profileId);
      formRef.current?.submit();
      return;
    }
    setPendingCount(count);
    setBlocked(true);
  }

  async function discardAndLogout() {
    setBusy(true);
    try {
      await clearProfileEverywhere(profileId);
      formRef.current?.submit();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        ref={formRef}
        action="/auth/logout"
        method="post"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <button className="menu-action">
          <Icon name="logout" />
          Déconnexion
        </button>
      </form>
      {blocked ? (
        <div
          className="field-pack-confirm logout-guard-confirm"
          role="alertdialog"
          aria-label="Évaluations hors ligne non synchronisées"
        >
          {!confirmingDiscard ? (
            <>
              <p role="alert">
                {pendingCount} évaluation(s) saisie(s) hors ligne n’ont pas
                encore été synchronisées avec le serveur. Reconnectez-vous au
                réseau et synchronisez avant de vous déconnecter, pour ne pas
                perdre ces observations.
              </p>
              <div className="field-pack-actions">
                <button type="button" onClick={() => setBlocked(false)}>
                  Retour pour synchroniser
                </button>
                <button
                  type="button"
                  className="quiet danger"
                  onClick={() => setConfirmingDiscard(true)}
                >
                  Se déconnecter sans synchroniser
                </button>
              </div>
            </>
          ) : (
            <>
              <p role="alert">
                {pendingCount} évaluation(s) non synchronisée(s) seront
                définitivement perdues. Cette action est irréversible.
              </p>
              <div className="field-pack-actions">
                <button
                  type="button"
                  className="danger"
                  onClick={() => void discardAndLogout()}
                  disabled={busy}
                >
                  Confirmer : abandonner ces évaluations et se déconnecter
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmingDiscard(false)}
                  disabled={busy}
                >
                  Annuler
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
