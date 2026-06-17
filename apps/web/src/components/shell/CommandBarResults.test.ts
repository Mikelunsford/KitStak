// Component tests for CommandBarResults (R-W13-SRCH-01, F-UIUX-PALETTE-VERBS-01).
//
// Follows the pure-TS element-tree-walk pattern used by StateStepper.test.ts
// and Breadcrumbs.test.ts: Vitest runs without jsdom/testing-library, so we
// call the function component directly and walk the returned React element tree
// to lock the a11y contract of the Cmd/Ctrl-K palette result list:
//   - listbox/option roles and labels
//   - the active row is the one whose flat index matches activeIndex
//   - exactly one option is aria-selected at a time
//   - selecting a row invokes onSelect with that row
//   - rows render in flattened display order across groups (Actions first)

import { describe, it, expect } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

import { CommandBarResults } from './CommandBarResults';
import type { CommandRow, CommandRowGroup } from './commandBarModel';

interface ElementProps {
  children?: ReactNode;
  className?: string;
  role?: string;
  'aria-label'?: string;
  'aria-selected'?: boolean;
  'data-testid'?: string;
  'data-active'?: string;
  'data-flat-index'?: number;
  onMouseDown?: (e: { preventDefault: () => void }) => void;
  [key: string]: unknown;
}

function asArray(children: ReactNode | undefined): ReactNode[] {
  if (children === undefined || children === null) return [];
  return Array.isArray(children) ? children : [children];
}

function collectElements(
  node: ReactNode,
  predicate: (el: ReactElement<ElementProps>) => boolean,
): ReactElement<ElementProps>[] {
  const out: ReactElement<ElementProps>[] = [];
  const walk = (n: ReactNode) => {
    if (!isValidElement(n)) return;
    const el = n as ReactElement<ElementProps>;
    if (predicate(el)) out.push(el);
    asArray(el.props.children).forEach(walk);
  };
  asArray(node).forEach(walk);
  return out;
}

function mkRow(key: string, title: string): CommandRow {
  return { key, title, subtitle: `sub-${title}`, href: `/go/${title}` };
}

const GROUPS: CommandRowGroup[] = [
  {
    key: 'action',
    label: 'Actions',
    rows: [{ key: 'action-/quotes/new', title: 'New quote', subtitle: 'Action', href: '/quotes/new' }],
  },
  {
    key: 'customer',
    label: 'Customers',
    rows: [mkRow('customer-1', 'Acme'), mkRow('customer-2', 'Acorn')],
  },
  {
    key: 'item',
    label: 'Items',
    rows: [mkRow('item-1', 'SKU-1')],
  },
];

function options(node: ReactNode) {
  return collectElements(node, (el) => el.props.role === 'option');
}

describe('CommandBarResults (R-W13-SRCH-01)', () => {
  it('renders a single listbox with an accessible label', () => {
    const tree = CommandBarResults({
      groups: GROUPS,
      activeIndex: 0,
      onSelect: () => {},
      onHover: () => {},
    });
    const listboxes = collectElements(tree, (el) => el.props.role === 'listbox');
    expect(listboxes.length).toBe(1);
    expect(listboxes[0]!.props['aria-label']).toBe('Search results');
  });

  it('renders one option per flattened row in display order (Actions first)', () => {
    const tree = CommandBarResults({
      groups: GROUPS,
      activeIndex: -1,
      onSelect: () => {},
      onHover: () => {},
    });
    const indices = options(tree).map((el) => el.props['data-flat-index']);
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('renders a group label for each populated group, Actions first', () => {
    const tree = CommandBarResults({
      groups: GROUPS,
      activeIndex: 0,
      onSelect: () => {},
      onHover: () => {},
    });
    const labels = collectElements(
      tree,
      (el) => el.props['data-testid'] === 'command-bar-group-label',
    ).map((el) => asArray(el.props.children)[0]);
    expect(labels).toEqual(['Actions', 'Customers', 'Items']);
  });

  it('marks exactly the active flat index as aria-selected', () => {
    const tree = CommandBarResults({
      groups: GROUPS,
      activeIndex: 2,
      onSelect: () => {},
      onHover: () => {},
    });
    const opts = options(tree);
    const selected = opts.filter((el) => el.props['aria-selected'] === true);
    expect(selected.length).toBe(1);
    expect(selected[0]!.props['data-flat-index']).toBe(2);
    expect(selected[0]!.props['data-active']).toBe('true');
  });

  it('selects no option when activeIndex is -1', () => {
    const tree = CommandBarResults({
      groups: GROUPS,
      activeIndex: -1,
      onSelect: () => {},
      onHover: () => {},
    });
    const selected = options(tree).filter(
      (el) => el.props['aria-selected'] === true,
    );
    expect(selected.length).toBe(0);
  });

  it('invokes onSelect with the row on mouse-down (Enter-equivalent path)', () => {
    let chosen: CommandRow | null = null;
    const tree = CommandBarResults({
      groups: GROUPS,
      activeIndex: 0,
      onSelect: (row) => {
        chosen = row;
      },
      onHover: () => {},
    });
    const opts = options(tree);
    // The first flattened row is the action verb "New quote".
    const target = opts.find((el) => el.props['data-flat-index'] === 0)!;
    target.props.onMouseDown?.({ preventDefault: () => {} });
    expect(chosen).not.toBeNull();
    expect((chosen as unknown as CommandRow).title).toBe('New quote');
    expect((chosen as unknown as CommandRow).href).toBe('/quotes/new');
  });
});
