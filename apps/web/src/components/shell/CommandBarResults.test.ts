// Component tests for CommandBarResults (R-W13-SRCH-01).
//
// Follows the pure-TS element-tree-walk pattern used by StateStepper.test.ts
// and Breadcrumbs.test.ts: Vitest runs without jsdom/testing-library, so we
// call the function component directly and walk the returned React element tree
// to lock the a11y contract of the Cmd/Ctrl-K palette result list:
//   - listbox/option roles and labels
//   - the active row is the one whose flat index matches activeIndex
//   - exactly one option is aria-selected at a time
//   - selecting a row invokes onSelect with that row's item
//   - rows render in flattened display order across groups

import { describe, it, expect } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

import { CommandBarResults } from './CommandBarResults';
import type { CommandBarGroup } from './commandBarModel';
import type { SearchResultItem } from '@/lib/types/cross_cutting';

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

function mkItem(
  entity_type: SearchResultItem['entity_type'],
  title: string,
): SearchResultItem {
  return {
    entity_type,
    entity_id: `id-${title}`,
    title,
    subtitle: `sub-${title}`,
    href: `/go/${title}`,
  };
}

const GROUPS: CommandBarGroup[] = [
  {
    group: 'customer',
    label: 'Customers',
    items: [mkItem('customer', 'Acme'), mkItem('customer', 'Acorn')],
  },
  {
    group: 'item',
    label: 'Items',
    items: [mkItem('item', 'SKU-1')],
  },
  {
    group: 'job_run',
    label: 'Job runs',
    items: [mkItem('job_run', 'JR-9')],
  },
];

function options(node: ReactNode) {
  return collectElements(node, (el) => el.props.role === 'option');
}

describe('CommandBarResults (R-W13-SRCH-01)', () => {
  it('renders a listbox with an accessible label', () => {
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

  it('renders one option per flattened item in display order', () => {
    const tree = CommandBarResults({
      groups: GROUPS,
      activeIndex: -1,
      onSelect: () => {},
      onHover: () => {},
    });
    const titles = options(tree).map((el) => el.props['data-flat-index']);
    expect(titles).toEqual([0, 1, 2, 3]);
  });

  it('renders a group label for each populated group', () => {
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
    expect(labels).toEqual(['Customers', 'Items', 'Job runs']);
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

  it('invokes onSelect with the row item on mouse-down (Enter-equivalent path)', () => {
    let chosen: SearchResultItem | null = null;
    const tree = CommandBarResults({
      groups: GROUPS,
      activeIndex: 0,
      onSelect: (item) => {
        chosen = item;
      },
      onHover: () => {},
    });
    const opts = options(tree);
    // The third flattened row is the single item SKU-1.
    const target = opts.find((el) => el.props['data-flat-index'] === 2)!;
    target.props.onMouseDown?.({ preventDefault: () => {} });
    expect(chosen).not.toBeNull();
    expect((chosen as unknown as SearchResultItem).title).toBe('SKU-1');
    expect((chosen as unknown as SearchResultItem).href).toBe('/go/SKU-1');
  });
});
