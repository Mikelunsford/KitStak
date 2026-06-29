import { describe, it, expect } from 'vitest';

import { ResultStep } from './ResultStep';
import { initialState } from './engineState';
import type { EstimateResult, EstimateLineItem } from '@/lib/estimate/engine';

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

// Recursively gather every string in the (unrendered) element tree, including
// strings that sit alongside expressions in a children array. Does NOT descend
// into child components (Section/Total/Button are not rendered), so content
// passed to those is asserted via their props instead.
function collectText(node: unknown, acc: string[]): void {
  if (typeof node === 'string') {
    acc.push(node);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const el = node as RNode;
  const ch = el.props?.children;
  if (Array.isArray(ch)) ch.forEach((c) => collectText(c, acc));
  else collectText(ch, acc);
}

function text(node: unknown): string[] {
  const acc: string[] = [];
  collectText(node, acc);
  return acc;
}

function baseResult(over: Partial<EstimateResult> = {}): EstimateResult {
  return {
    productionItems: [{ label: 'Production / assembly', detail: '1,000 units', amountCents: 120_000 }],
    passThroughItems: [{ label: 'Inbound receiving', detail: '4 pallets', amountCents: 5_500 }],
    productionCents: 120_000,
    passThroughCents: 5_500,
    rawCents: 125_500,
    totalCents: 125_500,
    minApplied: false,
    hasProduction: true,
    colPerUnitMicros: 0,
    sellPerUnitMicros: 0,
    profitPerUnitMicros: 0,
    marginOk: true,
    ...over,
  };
}

const NOOP = () => {};

function render(props: Partial<Parameters<typeof ResultStep>[0]> = {}) {
  return ResultStep({
    state: { ...initialState(), projectName: 'Acme display', customerId: 'cust1' },
    result: baseResult(),
    validUntil: 'Jul 29, 2026',
    customerSelected: true,
    converting: false,
    error: null,
    onConvert: NOOP,
    onEditScope: NOOP,
    ...props,
  });
}

// Find the Section element by the title prop it was given, and read back its
// items prop (the line list it will render).
function sectionItems(tree: RNode[], title: string): EstimateLineItem[] {
  const node = tree.find((n) => n.props?.title === title);
  return (node?.props.items as EstimateLineItem[] | undefined) ?? [];
}

describe('ResultStep', () => {
  it('passes the production and pass-through lines to their sections', () => {
    const tree = walk(render());
    expect(sectionItems(tree, 'Production').map((i) => i.label)).toContain('Production / assembly');
    expect(sectionItems(tree, 'Pass-throughs & materials').map((i) => i.label)).toContain('Inbound receiving');
  });

  it('renders the grand total in whole dollars', () => {
    expect(text(render()).some((s) => s.includes('$1,255'))).toBe(true);
  });

  it('disables Convert and shows guidance when no customer is selected', () => {
    const tree = walk(render({ customerSelected: false }));
    const convertBtn = tree.find((n) => n.props?.children === 'Convert to quote');
    expect(convertBtn).toBeDefined();
    expect(convertBtn?.props.disabled).toBe(true);
    expect(text(render({ customerSelected: false })).some((s) => s.includes('Choose a customer'))).toBe(true);
  });

  it('enables Convert when a customer is selected', () => {
    const tree = walk(render({ customerSelected: true }));
    const convertBtn = tree.find((n) => n.props?.children === 'Convert to quote');
    expect(convertBtn?.props.disabled).toBe(false);
  });

  it('shows the project-minimum note when the minimum applies', () => {
    const out = render({ result: baseResult({ minApplied: true, rawCents: 5_000, totalCents: 50_000 }) });
    expect(text(out).some((s) => s.includes('project minimum applied'))).toBe(true);
  });
});
