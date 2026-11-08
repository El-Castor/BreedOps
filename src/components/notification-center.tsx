"use client";

import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/ui";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import type { NotificationItem } from "@/lib/notifications/service";

const toneByCategory: Record<
  NotificationItem["category"],
  "danger" | "warning" | "info"
> = {
  task_overdue: "danger",
  task_due_soon: "warning",
  stock_low: "warning",
  lot_expiring: "warning",
};

const categoryLabels: Record<NotificationItem["category"], string> = {
  task_overdue: "Tâche en retard",
  task_due_soon: "Échéance proche",
  stock_low: "Stock faible",
  lot_expiring: "Péremption proche",
};

function relativeDay(iso: string): string {
  const diffDays = Math.round(
    (Date.now() - new Date(iso).getTime()) / 86_400_000,
  );
  if (diffDays <= 0) return "Aujourd’hui";
  if (diffDays === 1) return "Hier";
  return `Il y a ${diffDays} j`;
}

export function NotificationCenter({
  items,
  unreadCount,
}: {
  items: NotificationItem[];
  unreadCount: number;
}) {
  return (
    <details className="notification-center">
      <summary
        className="icon-button"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? "s" : ""}`
            : "Notifications"
        }
        title="Notifications"
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </summary>
      <div className="notification-popover">
        <div className="notification-popover-header">
          <p className="menu-label">Notifications</p>
          {unreadCount > 0 && (
            <form
              action={markAllNotificationsRead}
              data-action="mark-all-notifications-read"
            >
              <button type="submit" className="link-button">
                Tout marquer comme lu
              </button>
            </form>
          )}
        </div>
        {items.length === 0 ? (
          <p className="notification-empty">
            Aucune notification pour le moment.
          </p>
        ) : (
          <ul className="notification-list" role="list">
            {items.map((item) => (
              <li
                key={item.id}
                className={`notification-item${item.readAt ? "" : " unread"}`}
              >
                <form
                  action={markNotificationRead}
                  data-action="mark-notification-read"
                >
                  <input type="hidden" name="id" value={item.id} />
                  {item.linkPath && (
                    <input type="hidden" name="next" value={item.linkPath} />
                  )}
                  <button type="submit" className="notification-row">
                    <StatusBadge tone={toneByCategory[item.category]}>
                      {categoryLabels[item.category]}
                    </StatusBadge>
                    <span className="notification-text">
                      <strong>{item.title}</strong>
                      {item.body && <small>{item.body}</small>}
                    </span>
                    <time
                      className="notification-time"
                      dateTime={item.createdAt}
                    >
                      {relativeDay(item.createdAt)}
                    </time>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
