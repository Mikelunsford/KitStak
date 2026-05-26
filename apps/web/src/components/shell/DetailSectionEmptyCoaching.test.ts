// Component-prop validation tests for DetailSectionEmptyCoaching
// (F-Wave9-DETAIL-EMPTY-COACHING-01). Mirrors the ListEmptyState.test.ts
// pattern: no jsdom or testing-library, render to a React element tree
// and assert against the resulting JSX `props` shape. That is enough
// to lock the explainer-rendered, CTA-rendered, CTA-hidden, optional-
// icon, and copy-discipline contracts.

import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { Package, Truck } from 'lucide-react';

import {
  DetailSectionEmptyCoaching,
  type DetailSectionEmptyCoachingProps,
} from './DetailSectionEmptyCoaching';

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

function render(props: DetailSectionEmptyCoachingProps): RNode[] {
  const tree = DetailSectionEmptyCoaching(props) as unknown as ReactElement;
  return walk(tree);
}

function find(
  nodes: RNode[],
  predicate: (n: RNode) => boolean,
): RNode | undefined {
  return nodes.find(predicate);
}

const BASE: DetailSectionEmptyCoachingProps = {
  entity: 'phase',
  explainer: 'Phases break a project into trackable milestones.',
};

describe('DetailSectionEmptyCoaching', () => {
  it('renders the explainer text with required props only', () => {
    const nodes = render(BASE);
    const explainerNode = find(
      nodes,
      (n) =>
        n.props['data-testid'] === 'detail-section-empty-coaching-explainer',
    );
    expect(explainerNode).toBeDefined();
    expect(explainerNode?.props.children).toBe(
      'Phases break a project into trackable milestones.',
    );
  });

  it('carries the entity prop through as a data attribute', () => {
    const nodes = render({ ...BASE, entity: 'manufacturing run' });
    const root = find(
      nodes,
      (n) => n.props['data-testid'] === 'detail-section-empty-coaching',
    );
    expect(root?.props['data-entity']).toBe('manufacturing run');
  });

  it('renders the CTA link when ctaLabel and ctaTo are both provided', () => {
    const nodes = render({
      ...BASE,
      ctaLabel: 'Add phase',
      ctaTo: '/3pl-operations/projects/abc#add-phase',
    });
    const cta = find(
      nodes,
      (n) => n.props['data-testid'] === 'detail-section-empty-coaching-cta',
    );
    expect(cta).toBeDefined();
    expect(cta?.props.to).toBe('/3pl-operations/projects/abc#add-phase');
    expect(cta?.props.children).toBe('Add phase');
    expect(cta?.props['aria-label']).toBe('Add phase');
  });

  it('hides the CTA when ctaLabel and ctaTo are absent', () => {
    const nodes = render(BASE);
    const cta = find(
      nodes,
      (n) => n.props['data-testid'] === 'detail-section-empty-coaching-cta',
    );
    expect(cta).toBeUndefined();
    // Explainer still renders even when CTA is hidden.
    const explainerNode = find(
      nodes,
      (n) =>
        n.props['data-testid'] === 'detail-section-empty-coaching-explainer',
    );
    expect(explainerNode).toBeDefined();
  });

  it('hides the CTA when only ctaLabel is provided without ctaTo', () => {
    const nodes = render({ ...BASE, ctaLabel: 'Add phase' });
    const cta = find(
      nodes,
      (n) => n.props['data-testid'] === 'detail-section-empty-coaching-cta',
    );
    expect(cta).toBeUndefined();
  });

  it('hides the CTA when only ctaTo is provided without ctaLabel', () => {
    const nodes = render({ ...BASE, ctaTo: '/somewhere' });
    const cta = find(
      nodes,
      (n) => n.props['data-testid'] === 'detail-section-empty-coaching-cta',
    );
    expect(cta).toBeUndefined();
  });

  it('accepts a custom lucide icon', () => {
    const nodes = render({ ...BASE, icon: Truck });
    // The icon node is a React element whose `type` is the lucide
    // function component itself. We assert it landed in the tree.
    const iconNode = find(nodes, (n) => n.type === Truck);
    expect(iconNode).toBeDefined();
  });

  it('falls back to the default Info icon when no icon prop is passed', () => {
    const nodes = render(BASE);
    // The default branch picks `Info`. We do not import `Info` here in
    // order to keep the test free of needless coupling; instead we
    // confirm no `Truck`/`Package` slipped in by accident.
    const truck = find(nodes, (n) => n.type === Truck);
    const pkg = find(nodes, (n) => n.type === Package);
    expect(truck).toBeUndefined();
    expect(pkg).toBeUndefined();
  });
});

describe('DetailSectionEmptyCoaching copy discipline', () => {
  // Constitutional invariant: no em dash, no double hyphen, no emoji in
  // any rendered copy. The component itself does not author copy strings
  // (callers do), but we lock the surfaces it renders so a future helper
  // that prepends or appends decoration cannot drift the brand voice.
  const EM_DASH = /—/;
  const EN_DASH = /–/;
  const DOUBLE_HYPHEN = /--/;
  // Conservative emoji detector: matches the common surrogate-pair and
  // misc-symbol blocks. The repo's other copy-discipline tests use the
  // same pattern; see SetupChecklist tests.
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

  function copyStrings(nodes: RNode[]): string[] {
    const strs: string[] = [];
    for (const n of nodes) {
      const c = n.props.children;
      if (typeof c === 'string') strs.push(c);
    }
    return strs;
  }

  it('rejects em dash, en dash, double hyphen, and emoji in rendered copy', () => {
    const nodes = render({
      entity: 'phase',
      explainer: 'Phases break a project into trackable milestones.',
      ctaLabel: 'Add phase',
      ctaTo: '/3pl-operations/projects/abc',
    });
    for (const s of copyStrings(nodes)) {
      expect(s).not.toMatch(EM_DASH);
      expect(s).not.toMatch(EN_DASH);
      expect(s).not.toMatch(DOUBLE_HYPHEN);
      expect(s).not.toMatch(EMOJI);
    }
  });
});
