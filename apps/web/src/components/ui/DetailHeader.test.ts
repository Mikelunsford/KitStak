// Tests for DetailHeader (R-W14-READ-04). Element-tree walk, no jsdom. Verifies
// the system number is rendered inside the Additional details disclosure rather
// than the identity chip row, and that the disclosure is omitted when there is
// nothing to disclose.

import { describe, it, expect } from 'vitest';

import { DetailHeader } from './DetailHeader';
import { Disclosure } from './Disclosure';

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

function findDisclosure(tree: RNode[]): RNode | undefined {
  return tree.find((n) => n.type === Disclosure);
}

describe('DetailHeader Additional details', () => {
  it('renders the system number inside an Additional details disclosure', () => {
    const el = DetailHeader({ title: 'Smoke Co.', number: 'Q-2026-00008' });
    const tree = walk(el);

    const disclosure = findDisclosure(tree);
    expect(disclosure).toBeDefined();
    expect(disclosure?.props.label).toBe('Additional details');

    const ref = findByTestId(tree, 'detail-reference-number');
    expect(ref?.props.children).toBe('Q-2026-00008');
  });

  it('omits the disclosure when there is no number or extra detail', () => {
    const el = DetailHeader({ title: 'Smoke Co.', status: 'active' });
    const tree = walk(el);
    expect(findDisclosure(tree)).toBeUndefined();
  });

  it('still renders the disclosure for additionalDetails without a number', () => {
    const el = DetailHeader({
      title: 'Smoke Co.',
      additionalDetails: 'extra',
    });
    const tree = walk(el);
    expect(findDisclosure(tree)).toBeDefined();
  });
});
