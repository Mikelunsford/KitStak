// Search service. Wraps GET /search-api/search?q=...

import { apiRequest } from '@/lib/apiClient';
import { SearchResultSchema, type SearchResult } from '@/lib/types/cross_cutting';

export async function globalSearch(query: string): Promise<SearchResult> {
  const data = await apiRequest<unknown>(
    `/search-api/search?q=${encodeURIComponent(query)}`,
    { method: 'GET' },
  );
  return SearchResultSchema.parse(data);
}
