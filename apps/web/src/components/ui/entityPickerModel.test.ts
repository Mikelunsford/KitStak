// Pin the EntityPicker pure helpers: label filter, row assembly (including the
// trailing create row), keyboard index math, and selected-label resolution.
// The component itself uses hooks and is exercised through these helpers plus
// Playwright, since the repo runs Vitest without jsdom.

import { describe, it, expect } from 'vitest';

import {
  filterOptions,
  buildEntityRows,
  moveActiveIndex,
  selectedLabel,
} from './entityPickerModel';

interface Row {
  id: string;
  name: string;
}

const OPTIONS: Row[] = [
  { id: 'a', name: 'Acme Co.' },
  { id: 'b', name: 'Acme Logistics' },
  { id: 'c', name: 'Globex' },
];

const label = (r: Row) => r.name;
const id = (r: Row) => r.id;

describe('filterOptions', () => {
  it('returns every option for an empty query', () => {
    expect(filterOptions(OPTIONS, '', label)).toHaveLength(3);
  });

  it('returns every option for a whitespace-only query', () => {
    expect(filterOptions(OPTIONS, '   ', label)).toHaveLength(3);
  });

  it('matches a case-insensitive substring on the label', () => {
    const got = filterOptions(OPTIONS, 'acme', label).map(id);
    expect(got).toEqual(['a', 'b']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterOptions(OPTIONS, 'zzz', label)).toEqual([]);
  });

  it('does not mutate the source array', () => {
    const copy = [...OPTIONS];
    filterOptions(OPTIONS, '', label);
    expect(OPTIONS).toEqual(copy);
  });
});

describe('buildEntityRows', () => {
  it('maps every option to an option row', () => {
    const rows = buildEntityRows(OPTIONS, false);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === 'option')).toBe(true);
  });

  it('appends a single create row when create is allowed', () => {
    const rows = buildEntityRows(OPTIONS, true);
    expect(rows).toHaveLength(4);
    expect(rows[rows.length - 1]?.kind).toBe('create');
  });

  it('yields just the create row when there are no options', () => {
    const rows = buildEntityRows([], true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('create');
  });

  it('yields nothing when there are no options and create is not allowed', () => {
    expect(buildEntityRows([], false)).toEqual([]);
  });
});

describe('moveActiveIndex', () => {
  it('moves down and wraps at the end', () => {
    expect(moveActiveIndex(0, 1, 3)).toBe(1);
    expect(moveActiveIndex(2, 1, 3)).toBe(0);
  });

  it('moves up and wraps at the start', () => {
    expect(moveActiveIndex(2, -1, 3)).toBe(1);
    expect(moveActiveIndex(0, -1, 3)).toBe(2);
  });

  it('lands on the first row when moving down from an unset index', () => {
    expect(moveActiveIndex(-1, 1, 3)).toBe(0);
  });

  it('lands on the last row when moving up from an unset index', () => {
    expect(moveActiveIndex(-1, -1, 3)).toBe(2);
  });

  it('returns -1 when there are no rows', () => {
    expect(moveActiveIndex(0, 1, 0)).toBe(-1);
  });
});

describe('selectedLabel', () => {
  it('returns the label of the selected option', () => {
    expect(selectedLabel(OPTIONS, 'b', id, label)).toBe('Acme Logistics');
  });

  it('returns an empty string when nothing is selected', () => {
    expect(selectedLabel(OPTIONS, null, id, label)).toBe('');
  });

  it('returns an empty string when the selected id is gone from the set', () => {
    expect(selectedLabel(OPTIONS, 'missing', id, label)).toBe('');
  });
});
