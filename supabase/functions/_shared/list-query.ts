// list-query.ts. Shared helpers for the server-side list toolbar (Workstream C
// of the 2026-06-17 UI scan): free-text search, sortable columns, and keyset
// pagination keyed on the active sort column.
//
// Used by the list handlers in quotes-api, invoicing-api, crm-api customers,
// and sales-config-api items. Pure functions only (no Supabase client, no Deno
// runtime APIs beyond btoa/atob) so the filter-query building is unit-tested
// directly; the integration is the handler that composes them onto a query.
//
// Keyset design: the cursor carries the active sort column's value plus the row
// id as a stable tiebreak. Sortable columns are a per-entity allowlist of NOT
// NULL columns, so the keyset comparison never straddles a NULL. The money and
// date facets the scan calls for (open balance, aging buckets) are FILTERS, not
// sorts, so a nullable column never enters the cursor.
//
// Grammar safety: search and keyset values are double-quoted (internal quotes
// doubled) before they enter a PostgREST .or() expression, so a comma, paren,
// or quote in the value cannot break out of the grammar. Mirrors the escaping
// search-api already ships.
//
// Filter combining: a list handler applies search and keyset as two SEPARATE
// .or() calls on the same query. supabase-js serializes each as its own
// `or=(...)` query parameter, and PostgREST AND-combines independent top-level
// filters, so the effective predicate is (search) AND (keyset). This holds on
// the PostgREST version Supabase ships. The keyset .or() only co-occurs with
// the search .or() when paging a filtered result past the first page, so at
// current row counts (well under one page) the two never combine in practice.

import { ApiError } from './responses.ts';

export type SortDir = 'asc' | 'desc';

export interface SortSpec {
  column: string;
  dir: SortDir;
}

export interface SortCursor {
  /** The active sort column's value on the overflow row. */
  v: string;
  /** The overflow row id, the stable tiebreak. */
  id: string;
}

/** Escape PostgREST ILIKE wildcards so a literal %, _, or \ matches as text. */
export function escapeIlike(term: string): string {
  return term.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/** Quote a value for a PostgREST filter expression, doubling internal quotes. */
function quoteVal(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

/**
 * Render a PostgREST .or() ILIKE fragment matching `term` across `cols`. The
 * value is wrapped in `*` wildcards and double-quoted so special characters
 * cannot break the .or() grammar.
 */
export function buildSearchOr(cols: readonly string[], term: string): string {
  const safe = `*${escapeIlike(term).replace(/"/g, '""')}*`;
  return cols.map((c) => `${c}.ilike."${safe}"`).join(',');
}

/** Read the search term from ?search (preferred) or the legacy ?q. */
export function parseSearch(url: URL): string {
  return (url.searchParams.get('search') ?? url.searchParams.get('q') ?? '').trim();
}

/**
 * Parse ?sort_by and ?sort_dir against an allowlist, falling back to `def`. An
 * unknown column or direction is ignored (defended against), never passed to
 * the query, so a client cannot order by an arbitrary or non-existent column.
 */
export function parseSort(
  url: URL,
  allowed: readonly string[],
  def: SortSpec,
): SortSpec {
  const by = url.searchParams.get('sort_by');
  const dir = url.searchParams.get('sort_dir');
  return {
    column: by && allowed.includes(by) ? by : def.column,
    dir: dir === 'asc' || dir === 'desc' ? dir : def.dir,
  };
}

// UTF-8 safe: encodeURIComponent first so a sort value with non-Latin-1
// characters (a quote title or customer name in CJK, accents, etc.) does not
// throw in btoa. decodeSortCursor mirrors with decodeURIComponent.
export function encodeSortCursor(c: SortCursor): string {
  return btoa(encodeURIComponent(JSON.stringify(c)));
}

/**
 * Decode an opaque sort cursor. A malformed or non-conforming cursor throws
 * VALIDATION_ERROR rather than silently restarting at page 1, so a client bug
 * surfaces instead of quietly capping pagination. Absent cursor returns null.
 */
export function decodeSortCursor(raw: string | null): SortCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(atob(raw))) as Partial<SortCursor>;
    if (typeof parsed.v !== 'string' || typeof parsed.id !== 'string') {
      throw new ApiError('VALIDATION_ERROR', 422, 'invalid cursor');
    }
    return { v: parsed.v, id: parsed.id };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('VALIDATION_ERROR', 422, 'invalid cursor');
  }
}

/**
 * Build the PostgREST .or() fragment selecting rows strictly AFTER `cursor` in
 * the order (sort.column sort.dir, id sort.dir):
 *   asc:  col > v OR (col = v AND id > id)
 *   desc: col < v OR (col = v AND id < id)
 * Values are quoted; PostgREST casts the quoted value to the column type, so
 * the same fragment is correct for text, numeric, and timestamp columns.
 */
export function buildKeysetOr(sort: SortSpec, cursor: SortCursor): string {
  const op = sort.dir === 'asc' ? 'gt' : 'lt';
  const v = quoteVal(cursor.v);
  const id = quoteVal(cursor.id);
  return `${sort.column}.${op}.${v},and(${sort.column}.eq.${v},id.${op}.${id})`;
}

/**
 * Build the canonical { items, next_cursor } page from a query that asked for
 * limit + 1 rows ordered by (column, id). The overflow row's `column` value and
 * id become the next cursor. Mirrors handler-helpers `paginate()` but keys the
 * cursor on the active sort column instead of always created_at.
 */
export function paginateSorted<T extends Record<string, unknown> & { id: string }>(
  rows: T[],
  limit: number,
  column: string,
): { items: T[]; next_cursor: string | null } {
  if (rows.length <= limit) return { items: rows, next_cursor: null };
  const items = rows.slice(0, limit);
  const overflow = rows[limit];
  const value = overflow[column];
  // The sort allowlists are NOT NULL columns, so the cursor value is never
  // null. If a future allowlist entry breaks that invariant, fail loud rather
  // than emit a semantically wrong cursor (col.lt."" would silently mis-page
  // a text column or 500 on a numeric cast).
  if (value === null || value === undefined) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `cannot paginate: sort column "${column}" is null on the cursor row`,
    );
  }
  return {
    items,
    next_cursor: encodeSortCursor({ v: String(value), id: overflow.id }),
  };
}
