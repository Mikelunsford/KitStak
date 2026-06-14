// Wave 12 / A3. Unit tests for the pure template-line -> quote-line mapper.
// AAA style; no rendering, no network. Mirrors applyItemSelection.test.ts.

import { describe, it, expect } from 'vitest';

import type { JobTemplateLine } from '@/lib/types/threepl';
import {
  jobTemplateLineToQuoteLine,
  buildQuoteLinesFromTemplate,
} from './applyJobTemplate';

const ITEM = '00000000-0000-0000-0000-0000000000c1';
const VAS = '00000000-0000-0000-0000-0000000000d2';

function mkLine(over: Partial<JobTemplateLine>): JobTemplateLine {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    template_id: '00000000-0000-0000-0000-0000000000bb',
    line_kind: 'component',
    item_id: null,
    vas_id: null,
    name: 'Line',
    quantity: 1,
    rate_cents: null,
    rate_uom: null,
    currency_code: null,
    position: 0,
    created_at: '2026-06-13T00:00:00Z',
    updated_at: '2026-06-13T00:00:00Z',
    ...over,
  };
}

describe('jobTemplateLineToQuoteLine', () => {
  it('maps a component line to a priced item line carrying item_id', () => {
    // Arrange
    const line = mkLine({ line_kind: 'component', item_id: ITEM, rate_cents: 5000, quantity: 2 });

    // Act
    const result = jobTemplateLineToQuoteLine(line, 0);

    // Assert
    expect(result.kind).toBe('item');
    expect(result.item_id).toBe(ITEM);
    expect(result.vas_id).toBeNull();
    expect(result.unit_price_cents).toBe(5000);
    expect(result.quantity_e3).toBe(2000);
    expect(result.description).toBeNull();
  });

  it('maps a service line to a priced vas line carrying vas_id', () => {
    // Arrange
    const line = mkLine({ line_kind: 'service', vas_id: VAS, item_id: null, rate_cents: 1500 });

    // Act
    const result = jobTemplateLineToQuoteLine(line, 3);

    // Assert
    expect(result.kind).toBe('vas');
    expect(result.vas_id).toBe(VAS);
    expect(result.item_id).toBeNull();
    expect(result.unit_price_cents).toBe(1500);
    expect(result.position).toBe(3);
  });

  it('maps a priced step to a free-text priced item line so the rate carries onto the quote', () => {
    // Arrange
    const line = mkLine({
      line_kind: 'step', name: 'Assembly labor',
      rate_cents: 800, rate_uom: 'per_unit', currency_code: 'USD', quantity: 3,
    });

    // Act
    const result = jobTemplateLineToQuoteLine(line, 0);

    // Assert: a priced step has no catalog anchor, so it becomes a free-text
    // priced line (kind 'item', no item_id) that contributes to the quote total.
    expect(result.kind).toBe('item');
    expect(result.item_id).toBeNull();
    expect(result.vas_id).toBeNull();
    expect(result.unit_price_cents).toBe(800);
    expect(result.quantity_e3).toBe(3000);
    expect(result.description).toBeNull();
  });

  it('maps an unpriced step to a display-only note', () => {
    // Arrange
    const line = mkLine({ line_kind: 'step', name: 'Inspect each unit', rate_cents: null });

    // Act
    const result = jobTemplateLineToQuoteLine(line, 0);

    // Assert
    expect(result.kind).toBe('note');
    expect(result.item_id).toBeNull();
    expect(result.vas_id).toBeNull();
    expect(result.unit_price_cents).toBe(0);
    expect(result.description).toBeNull();
  });

  it('defaults a null quantity to one unit (1000 thousandths)', () => {
    // Arrange
    const line = mkLine({ line_kind: 'component', item_id: ITEM, quantity: null });

    // Act
    const result = jobTemplateLineToQuoteLine(line, 0);

    // Assert
    expect(result.quantity_e3).toBe(1000);
  });

  it('parses a numeric-string quantity to thousandths', () => {
    // Arrange
    const line = mkLine({ line_kind: 'component', item_id: ITEM, quantity: '2.5' });

    // Act
    const result = jobTemplateLineToQuoteLine(line, 0);

    // Assert
    expect(result.quantity_e3).toBe(2500);
  });
});

describe('buildQuoteLinesFromTemplate', () => {
  it('orders lines by template position and appends after basePosition', () => {
    // Arrange
    const lines = [
      mkLine({ name: 'B', position: 1 }),
      mkLine({ name: 'A', position: 0 }),
    ];

    // Act
    const result = buildQuoteLinesFromTemplate(lines, 5);

    // Assert
    expect(result.map((l) => l.name)).toEqual(['A', 'B']);
    expect(result.map((l) => l.position)).toEqual([5, 6]);
  });

  it('returns an empty array for a template with no lines', () => {
    // Arrange / Act
    const result = buildQuoteLinesFromTemplate([], 0);

    // Assert
    expect(result).toEqual([]);
  });
});
