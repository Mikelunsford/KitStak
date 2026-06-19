// Tests for ReferenceField (R-W14-READ-03). Element-tree walk, no jsdom.

import { describe, it, expect } from 'vitest';

import { ReferenceField, hasReferenceValue } from './ReferenceField';

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

describe('hasReferenceValue', () => {
  it('treats null, undefined, and empty string as nothing to render', () => {
    expect(hasReferenceValue(null)).toBe(false);
    expect(hasReferenceValue(undefined)).toBe(false);
    expect(hasReferenceValue('')).toBe(false);
  });

  it('treats a non-empty value as renderable', () => {
    expect(hasReferenceValue('Q-2026-00008')).toBe(true);
    expect(hasReferenceValue(0)).toBe(true);
  });
});

describe('ReferenceField', () => {
  it('renders the label and the value in tabular figures', () => {
    const el = ReferenceField({ label: 'Number', value: 'Q-2026-00008' });
    const tree = walk(el);
    const value = tree.find((n) =>
      String(n.props?.className ?? '').includes('tabular-nums'),
    );
    expect(value?.props.children).toBe('Q-2026-00008');
  });

  it('renders nothing for an empty value', () => {
    expect(ReferenceField({ label: 'Number', value: null })).toBeNull();
  });
});
