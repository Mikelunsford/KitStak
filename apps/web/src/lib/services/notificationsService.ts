// Notifications service. Wraps collaboration-api notification routes.

import { apiRequest } from '@/lib/apiClient';
import {
  NotificationSchema,
  type Notification,
} from '@/lib/types/cross_cutting';
import { z } from 'zod';

const ListSchema = z.object({ items: z.array(NotificationSchema) });

export async function listNotifications(): Promise<Notification[]> {
  const data = await apiRequest<unknown>('/collaboration-api/notifications', {
    method: 'GET',
  });
  const parsed = ListSchema.safeParse(data);
  if (!parsed.success) throw new Error('notifications list invalid envelope');
  return parsed.data.items;
}

export async function markNotificationRead(id: string): Promise<Notification> {
  const data = await apiRequest<unknown>(
    `/collaboration-api/notifications/${encodeURIComponent(id)}/read`,
    { method: 'POST', body: {} },
  );
  return NotificationSchema.parse(data);
}
