import { listOperationsForProfile } from "./db";

export interface OutboxSummary {
  pending: number;
  syncing: number;
  conflicts: number;
  failed: number;
  synced: number;
  total: number;
}

/** Shared by the field workspace's own status line and the app-wide
 * indicator (src/components/app-shell.tsx) so the two can never disagree
 * about what "N pending" means. */
export async function summarizeOutbox(
  profileId: string,
): Promise<OutboxSummary> {
  const ops = await listOperationsForProfile(profileId);
  const summary: OutboxSummary = {
    pending: 0,
    syncing: 0,
    conflicts: 0,
    failed: 0,
    synced: 0,
    total: ops.length,
  };
  for (const op of ops) {
    if (op.status === "PENDING" || op.status === "DRAFT") summary.pending += 1;
    else if (op.status === "SYNCING") summary.syncing += 1;
    else if (op.status === "CONFLICT") summary.conflicts += 1;
    else if (op.status === "FAILED") summary.failed += 1;
    else if (op.status === "SYNCED") summary.synced += 1;
  }
  return summary;
}
