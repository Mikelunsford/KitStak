// NotificationsBell. Topbar slot.
//
// Reads the caller's notifications via useNotifications(); shows a count
// badge of unread entries and a popover with the most-recent items. Each
// row's "Mark read" button triggers useMarkNotificationRead.

import { useState } from 'react';
import { Bell } from 'lucide-react';

import {
  useNotifications,
  useMarkNotificationRead,
} from '@/lib/hooks/useCrossCutting';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const query = useNotifications();
  const markRead = useMarkNotificationRead();

  const items = query.data ?? [];
  const unread = items.filter((n) => n.read_at === null);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-1 p-1 hover:bg-bg-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-ink-dim" />
        {unread.length > 0 ? (
          <span
            className="absolute -right-0 -top-0 inline-flex h-4 min-w-4 items-center justify-center rounded-none bg-accent px-1 text-[10px] font-medium text-on-primary"
            aria-label={`${unread.length} unread`}
          >
            {unread.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-80 max-h-96 overflow-y-auto border border-line bg-bg p-2 shadow-lg"
        >
          {query.isLoading ? (
            <p className="px-2 py-1 text-sm text-ink-dim">Loading.</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-1 text-sm text-ink-dim">No notifications.</p>
          ) : (
            <ul className="flex flex-col">
              {items.map((n) => (
                <li
                  key={n.id}
                  className="flex flex-col gap-1 border-b border-line px-2 py-2 last:border-b-0"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-ink">{n.subject}</span>
                    {n.read_at === null ? (
                      <button
                        type="button"
                        onClick={() => markRead.mutate(n.id)}
                        className="text-xs text-ink-dim hover:text-ink"
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                  {n.body ? (
                    <p className="text-xs text-ink-dim">{n.body}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
