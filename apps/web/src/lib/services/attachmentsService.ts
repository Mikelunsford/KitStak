// Attachments service. Wraps collaboration-api attachment routes.

import { apiRequest } from '@/lib/apiClient';
import {
  AttachmentSchema,
  AttachmentCreateSchema,
  type Attachment,
  type AttachmentCreate,
} from '@/lib/types/cross_cutting';
import { z } from 'zod';

const ListSchema = z.object({
  items: z.array(AttachmentSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listAttachments(
  entityType: string,
  entityId: string,
): Promise<Attachment[]> {
  const data = await apiRequest<unknown>(
    `/collaboration-api/attachments?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
    { method: 'GET' },
  );
  const parsed = ListSchema.safeParse(data);
  if (!parsed.success) throw new Error('attachments list invalid envelope');
  return parsed.data.items;
}

export async function createAttachment(
  input: AttachmentCreate,
): Promise<Attachment> {
  const body = AttachmentCreateSchema.parse(input);
  const data = await apiRequest<unknown>('/collaboration-api/attachments', {
    method: 'POST',
    body,
  });
  return AttachmentSchema.parse(data);
}

export async function deleteAttachment(id: string): Promise<void> {
  await apiRequest<unknown>(`/collaboration-api/attachments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
