// Comments service. Wraps collaboration-api comment routes.

import { apiRequest } from '@/lib/apiClient';
import {
  CommentSchema,
  CommentCreateSchema,
  type Comment,
  type CommentCreate,
} from '@/lib/types/cross_cutting';
import { z } from 'zod';

const ListSchema = z.object({
  items: z.array(CommentSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listComments(
  entityType: string,
  entityId: string,
): Promise<Comment[]> {
  const data = await apiRequest<unknown>(
    `/collaboration-api/comments?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
    { method: 'GET' },
  );
  const parsed = ListSchema.safeParse(data);
  if (!parsed.success) throw new Error('comments list invalid envelope');
  return parsed.data.items;
}

export async function createComment(input: CommentCreate): Promise<Comment> {
  const body = CommentCreateSchema.parse(input);
  const data = await apiRequest<unknown>('/collaboration-api/comments', {
    method: 'POST',
    body,
  });
  return CommentSchema.parse(data);
}

export async function deleteComment(id: string): Promise<void> {
  await apiRequest<unknown>(`/collaboration-api/comments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
