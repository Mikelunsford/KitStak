// Tests for PageHeader (F-Wave10-UI-KIT-01). Element-tree walk, no jsdom.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';

import { PageHeader } from './PageHeader';

interface RNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function walk(node: unknown): RNode[] {
  if (!node || typeof node !== 'object') return [];
  const el = node as RNode;
  const out: RNode[] = [el];
  const children = el.props?.children;
  if (Array.isArray(children)) {
    children.forEach((c) => out.push(...walk(c)));
  } else if (children) {
    out.push(...walk(children));
  }
  return out;
}

function textOf(tree: RNode[], type: string): string[] {
  return tree
    .filter((n) => n.type === type)
    .map((n) => n.props.children)
    .filter((c): c is string => typeof c === 'string');
}

describe('PageHeader', () => {
  it('renders the title in an h1', () => {
    const el = PageHeader({ title: 'Quotes' });
    const tree = walk(el);
    expect(textOf(tree, 'h1')).toContain('Quotes');
  });

  it('renders eyebrow, meta, and actions when provided', () => {
    const el = PageHeader({
      title: 'Quotes',
      eyebrow: 'Quotes',
      meta: '5 quotes',
      actions: createElement('button', { 'data-testid': 'cta' }, 'New quote'),
    });
    const tree = walk(el);
    const strings = tree
      .map((n) => n.props.children)
      .filter((c): c is string => typeof c === 'string');
    expect(strings).toContain('Quotes');
    expect(strings).toContain('5 quotes');
    expect(tree.some((n) => n.props?.['data-testid'] === 'cta')).toBe(true);
  });

  it('omits the eyebrow, meta, and action containers when not provided', () => {
    const el = PageHeader({ title: 'Quotes' });
    const tree = walk(el);
    // Only the title string should be present, no eyebrow/meta strings.
    const strings = tree
      .map((n) => n.props.children)
      .filter((c): c is string => typeof c === 'string');
    expect(strings).toEqual(['Quotes']);
  });
});
