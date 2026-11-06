"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { summarizeOutbox } from "@/lib/offline/outbox-summary";

const ACTIVE_PROFILE_KEY = "breedops-offline-active-profile";
const POLL_INTERVAL_MS = 15_000;

/** Persistent but unobtrusive app-wide sync indicator (V2-07 §21). Reads
 * IndexedDB directly - never a server round-trip - so it never claims a
 * state it cannot actually back up to a visible queue the user can open.
 * Renders nothing at all for a profile that has never used offline mode
 * (summary.total === 0): this is a reminder for people who have queued
 * work, not a permanent fixture of the header. Clicking it opens
 * /app/field-packs, where the full outbox detail lives (§21: "clicking
 * opens sync details"). */
export function OfflineIndicator({ profileId }: { profileId: string }) {
  const [summary, setSummary] = useState<{
    pending: number;
    conflicts: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
    } catch {
      /* best-effort only - see docs/OFFLINE_PWA.md's local-storage trust model */
    }
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const result = await summarizeOutbox(profileId);
      if (!cancelled) {
        setSummary({
          pending: result.pending + result.syncing + result.failed,
          conflicts: result.conflicts,
          total: result.total,
        });
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [profileId]);

  if (!summary || summary.total === 0) return null;

  const tone =
    summary.conflicts > 0 ? "danger" : summary.pending > 0 ? "warn" : "ok";
  const label =
    summary.conflicts > 0
      ? `Conflit · ${summary.conflicts}`
      : summary.pending > 0
        ? `${summary.pending} en attente`
        : "Synchronisé";

  return (
    <Link href="/app/field-packs" className="offline-indicator">
      <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />
      {label}
    </Link>
  );
}
