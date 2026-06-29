// Element-tree-walk tests for the Job Builder's pure presentational pieces:
// the readiness rail, the job list, and the read-only BOM / Receiving tabs.
// The editing tabs (Labels/SOW/Timeline/Jacket) use hooks and are exercised via
// the unit-tested jobLogic / jobAdapter instead (the walk cannot call a
// hook-using component). Mirrors the ResultStep element-tree-walk harness.

import { describe, it, expect } from 'vitest';

import { ReadinessRail } from './ReadinessRail';
import { JobBuilderList } from './JobBuilderList';
import { BomTab } from './tabs/BomTab';
import { ReceivingTab } from './tabs/ReceivingTab';
import type { Job } from '@/lib/jobbuilder/jobModel';
import type { JobRun } from '@/lib/types/threepl';
import type { ReceivingOrder } from '@/lib/services/receivingOrdersService';

interface RNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

// Flatten the (unrendered) element tree, descending through arrays at any depth
// (a .map() yields a nested array child). Does not render child components, so
// content passed to a sub-component is asserted via its props instead.
function walk(node: unknown): RNode[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  const el = node as RNode;
  return [el, ...walk(el.props?.children)];
}

function collectText(node: unknown, acc: string[]): void {
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, acc)); return; }
  if (typeof node === 'string') { acc.push(node); return; }
  if (typeof node === 'number') { acc.push(String(node)); return; }
  if (!node || typeof node !== 'object') return;
  collectText((node as RNode).props?.children, acc);
}

function text(node: unknown): string {
  const acc: string[] = [];
  collectText(node, acc);
  return acc.join(' ');
}

function readyJob(over: Partial<Job> = {}): Job {
  return {
    id: 'JR-1', project: 'Acme kitting', customer: 'Acme', family: '',
    mabd: '2026-09-01', totalCents: 0, qty: 1, released: false,
    items: [{ sku: '', itemNo: 'i1', desc: 'Box', weight: '', dims: '', perUnit: '500' }],
    ro: { number: 'RO-1', supplier: '', eta: '2026-08-10' },
    labels: [{ kind: 'UPC', size: '4x6', data: {}, qty: '500' }],
    sow: [{ process: 'Kit', detail: '' }],
    timeline: { materialsEta: '2026-08-10', buildStart: '2026-08-15', buildEnd: '2026-08-20', ship: '2026-08-28' },
    jacket: { approved: false },
    ...over,
  };
}

describe('ReadinessRail', () => {
  it('reports 5/5 and an on-track schedule for a complete build', () => {
    const out = ReadinessRail({ job: readyJob() });
    const t = text(out);
    expect(t).toContain('On track');
    expect(t).toContain('Readiness · 5/5');
    expect(t).toContain('BOM units (inbound total)');
    // inbound rollup = 500 perUnit * 1 output unit
    expect(t).toContain('500');
  });

  it('prompts for a ship date and shows 0/5 on an empty build', () => {
    const empty = readyJob({
      items: [], labels: [], sow: [], ro: { number: '', supplier: '', eta: '' },
      timeline: { materialsEta: '', buildStart: '', buildEnd: '', ship: '' },
    });
    const t = text(ReadinessRail({ job: empty }));
    expect(t).toContain('Set ship date');
    expect(t).toContain('Readiness · 0/5');
  });
});

describe('JobBuilderList', () => {
  const runs = [
    { id: 'run-1', run_number: 'JR-0007', status: 'planned' },
    { id: 'run-2', run_number: null, status: 'in_progress' },
  ] as unknown as JobRun[];

  it('links each run to its builder', () => {
    const tree = walk(JobBuilderList({ runs }));
    const link1 = tree.find((n) => n.props?.to === '/3pl-operations/job-builder/run-1');
    expect(link1).toBeDefined();
    expect(text(link1)).toContain('JR-0007');
    // run_number null falls back to the run id in the link target
    expect(tree.some((n) => n.props?.to === '/3pl-operations/job-builder/run-2')).toBe(true);
  });

  it('shows an empty state with no runs', () => {
    expect(text(JobBuilderList({ runs: [] }))).toContain('No jobs yet');
  });
});

describe('BomTab', () => {
  it('lists the project materials and links to the project', () => {
    const tree = walk(BomTab({
      items: [{ sku: '', itemNo: 'i1', desc: 'Corrugate', weight: '', dims: '', perUnit: '1200' }],
      projectId: 'proj-9',
    }));
    expect(text(tree[0])).toContain('Corrugate');
    expect(text(tree[0])).toContain('1,200');
    expect(tree.some((n) => n.props?.to === '/projects/proj-9')).toBe(true);
  });

  it('shows an empty state with no materials', () => {
    expect(text(BomTab({ items: [], projectId: null }))).toContain('No materials');
  });
});

describe('ReceivingTab', () => {
  it('shows the receiving order facts and a link', () => {
    const ro = {
      id: 'ro-1', receiving_number: 'RO-0003', status: 'created', expected_date: '2026-08-10',
    } as unknown as ReceivingOrder;
    const tree = walk(ReceivingTab({ receivingOrder: ro, receivingOrderId: 'ro-1' }));
    // The facts are passed to the Fact sub-component via props, so assert there.
    expect(tree.some((n) => n.props?.value === 'RO-0003')).toBe(true);
    expect(tree.some((n) => n.props?.value === 'created')).toBe(true);
    expect(tree.some((n) => n.props?.to === '/inventory/receiving/ro-1')).toBe(true);
  });

  it('shows an empty state with no receiving order', () => {
    expect(text(ReceivingTab({ receivingOrder: null, receivingOrderId: null }))).toContain('No receiving order');
  });
});
