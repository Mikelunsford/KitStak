// Saved views service.

import { apiRequest } from '@/lib/apiClient';
import {
  SavedViewSchema,
  SavedViewCreateSchema,
  type SavedView,
  type SavedViewCreate,
} from '@/lib/types/cross_cutting';
import { z } from 'zod';

const ListSchema = z.array(SavedViewSchema);

export async function listSavedViews(entityType: string): Promise<SavedView[]> {
  const data = await apiRequest<unknown>(
    `/collaboration-api/saved-views?entity_type=${encodeURIComponent(entityType)}`,
    { method: 'GET' },
  );
  const parsed = ListSchema.safeParse(data);
  if (!parsed.success) throw new Error('saved-views list invalid envelope');
  return parsed.data;
}

export async function createSavedView(
  input: SavedViewCreate,
): Promise<SavedView> {
  const body = SavedViewCreateSchema.parse(input);
  const data = await apiRequest<unknown>('/collaboration-api/saved-views', {
    method: 'POST',
    body,
  });
  return SavedViewSchema.parse(data);
}

export async function deleteSavedView(id: string): Promise<void> {
  await apiRequest<unknown>(`/collaboration-api/saved-views/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
