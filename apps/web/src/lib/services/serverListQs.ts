// Shared query-string builder for the server-driven list pages (Workstream C of
// the 2026-06-17 UI scan). The paged service functions (listQuotesPage,
// listInvoicesPage, ...) turn the toolbar's ServerListParams into the edge query
// string: search, sort_by, sort_dir, cursor, plus the entity's facets.

export type SortDir = 'asc' | 'desc';

export interface ServerListParams {
  search: string;
  sort_by: string;
  sort_dir: SortDir;
  cursor: string | null;
  facets: Record<string, string>;
}

export function serverListQs(params: ServerListParams): string {
  const p = new URLSearchParams();
  if (params.search) p.set('search', params.search);
  if (params.sort_by) p.set('sort_by', params.sort_by);
  if (params.sort_dir) p.set('sort_dir', params.sort_dir);
  if (params.cursor) p.set('cursor', params.cursor);
  for (const [key, value] of Object.entries(params.facets)) {
    if (value) p.set(key, value);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Read next_cursor out of a response meta block (invoices/customers shape). */
export function metaCursor(meta: Record<string, unknown> | undefined): string | null {
  const cursor = meta?.next_cursor;
  return typeof cursor === 'string' ? cursor : null;
}
