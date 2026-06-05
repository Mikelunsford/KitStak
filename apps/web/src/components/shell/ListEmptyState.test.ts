// Component-prop validation tests for ListEmptyState (UX-Q9).
//
// Following the NextStepCTA.test.ts precedent: this repo's default test
// runner is configured for pure-logic suites without jsdom or
// testing-library. We render the component to a React element tree and
// assert against the resulting JSX `props` shape. That is enough to lock
// the explainer-rendered, CTA-rendered, CTA-hidden, default-canAdd,
// addTo-target, and entity-carry-through contracts.

import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';

import { ListEmptyState, type ListEmptyStateProps } from './ListEmptyState';

// React element node shape. ReactElement.props is typed `unknown` since
// React 19; coerce to a permissive bag so the assertions read cleanly.
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

function render(props: ListEmptyStateProps): RNode[] {
  const tree = ListEmptyState(props) as unknown as ReactElement;
  return walk(tree);
}

function find(
  nodes: RNode[],
  predicate: (n: RNode) => boolean,
): RNode | undefined {
  return nodes.find(predicate);
}

const BASE: ListEmptyStateProps = {
  entity: 'vendor',
  explainer: 'Vendors are the companies you buy materials from.',
  addLabel: 'Add vendor',
  addTo: '/purchasing/vendors/new',
};

describe('ListEmptyState', () => {
  it('renders the explainer text', () => {
    const nodes = render(BASE);
    const explainerNode = find(
      nodes,
      (n) => n.props['data-testid'] === 'list-empty-state-explainer',
    );
    expect(explainerNode).toBeDefined();
    expect(explainerNode?.props.children).toBe(
      'Vendors are the companies you buy materials from.',
    );
  });

  it('renders the Add CTA when canAdd is true', () => {
    const nodes = render({ ...BASE, canAdd: true });
    const cta = find(
      nodes,
      (n) => n.props['data-testid'] === 'list-empty-state-cta',
    );
    expect(cta).toBeDefined();
    expect(cta?.props.children).toBe('Add vendor');
  });

  it('hides the Add CTA when canAdd is false', () => {
    const nodes = render({ ...BASE, canAdd: false });
    const cta = find(
      nodes,
      (n) => n.props['data-testid'] === 'list-empty-state-cta',
    );
    expect(cta).toBeUndefined();
    // Explainer still renders even when CTA is hidden.
    const explainerNode = find(
      nodes,
      (n) => n.props['data-testid'] === 'list-empty-state-explainer',
    );
    expect(explainerNode).toBeDefined();
  });

  it('defaults canAdd to true when not provided', () => {
    const nodes = render(BASE);
    const cta = find(
      nodes,
      (n) => n.props['data-testid'] === 'list-empty-state-cta',
    );
    expect(cta).toBeDefined();
  });

  it('passes the addTo prop through as the CTA link target', () => {
    const nodes = render({ ...BASE, addTo: '/crm/customers/new' });
    const cta = find(
      nodes,
      (n) => n.props['data-testid'] === 'list-empty-state-cta',
    );
    expect(cta?.props.to).toBe('/crm/customers/new');
  });

  it('carries the entity prop through as a data attribute', () => {
    const nodes = render({ ...BASE, entity: 'manufacturing run' });
    const root = find(
      nodes,
      (n) => n.props['data-testid'] === 'list-empty-state',
    );
    expect(root?.props['data-entity']).toBe('manufacturing run');
  });
});
