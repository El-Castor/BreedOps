// Service-worker update detection (V2-07 §27). @serwist/next registers the
// service worker itself (next.config.mjs's withSerwist, `register: true`,
// its default) - this only ever OBSERVES that already-registered
// ServiceWorkerRegistration for a waiting worker, it never calls
// `register()` itself (that would create a second, redundant registration
// attempt).

export function watchForServiceWorkerUpdate(
  onUpdateAvailable: () => void,
): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  let cancelled = false;
  const stateChangeListeners: Array<() => void> = [];

  function handleRegistration(registration: ServiceWorkerRegistration) {
    if (cancelled) return;
    // A worker can already be sitting in `waiting` by the time this runs
    // (e.g. the tab was open across a deploy) - not just one discovered via
    // a later `updatefound`.
    if (registration.waiting && navigator.serviceWorker.controller) {
      onUpdateAvailable();
    }
    const onUpdateFound = () => {
      const installing = registration.installing;
      if (!installing) return;
      const onStateChange = () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          onUpdateAvailable();
        }
      };
      installing.addEventListener("statechange", onStateChange);
      stateChangeListeners.push(() =>
        installing.removeEventListener("statechange", onStateChange),
      );
    };
    registration.addEventListener("updatefound", onUpdateFound);
    stateChangeListeners.push(() =>
      registration.removeEventListener("updatefound", onUpdateFound),
    );
  }

  void navigator.serviceWorker.getRegistration().then((registration) => {
    if (registration) handleRegistration(registration);
  });

  return () => {
    cancelled = true;
    for (const remove of stateChangeListeners) remove();
  };
}

/** Tells the waiting worker to activate, then reloads once it actually
 * takes control - only ever called from a user-initiated click (the
 * update prompt component), never automatically. */
export async function applyServiceWorkerUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.waiting) return;
  const reloadOnce = () => window.location.reload();
  navigator.serviceWorker.addEventListener("controllerchange", reloadOnce, {
    once: true,
  });
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
}
