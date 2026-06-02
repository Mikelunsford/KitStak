// Tests for DetailLayout (F-Wave10-UI-KIT-01). Element-tree walk, no jsdom.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';

import { DetailLayout } from './DetailLayout';

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

function regionContaining(tree: RNode[], testId: string): RNode | undefined {
  return tree.find((n) => n.props?.['data-testid'] === testId);
}

describe('DetailLayout', () => {
  it('renders a main region with the children and a rail region with the rail', () => {
    const el = DetailLayout({
      children: createElement('div', { 'data-testid': 'main-content' }, 'work'),
      rail: createElement('div', { 'data-testid': 'rail-content' }, 'context'),
    });
    const tree = walk(el);

    const main = regionContaining(tree, 'detail-main');
    const rail = regionContaining(tree, 'detail-rail');
    expect(main).toBeDefined();
    expect(rail).toBeDefined();

    // The main child lives under the main region, the rail child under the rail.
    expect(walk(main).some((n) => n.props?.['data-testid'] === 'main-content')).toBe(
      true,
    );
    expect(walk(rail).some((n) => n.props?.['data-testid'] === 'rail-content')).toBe(
      true,
    );
  });
});
