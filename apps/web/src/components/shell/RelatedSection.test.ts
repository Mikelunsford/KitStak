// Tests for the shared RelatedSection hub primitive (F-UIUX-HUB-TABS-ROLLOUT-01).
//
// Pure-TS element-tree-walk (no jsdom), mirroring CommandBarResults.test.ts and
// StateStepper.test.ts. Locks the three render states (loading, populated,
// empty-coaching) and the always-present quick-create CTA.

import { describe, it, expect } from 'vitest';
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

import { RelatedSection } from './RelatedSection';
import { DetailSectionEmptyCoaching } from './DetailSectionEmptyCoaching';

interface ElementProps {
  children?: ReactNode;
  to?: string;
  className?: string;
  [key: string]: unknown;
}

function asArray(children: ReactNode | undefined): ReactNode[] {
  if (children === undefined || children === null) return [];
  return Array.isArray(children) ? children : [children];
}

function collect(
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

const BASE = {
  title: 'PURCHASE ORDERS',
  entity: 'purchase order',
  ctaLabel: 'New PO',
  ctaHref: '/purchasing/purchase-orders/new?vendor_id=v1',
  emptyExplainer: 'Purchase orders commit spend with this vendor.',
  isLoading: false,
};

describe('RelatedSection', () => {
  it('always renders the quick-create CTA as a link to ctaHref', () => {
    const tree = RelatedSection({
      ...BASE,
      count: 0,
      children: null,
    });
    const links = collect(tree, (el) => typeof el.props.to === 'string');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.props.to).toBe(BASE.ctaHref);
  });

  it('renders a loading state while isLoading', () => {
    const tree = RelatedSection({
      ...BASE,
      isLoading: true,
      count: 5,
      children: createElement('li', { key: 'x' }, 'PO-1'),
    });
    const lists = collect(tree, (el) => el.type === 'ul');
    const coaching = collect(tree, (el) => el.type === DetailSectionEmptyCoaching);
    expect(lists.length).toBe(0);
    expect(coaching.length).toBe(0);
  });

  it('renders the children list when count is positive', () => {
    const tree = RelatedSection({
      ...BASE,
      count: 2,
      children: createElement('li', { key: 'x' }, 'PO-1'),
    });
    const lists = collect(tree, (el) => el.type === 'ul');
    const coaching = collect(tree, (el) => el.type === DetailSectionEmptyCoaching);
    expect(lists.length).toBe(1);
    expect(coaching.length).toBe(0);
  });

  it('renders the coaching empty state when count is zero', () => {
    const tree = RelatedSection({
      ...BASE,
      count: 0,
      children: null,
    });
    const coaching = collect(tree, (el) => el.type === DetailSectionEmptyCoaching);
    expect(coaching.length).toBe(1);
    expect(coaching[0]!.props.entity).toBe('purchase order');
    expect(coaching[0]!.props.ctaTo).toBe(BASE.ctaHref);
  });
});
