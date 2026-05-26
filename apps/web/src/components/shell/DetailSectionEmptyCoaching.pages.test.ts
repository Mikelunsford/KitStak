// F-Wave9-DETAIL-EMPTY-COACHING-01: representative detail-page smoke tests
// for the inline empty-state coaching surface.
//
// Detail-page components themselves use TanStack Query + react-router hooks,
// which the repo's no-jsdom test runner cannot execute. We instead exercise
// the `DetailSectionEmptyCoaching` props bag for the representative detail
// sections that adopted the surface in this PR to lock per-section wiring:
// explainer copy, entity label, CTA target, and the no-CTA special case
// for read-only sections (project invoices, project materials).
//
// If a future refactor changes one of these props the test fails and the
// breakage surfaces before review, mirroring the lock-it-down posture used
// by ListEmptyState.pages.test.ts.

import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';

import { DetailSectionEmptyCoaching } from './DetailSectionEmptyCoaching';

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

function nodesFor(
  props: Parameters<typeof DetailSectionEmptyCoaching>[0],
): RNode[] {
  return walk(
    DetailSectionEmptyCoaching(props) as unknown as ReactElement,
  );
}

function explainerOf(nodes: RNode[]): unknown {
  return nodes.find(
    (n) =>
      n.props['data-testid'] === 'detail-section-empty-coaching-explainer',
  )?.props.children;
}

function ctaOf(nodes: RNode[]): RNode | undefined {
  return nodes.find(
    (n) => n.props['data-testid'] === 'detail-section-empty-coaching-cta',
  );
}

describe('detail-page section coaching wiring (representative)', () => {
  it('project receiving section renders explainer and CTA target', () => {
    const projectId = 'proj-123';
    const nodes = nodesFor({
      entity: 'receiving order',
      explainer:
        'Receiving orders track inbound stock for this project. Create one when materials are due to arrive at the warehouse.',
      ctaLabel: 'New receiving order',
      ctaTo: `/3pl-operations/receiving/new?project_id=${projectId}`,
    });
    expect(explainerOf(nodes)).toMatch(/Receiving orders track inbound stock/);
    const cta = ctaOf(nodes);
    expect(cta?.props.to).toBe(
      `/3pl-operations/receiving/new?project_id=${projectId}`,
    );
    expect(cta?.props.children).toBe('New receiving order');
  });

  it('project materials section renders explainer with no CTA (read-only path)', () => {
    // Project materials are added via an inline form below the section,
    // not a deep link, so the coaching renders without a CTA.
    const nodes = nodesFor({
      entity: 'material',
      explainer:
        'Materials are the parts and goods this project consumes. Add them to build a bill of materials and roll cost up to the project budget.',
    });
    expect(explainerOf(nodes)).toMatch(/bill of materials/);
    expect(ctaOf(nodes)).toBeUndefined();
  });

  it('project invoices section renders explainer with no CTA (system-created)', () => {
    // Invoices for a project are created via the "Create invoice from
    // project" button up top once state === 'completed', not a deep link
    // from the empty state, so canAdd is effectively false here.
    const nodes = nodesFor({
      entity: 'invoice',
      explainer:
        'Invoices bill the customer for delivered work. Convert the project to an invoice once it reaches completed status.',
    });
    expect(explainerOf(nodes)).toMatch(/Convert the project to an invoice/);
    expect(ctaOf(nodes)).toBeUndefined();
  });

  it('customer quotes section renders explainer and CTA target', () => {
    const customerId = 'cust-abc';
    const nodes = nodesFor({
      entity: 'quote',
      explainer:
        'Quotes are priced proposals you send to win the work. Approved quotes convert to projects.',
      ctaLabel: 'New quote',
      ctaTo: `/3pl-operations/quotes/new?customer_id=${customerId}`,
    });
    expect(explainerOf(nodes)).toMatch(/priced proposals/);
    const cta = ctaOf(nodes);
    expect(cta?.props.to).toBe(
      `/3pl-operations/quotes/new?customer_id=${customerId}`,
    );
  });

  it('shipment lines section renders explainer with no CTA', () => {
    // Shipment lines are added via the inline ADD LINE form, not a deep
    // link, so the coaching surfaces sans CTA.
    const nodes = nodesFor({
      entity: 'line',
      explainer:
        'Lines are the items packed onto this shipment. Add them so the warehouse knows what to pull and the customer sees the right manifest.',
    });
    expect(explainerOf(nodes)).toMatch(/packed onto this shipment/);
    expect(ctaOf(nodes)).toBeUndefined();
  });
});
