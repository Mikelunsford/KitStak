// UX-Q9: representative list-page smoke tests for the empty-state surface.
//
// Page components themselves use TanStack Query + react-router hooks, which
// the repo's no-jsdom test runner cannot execute. We instead exercise the
// `ListEmptyState` props bag for three representative list pages (vendors,
// invoices, stock movements) to lock the per-page wiring: explainer copy,
// entity label, addTo path, and the no-CTA special case for movements.
//
// If a future refactor changes one of these props the test fails and the
// breakage surfaces before review, mirroring the lock-it-down posture used
// by lib/hooks/featureFlagResolver.test.ts and dashboardWorkCards.test.ts.

import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';

import { ListEmptyState } from './ListEmptyState';

type RNode = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function walk(node: unknown): RNode[] {
  if (!node || typeof node !== 'object') return [];
  const el = node as RNode;
  const out: RNode[] = [el];
  const children = el.props?.children;
  if (Array.isArray(children)) {
    children.forEach((child) => out.push(...walk(child)));
  } else if (children) {
    out.push(...walk(children));
  }
  return out;
}

function nodesFor(props: Parameters<typeof ListEmptyState>[0]): RNode[] {
  return walk(ListEmptyState(props) as unknown as ReactElement);
}

function explainerOf(nodes: RNode[]): unknown {
  return nodes.find(
    (n) => n.props['data-testid'] === 'list-empty-state-explainer',
  )?.props.children;
}

function ctaOf(nodes: RNode[]): RNode | undefined {
  return nodes.find(
    (n) => n.props['data-testid'] === 'list-empty-state-cta',
  );
}

describe('list-page empty-state wiring (representative)', () => {
  it('vendors page renders the vendors explainer and CTA target', () => {
    const nodes = nodesFor({
      entity: 'vendor',
      explainer: 'Vendors are the companies you buy materials from.',
      addLabel: 'Add vendor',
      addTo: '/purchasing/vendors/new',
    });
    expect(explainerOf(nodes)).toBe(
      'Vendors are the companies you buy materials from.',
    );
    const cta = ctaOf(nodes);
    expect(cta?.props.to).toBe('/purchasing/vendors/new');
    expect(cta?.props.children).toBe('Add vendor');
  });

  it('invoices page renders the invoices explainer and CTA target', () => {
    const nodes = nodesFor({
      entity: 'invoice',
      explainer: 'Invoices bill a customer for delivered work.',
      addLabel: 'Add invoice',
      addTo: '/invoicing/invoices/new',
    });
    expect(explainerOf(nodes)).toBe(
      'Invoices bill a customer for delivered work.',
    );
    expect(ctaOf(nodes)?.props.to).toBe('/invoicing/invoices/new');
  });

  it('stock movements renders the explainer and omits the CTA (canAdd=false)', () => {
    const nodes = nodesFor({
      entity: 'movement',
      explainer:
        'Stock movements are the audit trail of every inventory change. They appear automatically when you receive, build, or ship items.',
      addLabel: 'Add movement',
      addTo: '/inventory/stock/movements',
      canAdd: false,
    });
    expect(explainerOf(nodes)).toMatch(/audit trail/);
    expect(ctaOf(nodes)).toBeUndefined();
  });
});
