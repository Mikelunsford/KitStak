// useServerList. The toolbar state machine for the server-driven list pages
// (Workstream C of the 2026-06-17 UI scan). One hook owns the debounced search,
// the URL-synced sort and facets, the keyset cursor stack, and the TanStack
// query, so each list page stays thin: declare columns + facets, call this, and
// render ListToolbar + DataTable (sortable) + CursorPager.
//
// URL sync: sort and facets live in the URL search params (so the dashboard's
// ?state= deep-link keeps working and a filtered view is shareable). The free
// text search is local + debounced and mirrored to the URL on settle. The
// keyset cursor is local state (cursors are ephemeral, not shareable) and resets
// whenever the search, sort, or any facet changes.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { SortDir } from '@/components/ui/DataTable';
import type { FilterChip } from '@/components/ui/FilterBar';
import type { ServerListParams } from '@/lib/services/serverListQs';

import { useDebouncedValue } from './useDebouncedValue';

export type { ServerListParams } from '@/lib/services/serverListQs';

export interface ServerListPage<TRow> {
  items: TRow[];
  next_cursor: string | null;
}

export interface ServerListFacet {
  /** URL param name and the facet key sent to the edge (e.g. 'state', 'kind'). */
  key: string;
  /** Chip label prefix, e.g. 'Status'. */
  label: string;
  /** Optional value humanizer for the chip text. */
  format?: (value: string) => string;
  /** A boolean toggle facet ('true'/''); its chip shows just the label. */
  toggle?: boolean;
}

export interface UseServerListConfig<TRow> {
  /** Feature flag: when false the query is disabled (the page uses its legacy path). */
  enabled: boolean;
  /** Base query key for cache isolation, e.g. quotesKeys.all. */
  queryKeyBase: readonly unknown[];
  /** Fetches one keyset page from the entity service. */
  fetchPage: (params: ServerListParams) => Promise<ServerListPage<TRow>>;
  defaultSort: { by: string; dir: SortDir };
  /** URL-synced facets. */
  facets: readonly ServerListFacet[];
}

export interface UseServerListResult<TRow> {
  rows: TRow[];
  isLoading: boolean;
  isError: boolean;
  searchInput: string;
  setSearchInput: (value: string) => void;
  facetValues: Record<string, string>;
  setFacet: (key: string, value: string) => void;
  chips: FilterChip[];
  clearAll: () => void;
  sortBy: string;
  sortDir: SortDir;
  onSort: (sortKey: string) => void;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function useServerList<TRow>(
  config: UseServerListConfig<TRow>,
): UseServerListResult<TRow> {
  const { enabled, queryKeyBase, fetchPage, defaultSort, facets } = config;
  const [searchParams, setSearchParams] = useSearchParams();

  // Sort + facets read straight from the URL (shareable, deep-linkable).
  const sortBy = searchParams.get('sort_by') ?? defaultSort.by;
  const rawDir = searchParams.get('sort_dir');
  const sortDir: SortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : defaultSort.dir;

  const facetValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of facets) {
      const v = searchParams.get(f.key);
      if (v) out[f.key] = v;
    }
    return out;
  }, [searchParams, facets]);

  // Search is local + debounced; mirrored to the URL once it settles.
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') ?? '');
  const search = useDebouncedValue(searchInput, 300).trim();

  function mutateParams(mutate: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  }

  // Mirror the debounced search into the URL so a filtered view is shareable.
  // The functional setSearchParams form reads the latest params (no stale
  // searchParams closure), so a concurrent sort or facet change in the narrow
  // debounce window is never dropped.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        if ((prev.get('search') ?? '') === search) return prev;
        const next = new URLSearchParams(prev);
        if (search) next.set('search', search);
        else next.delete('search');
        return next;
      },
      { replace: true },
    );
  }, [search, setSearchParams]);

  function onSort(sortKey: string) {
    mutateParams((p) => {
      if (sortKey === sortBy) {
        p.set('sort_dir', sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        p.set('sort_by', sortKey);
        p.set('sort_dir', 'asc');
      }
    });
  }

  function setFacet(key: string, value: string) {
    mutateParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });
  }

  function clearAll() {
    setSearchInput('');
    mutateParams((p) => {
      p.delete('search');
      for (const f of facets) p.delete(f.key);
    });
  }

  // Keyset cursor stack. The current page's cursor is the last pushed entry;
  // Next pushes the result's next_cursor, Prev pops. The stack resets whenever
  // the filter signature changes so a new query always starts at page one.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const cursor = cursorStack.length > 0 ? cursorStack[cursorStack.length - 1]! : null;

  const facetSignature = JSON.stringify(facetValues);
  useEffect(() => {
    setCursorStack([]);
  }, [search, sortBy, sortDir, facetSignature]);

  const params: ServerListParams = {
    search,
    sort_by: sortBy,
    sort_dir: sortDir,
    cursor,
    facets: facetValues,
  };

  const query = useQuery({
    queryKey: [...queryKeyBase, 'server-list', params],
    queryFn: () => fetchPage(params),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.items ?? [];
  const nextCursor = query.data?.next_cursor ?? null;

  const chips: FilterChip[] = [];
  if (search) {
    chips.push({
      key: 'search',
      label: `Search: ${search}`,
      onClear: () => {
        setSearchInput('');
        mutateParams((p) => p.delete('search'));
      },
    });
  }
  for (const f of facets) {
    const value = facetValues[f.key];
    if (value) {
      chips.push({
        key: f.key,
        label: f.toggle ? f.label : `${f.label}: ${f.format ? f.format(value) : value}`,
        onClear: () => setFacet(f.key, ''),
      });
    }
  }

  return {
    rows,
    isLoading: query.isLoading,
    isError: query.isError,
    searchInput,
    setSearchInput,
    facetValues,
    setFacet,
    chips,
    clearAll,
    sortBy,
    sortDir,
    onSort,
    canPrev: cursorStack.length > 0,
    // Guard Next against a double-click during the in-flight page fetch: while
    // keepPreviousData holds the prior page, nextCursor still points at the same
    // cursor, so an unguarded second click would push it twice and corrupt the
    // stack depth.
    canNext: Boolean(nextCursor) && !query.isFetching,
    onPrev: () => setCursorStack((s) => s.slice(0, -1)),
    onNext: () => {
      if (nextCursor && !query.isFetching) setCursorStack((s) => [...s, nextCursor]);
    },
  };
}
