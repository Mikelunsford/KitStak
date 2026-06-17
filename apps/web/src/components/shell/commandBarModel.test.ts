// Unit tests for the pure command-bar model (R-W13-SRCH-01). No React, no DOM:
// these exercise the flattening + keyboard-index math that backs the Cmd/Ctrl-K
// palette's arrow-key navigation.

import { describe, it, expect } from 'vitest';

import {
  GROUP_ORDER,
  GROUP_LABEL,
  buildCommandGroups,
  flattenResults,
  flattenRows,
  moveIndex,
  orderedGroups,
  type CommandRow,
} from './commandBarModel';
import type { SearchResult, SearchResultItem } from '@/lib/types/cross_cutting';

function item(
  entity_type: SearchResultItem['entity_type'],
  title: string,
): SearchResultItem {
  return {
    entity_type,
    entity_id: '00000000-0000-0000-0000-000000000000',
    title,
    subtitle: null,
    href: `/x/${title}`,
  };
}

const RESULT: SearchResult = {
  query: 'ac',
  groups: {
    customer: [item('customer', 'Acme'), item('customer', 'Acorn')],
    item: [item('item', 'SKU-AC-1')],
    job_run: [item('job_run', 'JR-0007')],
  },
};

describe('GROUP_ORDER / GROUP_LABEL cover all six search groups', () => {
  it('orders all six groups including item and job_run', () => {
    expect(GROUP_ORDER).toEqual([
      'customer',
      'quote',
      'invoice',
      'project',
      'item',
      'job_run',
    ]);
  });

  it('has a human label for every group in order', () => {
    for (const g of GROUP_ORDER) {
      expect(GROUP_LABEL[g]).toBeTruthy();
    }
    expect(GROUP_LABEL.item).toBe('Items');
    expect(GROUP_LABEL.job_run).toBe('Job runs');
  });
});

describe('orderedGroups', () => {
  it('returns empty for undefined result', () => {
    expect(orderedGroups(undefined)).toEqual([]);
  });

  it('drops empty/absent groups and orders by GROUP_ORDER', () => {
    const groups = orderedGroups(RESULT);
    expect(groups.map((g) => g.group)).toEqual(['customer', 'item', 'job_run']);
  });

  it('skips a present-but-empty group', () => {
    const groups = orderedGroups({ query: 'x', groups: { quote: [] } });
    expect(groups).toEqual([]);
  });
});

describe('flattenResults', () => {
  it('flattens groups into display order', () => {
    const flat = flattenResults(RESULT);
    expect(flat.map((i) => i.title)).toEqual([
      'Acme',
      'Acorn',
      'SKU-AC-1',
      'JR-0007',
    ]);
  });

  it('returns empty for undefined', () => {
    expect(flattenResults(undefined)).toEqual([]);
  });
});

describe('buildCommandGroups / flattenRows (verbs plus entities)', () => {
  const verbRows: CommandRow[] = [
    {
      key: 'action-/quotes/new',
      title: 'New quote',
      subtitle: 'Action',
      href: '/quotes/new',
    },
  ];

  it('puts the Actions group first, then entity groups in order', () => {
    const groups = buildCommandGroups(verbRows, RESULT);
    expect(groups.map((g) => g.key)).toEqual([
      'action',
      'customer',
      'item',
      'job_run',
    ]);
    expect(groups[0]?.label).toBe('Actions');
  });

  it('omits the Actions group when there are no verbs', () => {
    const groups = buildCommandGroups([], RESULT);
    expect(groups.map((g) => g.key)).toEqual(['customer', 'item', 'job_run']);
  });

  it('maps entity items to rows with a stable key, title, and href', () => {
    const groups = buildCommandGroups([], RESULT);
    const customerRows = groups.find((g) => g.key === 'customer')!.rows;
    expect(customerRows[0]).toMatchObject({ title: 'Acme', href: '/x/Acme' });
    expect(customerRows[0]?.key).toBe(
      'customer-00000000-0000-0000-0000-000000000000',
    );
  });

  it('flattens verbs first, then entities in display order', () => {
    const groups = buildCommandGroups(verbRows, RESULT);
    expect(flattenRows(groups).map((r) => r.title)).toEqual([
      'New quote',
      'Acme',
      'Acorn',
      'SKU-AC-1',
      'JR-0007',
    ]);
  });

  it('flattenRows returns empty for no groups', () => {
    expect(flattenRows([])).toEqual([]);
  });
});

describe('moveIndex (arrow-key navigation with wrap)', () => {
  it('returns -1 when there are no rows', () => {
    expect(moveIndex(0, 1, 0)).toBe(-1);
    expect(moveIndex(-1, -1, 0)).toBe(-1);
  });

  it('ArrowDown from -1 lands on the first row', () => {
    expect(moveIndex(-1, 1, 4)).toBe(0);
  });

  it('ArrowUp from -1 lands on the first row, then wraps to last', () => {
    // base normalises -1 to 0 for an up-move, so -1 step wraps to last.
    expect(moveIndex(-1, -1, 4)).toBe(3);
  });

  it('ArrowDown advances and wraps at the end', () => {
    expect(moveIndex(0, 1, 4)).toBe(1);
    expect(moveIndex(3, 1, 4)).toBe(0);
  });

  it('ArrowUp decrements and wraps at the start', () => {
    expect(moveIndex(1, -1, 4)).toBe(0);
    expect(moveIndex(0, -1, 4)).toBe(3);
  });

  it('clamps a stale out-of-range index into the current list', () => {
    // A leftover index of 9 from a longer prior result set should not escape
    // a now-shorter 4-row list.
    expect(moveIndex(9, 1, 4)).toBe(2); // (9 + 1 + 4) % 4
  });
});
