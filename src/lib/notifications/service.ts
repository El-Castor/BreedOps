import "server-only";
import type { createClient } from "@/lib/supabase/server";

type DbClient = Awaited<ReturnType<typeof createClient>>;

export type NotificationItem = {
  id: string;
  category: "task_overdue" | "task_due_soon" | "stock_low" | "lot_expiring";
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationFeed = {
  items: NotificationItem[];
  unreadCount: number;
};

const EMPTY_FEED: NotificationFeed = { items: [], unreadCount: 0 };
const FEED_LIMIT = 50;

// Called once per authenticated page load (src/app/app/layout.tsx) - no
// cron/scheduler exists yet in this architecture (audited: no pg_cron
// extension, no scheduled GitHub Actions workflow), so this is the only
// place conditions are currently (re-)evaluated. sync_notifications_for_team
// is itself cheap (a handful of indexed scans) and fully idempotent, so
// calling it on every page load is safe; it is designed to also be callable
// unchanged from a future pg_cron job or scheduled Edge Function the moment
// one exists - see the migration header for the documented runtime gap.
export async function syncAndListNotifications(
  client: DbClient,
  organizationId: string,
): Promise<NotificationFeed> {
  const { error: syncError } = await client.rpc("sync_notifications_for_team", {
    target_organization_id: organizationId,
  });
  if (syncError) {
    // A sync failure must never break the page it would otherwise just be
    // a bell icon on - surface an empty, harmless feed instead.
    console.error("sync_notifications_for_team failed", syncError);
    return EMPTY_FEED;
  }
  const [{ data, error }, unread] = await Promise.all([
    client
      .from("notifications")
      .select("id,category,severity,title,body,link_path,read_at,created_at")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    // Counted separately (not derived from the limited list above) so the
    // badge stays correct even past FEED_LIMIT.
    client
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .is("read_at", null),
  ]);
  if (error || !data) return EMPTY_FEED;
  return {
    items: data.map((row) => ({
      id: row.id,
      category: row.category,
      severity: row.severity,
      title: row.title,
      body: row.body,
      linkPath: row.link_path,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    unreadCount: unread.count ?? 0,
  };
}
