// Tests for DataTable (F-Wave10-UI-KIT-01). Pure view-state and alignment
// helpers, plus an element-tree walk of the rendered output (no jsdom; mirrors
// the FirstSigninWelcomeBanner / ListEmptyState test style in this repo).

import { describe, it, expect } from 'vitest';

import {
  DataTable,
  ExpandableDataRowView,
  resolveTableView,
  alignClass,
  bodyColSpan,
  rowDetailsRegionId,
  type DataColumn,
} from './DataTable';

interface RNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function walk(node: unknown): RNode[] {
  if (!node || typeof node !== 'object') return [];
  // React children can be arrays nested inside arrays (e.g. a .map() result
  // sitting beside other expressions). Flatten arrays first, then recurse
  // through each element's own children.
  if (Array.isArray(node)) {
    return node.flatMap((c) => walk(c));
  }
  const el = node as RNode;
  return [el, ...walk(el.props?.children)];
}

function countType(tree: RNode[], type: string): number {
  return tree.filter((n) => n.type === type).length;
}

function findByTestId(tree: RNode[], id: string): RNode | undefined {
  return tree.find((n) => n.props?.['data-testid'] === id);
}

interface Row {
  id: string;
  name: string;
}

const COLUMNS: ReadonlyArray<DataColumn<Row>> = [
  { key: 'name', header: 'Name', render: (r) => r.name },
  { key: 'id', header: 'ID', align: 'right', render: (r) => r.id },
];

describe('resolveTableView', () => {
  it('returns loading when loading even if rows exist', () => {
    expect(resolveTableView(true, 5)).toBe('loading');
    expect(resolveTableView(true, 0)).toBe('loading');
  });

  it('returns empty when not loading and no rows', () => {
    expect(resolveTableView(false, 0)).toBe('empty');
  });

  it('returns rows when not loading and rows present', () => {
    expect(resolveTableView(false, 3)).toBe('rows');
  });
});

describe('alignClass', () => {
  it('maps alignment to the tailwind class', () => {
    expect(alignClass('right')).toBe('text-right');
    expect(alignClass('center')).toBe('text-center');
    expect(alignClass(undefined)).toBe('text-left');
  });
});

describe('DataTable render', () => {
  it('renders one header cell per column', () => {
    const el = DataTable({
      columns: COLUMNS,
      rows: [{ id: '1', name: 'Alpha' }],
      getRowKey: (r: Row) => r.id,
    });
    const tree = walk(el);
    expect(countType(tree, 'th')).toBe(COLUMNS.length);
  });

  it('renders the empty node when there are no rows and not loading', () => {
    const el = DataTable({
      columns: COLUMNS,
      rows: [] as Row[],
      getRowKey: (r: Row) => r.id,
      empty: 'Nothing here.',
    });
    const tree = walk(el);
    const emptyCell = findByTestId(tree, 'datatable-empty');
    expect(emptyCell).toBeDefined();
    expect(emptyCell?.props.children).toBe('Nothing here.');
  });

  it('renders skeleton rows while loading instead of data or empty', () => {
    const el = DataTable({
      columns: COLUMNS,
      rows: [] as Row[],
      getRowKey: (r: Row) => r.id,
      loading: true,
      loadingRows: 3,
    });
    const tree = walk(el);
    const skeletons = tree.filter(
      (n) => n.props?.['data-testid'] === 'datatable-skeleton-row',
    );
    expect(skeletons.length).toBe(3);
    expect(findByTestId(tree, 'datatable-empty')).toBeUndefined();
  });

  it('renders a body row per data row', () => {
    const rows: Row[] = [
      { id: '1', name: 'Alpha' },
      { id: '2', name: 'Beta' },
    ];
    const el = DataTable({ columns: COLUMNS, rows, getRowKey: (r: Row) => r.id });
    const tree = walk(el);
    // 1 header row + 2 data rows.
    expect(countType(tree, 'tr')).toBe(3);
  });

  it('adds a leading toggle header cell when renderRowDetails is provided', () => {
    const el = DataTable({
      columns: COLUMNS,
      rows: [{ id: '1', name: 'Alpha' }],
      getRowKey: (r: Row) => r.id,
      renderRowDetails: (r: Row) => r.id,
    });
    const tree = walk(el);
    // One extra header cell for the chevron column.
    expect(countType(tree, 'th')).toBe(COLUMNS.length + 1);
  });

  it('spans the toggle column in the empty cell when row details are on', () => {
    const el = DataTable({
      columns: COLUMNS,
      rows: [] as Row[],
      getRowKey: (r: Row) => r.id,
      renderRowDetails: (r: Row) => r.id,
    });
    const tree = walk(el);
    expect(findByTestId(tree, 'datatable-empty')?.props.colSpan).toBe(
      COLUMNS.length + 1,
    );
  });
});

describe('bodyColSpan', () => {
  it('adds one for the toggle column only when row details are enabled', () => {
    expect(bodyColSpan(4, false)).toBe(4);
    expect(bodyColSpan(4, true)).toBe(5);
  });
});

describe('rowDetailsRegionId', () => {
  it('derives a stable region id from the row key', () => {
    expect(rowDetailsRegionId('abc')).toBe('row-details-abc');
  });
});

describe('ExpandableDataRowView', () => {
  const row: Row = { id: '1', name: 'Alpha' };
  const regionId = rowDetailsRegionId('1');

  function findButton(tree: RNode[]): RNode | undefined {
    return tree.find((n) => n.type === 'button');
  }

  it('wires the toggle button to the details region and reports collapsed state', () => {
    const el = ExpandableDataRowView({
      row,
      columns: COLUMNS,
      open: false,
      onToggle: () => {},
      regionId,
      renderRowDetails: (r: Row) => r.id,
    });
    const tree = walk(el);
    const button = findButton(tree);
    expect(button?.props['aria-controls']).toBe(regionId);
    expect(button?.props['aria-expanded']).toBe(false);

    const detailsCell = findByTestId(tree, 'datatable-row-details');
    expect(detailsCell?.props.id).toBe(regionId);
    expect(detailsCell?.props.colSpan).toBe(COLUMNS.length + 1);
  });

  it('reveals the details row and reports expanded state when open', () => {
    const el = ExpandableDataRowView({
      row,
      columns: COLUMNS,
      open: true,
      onToggle: () => {},
      regionId,
      renderRowDetails: (r: Row) => r.id,
    });
    const tree = walk(el);
    expect(findButton(tree)?.props['aria-expanded']).toBe(true);
    // The hidden flag sits on the details <tr>; open means not hidden.
    const detailsRow = tree.find(
      (n) => n.type === 'tr' && n.props.hidden === false,
    );
    expect(detailsRow).toBeDefined();
  });

  it('invokes the toggle handler when activated', () => {
    let toggled = 0;
    const el = ExpandableDataRowView({
      row,
      columns: COLUMNS,
      open: false,
      onToggle: () => {
        toggled += 1;
      },
      regionId,
      renderRowDetails: (r: Row) => r.id,
    });
    const onClick = walk(el).find((n) => n.type === 'button')?.props
      .onClick as () => void;
    onClick();
    expect(toggled).toBe(1);
  });
});
