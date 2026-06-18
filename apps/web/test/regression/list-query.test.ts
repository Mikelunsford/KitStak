// Unit tests for the Workstream C list-query helpers (2026-06-17 UI scan).
// These are the pure filter-query builders the list handlers compose onto a
// PostgREST query: search ILIKE fragments, sort-param parsing against an
// allowlist, the keyset cursor (encode/decode plus the .or() predicate), and
// the sorted paginator. The Supabase mock used by the handler regression
// suites does not reproduce .or()/.ilike(), so this is where the query-building
// logic is locked.

import { describe, it, expect } from 'vitest';

import {
  buildKeysetOr,
  buildSearchOr,
  decodeSortCursor,
  encodeSortCursor,
  escapeIlike,
  paginateSorted,
  parseSearch,
  parseSort,
  type SortSpec,
} from '../../../../supabase/functions/_shared/list-query.ts';

function u(qs: string): URL {
  return new URL(`https://example.test/list?${qs}`);
}

describe('escapeIlike', () => {
  it('escapes %, _, and backslash so they match literally', () => {
    expect(escapeIlike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
  it('leaves ordinary text untouched', () => {
    expect(escapeIlike('Smoke Co.')).toBe('Smoke Co.');
  });
});

describe('buildSearchOr', () => {
  it('wraps the term in wildcards and quotes each column ilike', () => {
    expect(buildSearchOr(['number', 'title'], 'tetris')).toBe(
      'number.ilike."*tetris*",title.ilike."*tetris*"',
    );
  });
  it('doubles internal quotes and escapes wildcards in the term', () => {
    expect(buildSearchOr(['sku'], 'a"b%c')).toBe('sku.ilike."*a""b\\%c*"');
  });
});

describe('parseSearch', () => {
  it('prefers ?search over ?q and trims', () => {
    expect(parseSearch(u('search=%20widget%20&q=other'))).toBe('widget');
  });
  it('falls back to ?q when search is absent', () => {
    expect(parseSearch(u('q=acme'))).toBe('acme');
  });
  it('returns empty string when neither is present', () => {
    expect(parseSearch(u('limit=50'))).toBe('');
  });
});

describe('parseSort', () => {
  const allowed = ['created_at', 'total_cents', 'state', 'number'] as const;
  const def: SortSpec = { column: 'created_at', dir: 'desc' };

  it('accepts an allowlisted column and direction', () => {
    expect(parseSort(u('sort_by=total_cents&sort_dir=asc'), allowed, def)).toEqual({
      column: 'total_cents',
      dir: 'asc',
    });
  });
  it('falls back to the default column when sort_by is not allowlisted', () => {
    expect(parseSort(u('sort_by=evil_col&sort_dir=asc'), allowed, def)).toEqual({
      column: 'created_at',
      dir: 'asc',
    });
  });
  it('falls back to the default direction when sort_dir is invalid', () => {
    expect(parseSort(u('sort_by=number&sort_dir=sideways'), allowed, def)).toEqual({
      column: 'number',
      dir: 'desc',
    });
  });
  it('returns the default when no sort params are present', () => {
    expect(parseSort(u('limit=50'), allowed, def)).toEqual(def);
  });
});

describe('sort cursor encode/decode', () => {
  it('round-trips a cursor', () => {
    const c = { v: '2026-06-17T00:00:00Z', id: 'abc' };
    expect(decodeSortCursor(encodeSortCursor(c))).toEqual(c);
  });
  it('round-trips a cursor with non-ASCII sort values (UTF-8 safe)', () => {
    const c = { v: 'Fizz 日本語 Co.', id: 'abc' };
    expect(decodeSortCursor(encodeSortCursor(c))).toEqual(c);
  });
  it('returns null for an absent cursor', () => {
    expect(decodeSortCursor(null)).toBeNull();
  });
  it('throws on a malformed cursor', () => {
    expect(() => decodeSortCursor('not-base64-json')).toThrow();
  });
  it('throws on a cursor missing required fields', () => {
    expect(() => decodeSortCursor(btoa(JSON.stringify({ v: 'x' })))).toThrow();
  });
});

describe('buildKeysetOr', () => {
  it('uses gt for ascending order', () => {
    expect(buildKeysetOr({ column: 'number', dir: 'asc' }, { v: 'Q-5', id: 'i1' })).toBe(
      'number.gt."Q-5",and(number.eq."Q-5",id.gt."i1")',
    );
  });
  it('uses lt for descending order', () => {
    expect(
      buildKeysetOr({ column: 'created_at', dir: 'desc' }, { v: '2026-06-17', id: 'i9' }),
    ).toBe('created_at.lt."2026-06-17",and(created_at.eq."2026-06-17",id.lt."i9")');
  });
  it('quotes a value containing a comma so it cannot break the grammar', () => {
    expect(buildKeysetOr({ column: 'number', dir: 'asc' }, { v: 'A,B', id: 'i1' })).toBe(
      'number.gt."A,B",and(number.eq."A,B",id.gt."i1")',
    );
  });
});

describe('paginateSorted', () => {
  const rows = [
    { id: 'a', total_cents: 100 },
    { id: 'b', total_cents: 200 },
    { id: 'c', total_cents: 300 },
  ];

  it('returns all rows and a null cursor when at or under the limit', () => {
    const page = paginateSorted(rows, 3, 'total_cents');
    expect(page.items).toHaveLength(3);
    expect(page.next_cursor).toBeNull();
  });

  it('trims to the limit and emits a cursor keyed on the sort column', () => {
    const page = paginateSorted(rows, 2, 'total_cents');
    expect(page.items).toHaveLength(2);
    expect(page.next_cursor).not.toBeNull();
    expect(decodeSortCursor(page.next_cursor)).toEqual({ v: '300', id: 'c' });
  });

  it('stringifies the sort value (numeric column) into the cursor', () => {
    const page = paginateSorted(rows, 1, 'total_cents');
    expect(decodeSortCursor(page.next_cursor)).toEqual({ v: '200', id: 'b' });
  });

  it('throws when the cursor row has a null sort value (allowlist invariant)', () => {
    const withNull: Array<Record<string, unknown> & { id: string }> = [
      { id: 'a', total_cents: 100 },
      { id: 'b', total_cents: null },
    ];
    expect(() => paginateSorted(withNull, 1, 'total_cents')).toThrow();
  });
});
