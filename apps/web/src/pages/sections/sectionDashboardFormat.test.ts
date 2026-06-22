// Pin the Section Dashboard pure formatters (Phase 1). No React renderer.

import { describe, it, expect } from 'vitest';

import {
  arAgingRows,
  centsToNumber,
  humanizeToken,
  stageLabel,
  winRateDisplay,
} from './sectionDashboardFormat';

describe('stageLabel', () => {
  it('maps known opportunity stages to friendly labels', () => {
    expect(stageLabel('closed_won')).toBe('Closed won');
    expect(stageLabel('negotiation')).toBe('Negotiation');
  });

  it('falls back to a humanized token for unknown stages', () => {
    expect(stageLabel('some_new_stage')).toBe('Some new stage');
  });
});

describe('humanizeToken', () => {
  it('title-cases a snake_case token', () => {
    expect(humanizeToken('revise_requested')).toBe('Revise requested');
  });

  it('returns empty string unchanged', () => {
    expect(humanizeToken('')).toBe('');
  });
});

describe('centsToNumber', () => {
  it('passes numbers through and coerces strings', () => {
    expect(centsToNumber(1234)).toBe(1234);
    expect(centsToNumber('1234')).toBe(1234);
  });
});

describe('arAgingRows', () => {
  it('orders buckets current-first and coerces wire strings to numbers', () => {
    const rows = arAgingRows({
      current_cents: '100',
      d1_30_cents: '200',
      d31_60_cents: 300,
      d61_90_cents: '0',
      d90_plus_cents: '500',
    });
    expect(rows.map((r) => r.key)).toEqual([
      'current',
      'd1_30',
      'd31_60',
      'd61_90',
      'd90_plus',
    ]);
    expect(rows.map((r) => r.cents)).toEqual([100, 200, 300, 0, 500]);
    expect(rows[4]?.label).toBe('Over 90 days');
  });
});

describe('winRateDisplay', () => {
  it('renders one decimal place with a percent sign', () => {
    expect(winRateDisplay(42)).toBe('42.0%');
    expect(winRateDisplay(33.333)).toBe('33.3%');
  });
});
