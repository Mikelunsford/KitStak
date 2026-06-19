// Tests for Disclosure (R-W14-READ-03). Element-tree walk of the pure
// DisclosureView, no jsdom (mirrors the DataTable / DetailLayout test style).
// Covers the aria wiring (expanded, controls), the open/closed hidden state,
// and that the toggle button invokes the supplied handler.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';

import { DisclosureView } from './Disclosure';

interface RNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function walk(node: unknown): RNode[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((c) => walk(c));
  const el = node as RNode;
  return [el, ...walk(el.props?.children)];
}

function findByTestId(tree: RNode[], id: string): RNode | undefined {
  return tree.find((n) => n.props?.['data-testid'] === id);
}

function findButton(tree: RNode[]): RNode | undefined {
  return tree.find((n) => n.type === 'button');
}

const REGION_ID = 'additional-details-1';

describe('DisclosureView aria wiring', () => {
  it('wires the button to the region via aria-controls and labels both', () => {
    const el = DisclosureView({
      label: 'Additional details',
      open: false,
      onToggle: () => {},
      regionId: REGION_ID,
      children: createElement('span', null, 'ref number'),
    });
    const tree = walk(el);

    const button = findButton(tree);
    expect(button?.props['aria-controls']).toBe(REGION_ID);
    expect(button?.props.children).toContain('Additional details');

    const region = findByTestId(tree, 'disclosure-region');
    expect(region?.props.id).toBe(REGION_ID);
    expect(region?.props['aria-label']).toBe('Additional details');
    expect(region?.props.role).toBe('region');
  });

  it('reports collapsed state and hides the region when closed', () => {
    const el = DisclosureView({
      label: 'Additional details',
      open: false,
      onToggle: () => {},
      regionId: REGION_ID,
      children: 'x',
    });
    const tree = walk(el);
    expect(findButton(tree)?.props['aria-expanded']).toBe(false);
    expect(findByTestId(tree, 'disclosure-region')?.props.hidden).toBe(true);
  });

  it('reports expanded state and shows the region when open', () => {
    const el = DisclosureView({
      label: 'Additional details',
      open: true,
      onToggle: () => {},
      regionId: REGION_ID,
      children: 'x',
    });
    const tree = walk(el);
    expect(findButton(tree)?.props['aria-expanded']).toBe(true);
    expect(findByTestId(tree, 'disclosure-region')?.props.hidden).toBe(false);
  });

  it('invokes the toggle handler when the button is activated', () => {
    let toggled = 0;
    const el = DisclosureView({
      label: 'Additional details',
      open: false,
      onToggle: () => {
        toggled += 1;
      },
      regionId: REGION_ID,
      children: 'x',
    });
    const tree = walk(el);
    const onClick = findButton(tree)?.props.onClick as () => void;
    onClick();
    expect(toggled).toBe(1);
  });
});
